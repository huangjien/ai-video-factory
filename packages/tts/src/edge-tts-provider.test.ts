import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EdgeTTSProvider,
  mockEdgeTTSProvider,
  splitSentences,
} from "./edge-tts.js";

/**
 * The real EdgeTTSProvider shells out to the Python edge-tts sidecar
 * (packages/tts/python/tts_worker.py) because the JS edge-tts-universal
 * 1.4.0 hangs against Microsoft's current endpoint. These tests inject
 * a fake worker (a node script) via pythonBin/pythonArgs, so the
 * provider's own logic — subprocess protocol, multi-sentence split,
 * duration fallback, prosody passthrough, error propagation — runs
 * fully offline against the same stdin/stdout contract the real
 * worker speaks.
 *
 * The fake worker appends every request it receives to $CAPTURE_FILE so
 * the tests can assert on exactly what the provider sent. Requests whose
 * text contains "FAIL" are answered with an error (exit path). Text
 * "nowords" returns empty words + durationMs 0 (cps-estimate path).
 */

const FAKE_WORKER = `
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  const req = JSON.parse(Buffer.concat(chunks).toString());
  const fs = require("node:fs");
  fs.appendFileSync(process.env.CAPTURE_FILE, JSON.stringify(req) + "\\n");
  if (req.text.includes("FAIL")) {
    console.log(JSON.stringify({ ok: false, error: "WebSocketError: network down" }));
    process.exit(1);
  }
  const nowords = req.text.startsWith("nowords") || req.text === "!!";
  const words = nowords ? [] : [
    { text: "你好", startMs: 0, endMs: 500 },
    { text: "世界", startMs: 500, endMs: 900 },
  ];
  require("node:fs").writeFileSync(req.output, Buffer.from([1, 2, 3, 4]));
  console.log(JSON.stringify({
    ok: true, mp3: req.output, bytes: 4,
    durationMs: nowords ? 0 : 900, words,
  }));
});
`;

let tempDir: string;
let captureFile: string;

function fakeWorkerProvider(
  opts: ConstructorParameters<typeof EdgeTTSProvider>[0] = {},
): EdgeTTSProvider {
  return new EdgeTTSProvider({
    pythonBin: process.execPath,
    pythonArgs: [path.join(tempDir, "fake-worker.cjs")],
    ...opts,
  });
}

function capturedRequests(): unknown[] {
  const raw = readFileSync(captureFile, "utf8").trim();
  if (raw.length === 0) return [];
  return raw.split("\n").map((l) => JSON.parse(l) as unknown);
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "tts-provider-test-"));
  captureFile = path.join(tempDir, "capture.jsonl");
  writeFileSync(captureFile, "");
  writeFileSync(path.join(tempDir, "fake-worker.cjs"), FAKE_WORKER);
  process.env["CAPTURE_FILE"] = captureFile;
});

