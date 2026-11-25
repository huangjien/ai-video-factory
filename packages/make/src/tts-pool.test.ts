import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  synthesizeSceneAudio,
  type SceneAudioParams,
  type SceneAudioResult,
} from "./index.js";
import {
  TTSError,
  type TTSProvider,
  type TTSRequest,
  type TTSResult,
} from "@video/tts";
import type { TtsScene } from "./tts-cache.js";

/** A promise the test completes by hand. The package's TS lib is ES2022,
 *  so `Promise.withResolvers` (ES2024) is unavailable and the executor
 *  form is the only way. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A RIFF-shaped payload: the cache path writes WAV bytes as they are. */
const wav = (marker: number): Uint8Array =>
  new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0x10,
    0,
    0,
    0,
    0x57,
    0x41,
    0x56,
    0x45,
    marker,
  ]);

/** A provider that never completes a call on its own: the TEST decides
 *  when each call starts being counted, finishes, or fails. No timers, so
 *  the pool's order and width are observed rather than raced. */
class ProbeTTSProvider implements TTSProvider {
  readonly started: string[] = [];
  readonly finished: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly waiting = new Map<string, Deferred<TTSResult>[]>();
  private startWaiters: { n: number; resolve: () => void }[] = [];
  constructor(readonly name: string) {}

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const key = req.text;
    this.started.push(key);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.startWaiters = this.startWaiters.filter((waiter) => {
      if (this.started.length < waiter.n) return true;
      waiter.resolve();
      return false;
    });
    const call = deferred<TTSResult>();
    this.waiting.set(key, [...(this.waiting.get(key) ?? []), call]);
    try {
      return await call.promise;
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Resolves once `n` calls have started. */
  whenStarted(n: number): Promise<void> {
    if (this.started.length >= n) return Promise.resolve();
    // ES2022 lib — see deferred().
    return new Promise<void>((resolve) => {
      this.startWaiters.push({ n, resolve });
    });
  }

  /** Completes the oldest pending call for a scene. */
  finish(key: string, speechMs = 1000): void {
    const call = this.waiting.get(key)?.shift();
    if (call === undefined) throw new Error(`no pending call for ${key}`);
    this.finished.push(key);
    call.resolve({ audio: wav(1), durationMs: speechMs, words: [] });
  }

  fail(key: string, error: Error): void {
    const call = this.waiting.get(key)?.shift();
    if (call === undefined) throw new Error(`no pending call for ${key}`);
    call.reject(error);
  }
}

const scene = (n: number): TtsScene => ({
  id: `scene_${n}`,
  narration: `第${n}句旁白`,
  durationSec: 10,
});
const text = (n: number): string => `第${n}句旁白`;
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `scene_${i + 1}`);
const six = [1, 2, 3, 4, 5, 6].map(scene);

/** Drives a whole run to completion by finishing every call in scene
 *  order, whatever the pool width. */
async function runToCompletion(
  args: SceneAudioParams,
  provider: ProbeTTSProvider,
  scenes: number,
): Promise<SceneAudioResult> {
  const run = synthesizeSceneAudio(args);
  for (let n = 1; n <= scenes; n++) {
    await provider.whenStarted(n);
    provider.finish(text(n), n * 100);
  }
  return run;
}

