import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  MiniMaxMusicProvider,
  MUSIC_PROMPTS,
} from "./minimax-music.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// Four bytes of MP3-frame-looking payload, hex-encoded like the API returns.
const HEX_AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString("hex");

describe("MiniMaxMusicProvider (music-01)", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastBody: string | undefined;
  let statusToSend = 200;
  let failRemaining = 0;
  let responseBody: unknown = {
    data: { audio: HEX_AUDIO },
    base_resp: { status_code: 0, status_msg: "success" },
  };
  let requestCount = 0;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        requestCount += 1;
        if (failRemaining > 0) {
          failRemaining -= 1;
          res.statusCode = 500;
        } else {
          res.statusCode = statusToSend;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("sends Bearer auth + model music-01 + mp3 audio_setting, decodes hex audio", async () => {
    process.env["MINIMAX_API_KEY"] = "test-key";
    requestCount = 0;
    const p = new MiniMaxMusicProvider({ apiHost: baseUrl });
    const r = await p.pickBackgroundMusic({ tag: "liubang-xiaodiao" });
    expect(lastAuth).toBe("Bearer test-key");
    const body = JSON.parse(lastBody!) as {
      model: string;
      prompt: string;
      audio_setting: { sample_rate: number; bitrate: number; format: string };
    };
    expect(body.model).toBe("music-01");
    expect(body.prompt).toBe(MUSIC_PROMPTS["liubang-xiaodiao"]);
    expect(body.audio_setting.format).toBe("mp3");
    expect(body.audio_setting.sample_rate).toBe(44100);
    expect(r.contentType).toBe("audio/mpeg");
    expect(Buffer.from(r.bytes).equals(Buffer.from(HEX_AUDIO, "hex"))).toBe(true);
    expect(r.source).toContain("liubang-xiaodiao");
    expect(requestCount).toBe(1);
  });

  it("falls back to the raw tag as prompt for unknown tags", async () => {
    const p = new MiniMaxMusicProvider({ apiHost: baseUrl });
    await p.pickBackgroundMusic({ tag: "lofi-rain" });
    const body = JSON.parse(lastBody!) as { prompt: string };
    expect(body.prompt).toBe("lofi rain");
  });

  it("throws AudioAssetError without retrying on envelope errors (quota/auth)", async () => {
    responseBody = {
      data: null,
      base_resp: { status_code: 2056, status_msg: "quota exceeded" },
    };
    requestCount = 0;
    const p = new MiniMaxMusicProvider({ apiHost: baseUrl, retrySleeps: [1, 1] });
    await expect(p.pickBackgroundMusic({ tag: "calm" })).rejects.toThrow(
      /envelope error 2056/,
    );
    expect(requestCount).toBe(1);
    responseBody = {
      data: { audio: HEX_AUDIO },
      base_resp: { status_code: 0, status_msg: "success" },
    };
  });

  it("retries transient 5xx then succeeds", async () => {
    requestCount = 0;
    failRemaining = 2; // first two attempts get 500, third succeeds
    const p = new MiniMaxMusicProvider({ apiHost: baseUrl, retrySleeps: [1, 1] });
    try {
      const r = await p.pickBackgroundMusic({ tag: "calm" });
      expect(r.bytes.length).toBeGreaterThan(0);
      expect(requestCount).toBe(3);
    } finally {
      failRemaining = 0;
    }
  });

  it("refuses SFX — the music API does not cover short effects", async () => {
    const p = new MiniMaxMusicProvider({ apiHost: baseUrl });
    await expect(p.pickSoundEffect({ tag: "whoosh" })).rejects.toThrow(
      /BGM only/,
    );
  });
});