describe("splitSentences", () => {
  it("splits on Chinese full-width punctuation", () => {
    expect(splitSentences("今天天气好。我们去公园。")).toEqual([
      "今天天气好",
      "我们去公园",
    ]);
  });
  it("splits on ASCII . ! ?", () => {
    expect(splitSentences("Hi there. Wow! Really?")).toEqual([
      "Hi there",
      "Wow",
      "Really",
    ]);
  });
  it("preserves mixed CJK + ASCII punctuation", () => {
    expect(splitSentences("Yes. 当然!")).toEqual(["Yes", "当然"]);
  });
  it("returns single-element array when no split point exists", () => {
    expect(splitSentences("single sentence, no period here")).toEqual([
      "single sentence, no period here",
    ]);
  });
  it("strips trailing whitespace from each segment", () => {
    expect(splitSentences("a. b.   c.")).toEqual(["a", "b", "c"]);
  });
  it("returns [] for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("EdgeTTSProvider.synthesize (fake python worker)", () => {
  it("returns audio bytes + words + duration from word boundaries", async () => {
    const p = fakeWorkerProvider();
    const result = await p.synthesize({
      text: "你好世界",
      voice: "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
    });
    expect(result.audio.byteLength).toBe(4);
    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toEqual({
      text: "你好",
      startMs: 0,
      endMs: 500,
    });
    expect(result.durationMs).toBe(900);
  });

  it("passes text + voice to the worker request (single-chunk path)", async () => {
    const p = fakeWorkerProvider();
    await p.synthesize({
      text: "hi",
      voice: "en-US-EmmaNeural",
      language: "en-US",
    });
    const reqs = capturedRequests();
    expect(reqs).toHaveLength(1);
    expect((reqs[0] as { text: string }).text).toBe("hi");
    expect((reqs[0] as { voice: string }).voice).toBe("en-US-EmmaNeural");
  });

  it("forwards prosody options (rate/volume/pitch) to the worker", async () => {
    const p = fakeWorkerProvider({
      rate: "+10%",
      volume: "-20%",
      pitch: "+5Hz",
    });
    await p.synthesize({ text: "x", voice: "v", language: "en-US" });
    expect(capturedRequests()[0]).toMatchObject({
      rate: "+10%",
      volume: "-20%",
      pitch: "+5Hz",
    });
  });

  it("omits prosody keys entirely when not configured", async () => {
    const p = fakeWorkerProvider();
    await p.synthesize({ text: "x", voice: "v", language: "en-US" });
    const req = capturedRequests()[0] as Record<string, unknown>;
    expect("rate" in req).toBe(false);
    expect("volume" in req).toBe(false);
    expect("pitch" in req).toBe(false);
  });

  it("falls back to chars-per-second estimate when no word boundaries", async () => {
    const p = fakeWorkerProvider({ charsPerSecond: 10 });
    const result = await p.synthesize({
      // "nowords-" (8) + 12 a's = 20 chars / 10 cps = 2000ms.
      text: `nowords-${"a".repeat(12)}`,
      voice: "v",
      language: "en-US",
    });
    expect(result.words).toEqual([]);
    expect(result.durationMs).toBe(2000);
  });

  it("uses the default 5 cps estimate when charsPerSecond is unset", async () => {
    const p = fakeWorkerProvider();
    const result = await p.synthesize({
      // "nowords-" (8) + 2 a's = 10 chars / 5 cps = 2000ms.
      text: `nowords-${"a".repeat(2)}`,
      voice: "v",
      language: "en-US",
    });
    expect(result.durationMs).toBe(2000);
  });

  it("enforces a 500ms minimum on the duration estimate", async () => {
    const p = fakeWorkerProvider();
    const result = await p.synthesize({
      // "!!" (2 chars / 5 cps = 400ms) clamps up to 500.
      text: "!!",
      voice: "v",
      language: "en-US",
    });
    expect(result.durationMs).toBe(500);
  });

  it("propagates worker failures as TTSError", async () => {
    const p = fakeWorkerProvider();
    await expect(
      p.synthesize({ text: "FAIL please", voice: "v", language: "en-US" }),
    ).rejects.toThrow(/network down/);
  });

  it("reports a missing worker script readably", async () => {
    const p = new EdgeTTSProvider({
      pythonBin: process.execPath,
      pythonArgs: [path.join(tempDir, "no-such-worker.cjs")],
    });
    await expect(
      p.synthesize({ text: "x", voice: "v", language: "en-US" }),
    ).rejects.toThrow(/returned no JSON/);
  });

  it("with pauseBetweenSentencesSec=0, makes a single worker call", async () => {
    const p = fakeWorkerProvider();
    await p.synthesize({
      text: "今天天气好。我们去公园。",
      voice: "zh-CN-XiaoxiaoNeural",
      language: "zh-CN",
      pauseBetweenSentencesSec: 0,
    });
    expect(capturedRequests()).toHaveLength(1);
    expect((capturedRequests()[0] as { text: string }).text).toBe(
      "今天天气好。我们去公园。",
    );
  });

  it("with pauseBetweenSentencesSec > 0, drives the multi-part path", async () => {
    // Full ffmpeg concat path is exercised by @video/make end-to-end (fake
    // bytes here can't be decoded by ffmpeg). This only verifies the pause
    // knob reaches the per-sentence code path: two sentences → two worker
    // calls. The ffmpeg concat of 4-byte mp3s fails, which proves the
    // multi-part path was taken.
    const p = fakeWorkerProvider();
    await expect(
      p.synthesize({
        text: "今天天气好。我们去公园。",
        voice: "zh-CN-XiaoxiaoNeural",
        language: "zh-CN",
        pauseBetweenSentencesSec: 1.0,
      }),
    ).rejects.toThrow();
    expect(capturedRequests()).toHaveLength(2);
  });

  it("with one sentence + pause, still does single call (no concat needed)", async () => {
    const p = fakeWorkerProvider();
    await p.synthesize({
      text: "没有任何标点的长句 but really just one thing happens here",
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 1.0,
    });
    expect(capturedRequests()).toHaveLength(1);
  });
});

describe("mockEdgeTTSProvider honors pauseBetweenSentencesSec via duration padding", () => {
  it("zero pause → baseline duration estimate", async () => {
    const m = mockEdgeTTSProvider({ sampleBytes: 64, charsPerSecond: 10 });
    const r = await m.synthesize({
      text: "a".repeat(20),
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 0,
    });
    expect(r.durationMs).toBe(2000);
  });

  it("positive pause + multi-sentence → adds N-1 silences", async () => {
    const m = mockEdgeTTSProvider({ sampleBytes: 64, charsPerSecond: 10 });
    const r = await m.synthesize({
      text: "X. Y. Z.",
      voice: "v",
      language: "en-US",
      pauseBetweenSentencesSec: 1.0,
    });
    expect(r.durationMs).toBeGreaterThan(2000);
  });
});

afterEach(() => {
  delete process.env["CAPTURE_FILE"];
  rmSync(tempDir, { recursive: true, force: true });
});