describe("synthesizeSceneAudio — the scene pool", () => {
  let root: string;
  let savedPool: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-tts-pool-"));
    savedPool = process.env["TTS_POOL"];
    delete process.env["TTS_POOL"];
  });

  afterEach(async () => {
    process.env["TTS_POOL"] = savedPool;
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("keeps four calls in flight for a remote provider, and returns SCENE order however they finished", async () => {
    const provider = new ProbeTTSProvider("minimax-tts");
    const events: string[] = [];
    const run = synthesizeSceneAudio({
      projectRoot: root,
      scenes: six,
      provider,
      voice: "v",
      language: "zh-CN",
      onEvent: (e) => events.push(`${e.kind}:${e.label ?? ""}`),
    });
    await provider.whenStarted(4);
    provider.finish(text(4), 400);
    provider.finish(text(3), 300);
    await provider.whenStarted(5);
    provider.finish(text(2), 200);
    provider.finish(text(1), 100);
    await provider.whenStarted(6);
    provider.finish(text(6), 600);
    provider.finish(text(5), 500);
    const out = await run;

    // Jobs are pulled in scene order; completion is whatever the test did.
    expect(provider.started).toEqual(six.map((s) => s.narration));
    expect(provider.finished).toEqual([4, 3, 2, 1, 6, 5].map(text));
    expect(provider.maxInFlight).toBe(4);
    expect(out.synthesized).toEqual(ids(6));
    expect(out.outputs).toEqual(ids(6).map((id) => `assets/audio/${id}.wav`));
    expect(out.cached).toEqual([]);
    // Speech lengths are summed per scene, not per finish.
    expect(out.totalDurationMs).toBe(21 * 100);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(events).toContain(`start:tts scene_${n}`);
      expect(events).toContain(`done:tts scene_${n}`);
    }
  });

  it("keeps a local model server serial", async () => {
    const provider = new ProbeTTSProvider("voicebox");
    await runToCompletion(
      {
        projectRoot: root,
        scenes: six,
        provider,
        voice: "v",
        language: "zh-CN",
      },
      provider,
      6,
    );
    expect(provider.maxInFlight).toBe(1);
    expect(provider.started).toEqual(six.map((s) => s.narration));
  });

  it("lets TTS_POOL override the width", async () => {
    process.env["TTS_POOL"] = "2";
    const provider = new ProbeTTSProvider("minimax-tts");
    await runToCompletion(
      {
        projectRoot: root,
        scenes: six,
        provider,
        voice: "v",
        language: "zh-CN",
      },
      provider,
      6,
    );
    expect(provider.maxInFlight).toBe(2);
  });

  it("a cached scene is neither called nor reported as synthesized", async () => {
    const provider = new ProbeTTSProvider("minimax-tts");
    const args = {
      projectRoot: root,
      scenes: six,
      provider,
      voice: "v",
      language: "zh-CN",
    };
    await runToCompletion(args, provider, 6);
    const again = await synthesizeSceneAudio(args);
    expect(provider.started).toHaveLength(6);
    expect(again.synthesized).toEqual([]);
    expect(again.cached).toEqual(ids(6));
    expect(again.outputs).toEqual([]);
  });

  it("a scene with nothing to say is left alone", async () => {
    const provider = new ProbeTTSProvider("minimax-tts");
    const run = synthesizeSceneAudio({
      projectRoot: root,
      scenes: [{ id: "scene_1", narration: "", durationSec: 10 }, scene(2)],
      provider,
      voice: "v",
      language: "zh-CN",
    });
    // Scene 1 is skipped before any call: the FIRST call is scene 2's.
    await provider.whenStarted(1);
    expect(provider.started).toEqual([text(2)]);
    provider.finish(text(2));
    const out = await run;
    expect(provider.started).toEqual([text(2)]);
    expect(out.synthesized).toEqual(["scene_2"]);
    expect(out.outputs).toEqual(["assets/audio/scene_2.wav"]);
  });

  it("a rate-limited call is retried — both spellings of the limit", async () => {
    vi.useFakeTimers();
    const provider = new ProbeTTSProvider("minimax-tts");
    const run = synthesizeSceneAudio({
      projectRoot: root,
      scenes: [scene(2), scene(3)],
      provider,
      voice: "v",
      language: "zh-CN",
    });
    await provider.whenStarted(2);
    provider.fail(
      text(2),
      new TTSError("MiniMax T2A HTTP 429", "minimax-tts", 429),
    );
    provider.fail(
      text(3),
      new TTSError("MiniMax T2A error 1002", "minimax-tts", 1002),
    );
    // The retry waits out withRetry's first backoff — drive the clock.
    await vi.advanceTimersByTimeAsync(1000);
    await provider.whenStarted(4);
    provider.finish(text(2));
    provider.finish(text(3));
    const out = await run;
    expect(provider.started).toEqual([text(2), text(3), text(2), text(3)]);
    expect(out.synthesized).toEqual(["scene_2", "scene_3"]);
  });

  it("drains active work after a failure without starting another scene", async () => {
    const provider = new ProbeTTSProvider("minimax-tts");
    vi.stubEnv("TTS_POOL", "2");
    const run = synthesizeSceneAudio({
      projectRoot: root,
      scenes: [scene(1), scene(2), scene(3)],
      provider,
      voice: "v",
      language: "zh-CN",
    });
    const settled = vi.fn();
    const failure = run.catch(settled);
    await provider.whenStarted(2);
    provider.fail(
      text(2),
      new TTSError("MiniMax T2A error 1004: auth", "minimax-tts", 1004),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledEarly = settled.mock.calls.length;
    provider.finish(text(1));
    await failure;
    expect({
      settledEarly,
      started: provider.started,
      error: settled.mock.calls[0]?.[0]?.message,
    }).toEqual({
      settledEarly: 0,
      started: [text(1), text(2)],
      error: expect.stringContaining("1004"),
    });
  });
});
