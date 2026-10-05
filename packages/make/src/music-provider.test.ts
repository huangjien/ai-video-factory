import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAudioAssets } from "./index.js";
import { AudioAssetError } from "@video/audio-assets";

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);

/** Stub MiniMax provider: fails for the "boom" tag, succeeds otherwise. */
const stubProvider = {
  pickBackgroundMusic: async ({ tag }: { tag?: string }) => {
    if (tag === "boom") {
      throw new AudioAssetError("quota exceeded", "minimax-music");
    }
    return {
      bytes: new Uint8Array(FAKE_MP3),
      contentType: "audio/mpeg" as const,
      durationSec: 60,
      license: "MiniMax generated (test)",
      source: `minimax://music-01/${tag}`,
    };
  },
};

describe("runAudioAssets — minimax music generation", () => {
  it("generates named bgm tags via the minimax provider", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "make-music-"));
    try {
      const outputs = await runAudioAssets(
        dir,
        { bgm: "liubang-xiaodiao" },
        { musicProvider: "minimax", minimaxProvider: stubProvider },
      );
      expect(outputs[0]).toContain("minimax://music-01/liubang-xiaodiao");
      const bytes = await readFile(
        path.join(dir, "assets", "audio-assets", "bgm", "liubang-xiaodiao.wav"),
      );
      expect(bytes.equals(FAKE_MP3)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("generates named bgm_tracks tags too, and skips path-shaped tracks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "make-music-"));
    try {
      const outputs = await runAudioAssets(
        dir,
        {
          bgm_tracks: [
            { track: "liubang-xiaodiao", until_sec: 18 },
            { track: "assets/brand/fanzhuan.mp3" },
          ],
        },
        { musicProvider: "minimax", minimaxProvider: stubProvider },
      );
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toContain("liubang-xiaodiao");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to mock when generation fails — pipeline keeps moving", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "make-music-"));
    try {
      const outputs = await runAudioAssets(
        dir,
        { bgm: "boom" },
        { musicProvider: "minimax", minimaxProvider: stubProvider },
      );
      expect(outputs[0]).toContain("mock://silence");
      const bytes = await readFile(
        path.join(dir, "assets", "audio-assets", "bgm", "boom.wav"),
      );
      expect(bytes.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("idempotent: existing files are not regenerated", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "make-music-"));
    try {
      await runAudioAssets(
        dir,
        { bgm: "calm" },
        { musicProvider: "minimax", minimaxProvider: stubProvider },
      );
      const outputs = await runAudioAssets(
        dir,
        { bgm: "calm" },
        { musicProvider: "minimax", minimaxProvider: stubProvider },
      );
      expect(outputs).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
