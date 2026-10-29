import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { F5TTSProvider, f5ttsStatus, type F5GenConfig } from "./f5tts.js";

// Minimal 24kHz WAV stub — the provider only counts bytes and trusts the
// sidecar JSON for duration, so real audio isn't needed here.
const FAKE_WAV = Buffer.alloc(64, 0xab);

function stubRun(configs: F5GenConfig[]) {
  return async (
    _pythonPath: string,
    _driver: string,
    config: F5GenConfig,
    _timeoutMs: number,
  ): Promise<void> => {
    configs.push(config);
    // 24000 Hz, 24000 frames → exactly 1.0 s
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + 24000, 4);
    header.write("WAVE", 8);
    header.writeUInt32LE(24000, 24);
    header.writeUInt16LE(16, 34);
    writeFileSync(config.out_wav, Buffer.concat([header, FAKE_WAV]));
    writeFileSync(
      config.out_json,
      JSON.stringify({ duration_sec: 1.0, sample_rate: 24000 }),
    );
  };
}

const RESAMPLE_OK = async (_src: string, dst: string) => {
  writeFileSync(dst, "stub24k");
};

function setupDir(dir: string, opts: { refText?: boolean } = {}) {
  mkdirSync(dir, { recursive: true });
  const ref = join(dir, "ref.wav");
  writeFileSync(ref, "stub");
  if (opts.refText !== false) writeFileSync(`${ref.replace(/\.wav$/, "")}.txt`, "参考转写。");
  const other = join(dir, "other.wav");
  writeFileSync(other, "stub");
  writeFileSync(`${other.replace(/\.wav$/, "")}.txt`, "另一个参考。");
  return { ref, other };
}

describe("F5TTSProvider", () => {
  it("spawns the pinned interpreter with the quality baseline (steps=8 rk4) and returns bytes", async () => {
    const dir = join(import.meta.dirname, ".tmp-f5-provider-1");
    const { ref } = setupDir(dir);
    const configs: F5GenConfig[] = [];
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: ref,
      run: stubRun(configs),
      resample: RESAMPLE_OK,
    });
    const r = await p.synthesize({ text: "你好世界。", voice: "narrator-zh", language: "zh-CN" });
    expect(configs).toHaveLength(1);
    // Quality baseline (user A/B 2026-10-25): 6-step rk4 ACCEPTED (w6,
    // RTF 2.16); 4-step midpoint rejected; 8-step rk4 accepted but slower.
    expect(configs[0]!.steps).toBe(6);
    expect(configs[0]!.method).toBe("rk4");
    expect(configs[0]!.text).toBe("你好世界。");
    expect(configs[0]!.ref_audio).toBe(join(workDirOf(configs[0]!), "ref24k.wav"));
    expect(r.durationMs).toBe(1000);
    expect(r.words).toEqual([]);
    expect(r.audio.byteLength).toBeGreaterThan(0);
    expect(existsSync(workDirOf(configs[0]!))).toBe(false); // tmpdir cleaned
  });

  it("uses a per-project reference clip when voice points at a wav", async () => {
    const dir = join(import.meta.dirname, ".tmp-f5-provider-2");
    const { other } = setupDir(dir);
    const configs: F5GenConfig[] = [];
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: join(dir, "missing-default.wav"),
      run: stubRun(configs),
      resample: RESAMPLE_OK,
    });
    await p.synthesize({ text: "x", voice: other, language: "zh-CN" });
    expect(configs[0]!.ref_text).toBe("另一个参考。");
    // workdir is cleaned inside synthesize — routing is proven by the
    // sidecar text landing in the config alone.
  });

  it("throws TTSError when the reference transcript is missing", async () => {
    const dir = join(import.meta.dirname, ".tmp-f5-provider-3");
    mkdirSync(dir, { recursive: true });
    const ref = join(dir, "ref.wav");
    writeFileSync(ref, "stub"); // no .txt sidecar
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: ref,
      run: stubRun([]),
      resample: RESAMPLE_OK,
    });
    await expect(
      p.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/reference transcript missing/);
  });

  it("wraps a failed synthesis run in TTSError", async () => {
    const dir = join(import.meta.dirname, ".tmp-f5-provider-4");
    const { ref } = setupDir(dir);
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: ref,
      run: async () => {
        throw new Error("exit 1: OOM in mlx");
      },
      resample: RESAMPLE_OK,
    });
    await expect(
      p.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/F5-TTS synthesis failed.*OOM in mlx/);
  });
});

describe("f5ttsStatus", () => {
  it("reports unavailable when the interpreter is missing", async () => {
    const s = await f5ttsStatus({
      pythonPath: "/tmp/no-such-python",
      refAudioPath: "/tmp/no-such-ref.wav",
    });
    expect(s.available).toBe(false);
    expect(s.reason).toContain("interpreter missing");
  });

  it("reports unavailable when the package import fails", async () => {
    const { ref } = setupDir(join(import.meta.dirname, ".tmp-f5-status"));
    const s = await f5ttsStatus({
      // must exist — the static checks run before the import probe
      pythonPath: process.env.F5TTS_PYTHON ?? join(process.env.HOME ?? "", ".venvs/f5tts/bin/python"),
      refAudioPath: ref,
      run: async () => {
        throw new Error("import probe exit 1: ModuleNotFoundError");
      },
    });
    expect(s.available).toBe(false);
    expect(s.reason).toContain("ModuleNotFoundError");
  });
});

/** The provider's tmpdir is in the config — recover it for assertions. */
function workDirOf(config: F5GenConfig): string {
  return join(config.out_wav, "..");
}

/**
 * The default (non-injected) code paths: the provider really spawns the
 * interpreter and really calls ffmpeg. The tests below point those
 * spawns at local stand-ins so the branch logic — argument passing,
 * stdin contract, exit-code handling — is verified offline.
 */
describe("F5TTSProvider — default python runner", () => {
  // A temp dir, not the package directory: the fixtures must not
  // litter the source tree.
  const dir = join(tmpdir(), `vf-f5-default-${process.pid}`);

  /** A stand-in for the F5 interpreter: reads the config JSON on stdin
   *  and writes the two files the driver promises. */
  function writeFakePython(): string {
    mkdirSync(dir, { recursive: true });
    const worker = join(dir, "worker.cjs");
    writeFileSync(
      worker,
      [
        "const chunks = [];",
        "process.stdin.on('data', (d) => chunks.push(d));",
        "process.stdin.on('end', () => {",
        "  const cfg = JSON.parse(Buffer.concat(chunks).toString());",
        "  require('node:fs').writeFileSync(cfg.out_wav, Buffer.alloc(64, 1));",
        "  require('node:fs').writeFileSync(cfg.out_json, JSON.stringify({ duration_sec: 2.5, sample_rate: 24000 }));",
        "});",
      ].join("\n"),
      "utf8",
    );
    const shim = join(dir, "fake-python.sh");
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${process.execPath} ${worker}\n`,
      "utf8",
    );
    chmodSync(shim, 0o755);
    return shim;
  }

  /** A real 24 kHz WAV — the default resample runs ffmpeg on it. */
  function writeRealWav(target: string): void {
    mkdirSync(dir, { recursive: true });
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.2",
      "-ar",
      "24000",
      "-ac",
      "1",
      target,
    ]);
    writeFileSync(target.replace(/\.wav$/, ".txt"), "参考转写。", "utf8");
  }

  it("synthesizes through the real python runner and the real ffmpeg resample", async () => {
    const pythonPath = writeFakePython();
    const ref = join(dir, "ref.wav");
    writeRealWav(ref);
    const p = new F5TTSProvider({ pythonPath, refAudioPath: ref });
    const r = await p.synthesize({
      text: "你好世界。",
      voice: "narrator-zh",
      language: "zh-CN",
    });
    expect(r.audio.byteLength).toBe(64);
    expect(r.durationMs).toBe(2500);
    expect(r.words).toEqual([]);
  });

  it("reports a reference clip ffmpeg cannot decode", async () => {
    const pythonPath = writeFakePython();
    const ref = join(dir, "broken.wav");
    mkdirSync(dir, { recursive: true });
    writeFileSync(ref, "not a wav at all");
    writeFileSync(ref.replace(/\.wav$/, ".txt"), "参考转写。", "utf8");
    const p = new F5TTSProvider({ pythonPath, refAudioPath: ref });
    await expect(
      p.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/reference resample failed/);
  });

  it("rejects empty narration text before spawning anything", async () => {
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: join(dir, "ref.wav"),
    });
    await expect(
      p.synthesize({ text: "   ", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/empty narration text/);
  });

  it("reports a missing reference clip", async () => {
    const p = new F5TTSProvider({
      pythonPath: "/tmp/fake-python",
      refAudioPath: join(dir, "no-such-ref.wav"),
    });
    await expect(
      p.synthesize({ text: "x", voice: "narrator-zh", language: "zh-CN" }),
    ).rejects.toThrow(/reference clip missing/);
  });
});

describe("f5ttsStatus — default probe runner", () => {
  it("reports unavailable when the reference transcript is missing", async () => {
    const dir = join(tmpdir(), `vf-f5-status-2-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const ref = join(dir, "ref.wav");
    writeFileSync(ref, "stub"); // no .txt sidecar
    const s = await f5ttsStatus({
      pythonPath: process.execPath,
      refAudioPath: ref,
    });
    expect(s.available).toBe(false);
    expect(s.reason).toContain("reference clip/transcript missing");
  });

  it("reports available when the interpreter imports the package", async () => {
    const dir = join(tmpdir(), `vf-f5-status-3-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const ref = join(dir, "ref.wav");
    writeFileSync(ref, "stub");
    writeFileSync(ref.replace(/\.wav$/, ".txt"), "参考转写。", "utf8");
    // A stand-in interpreter that exits 0 — the import probe passes.
    const shim = join(dir, "probe-python.sh");
    writeFileSync(shim, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(shim, 0o755);
    const s = await f5ttsStatus({ pythonPath: shim, refAudioPath: ref });
    expect(s.available).toBe(true);
    expect(s.refAudio).toBe(ref);
    expect(s.refText).toBe(ref.replace(/\.wav$/, ".txt"));
  });

  it("reports the import failure when the probe exits non-zero", async () => {
    const dir = join(tmpdir(), `vf-f5-status-4-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const ref = join(dir, "ref.wav");
    writeFileSync(ref, "stub");
    writeFileSync(ref.replace(/\.wav$/, ".txt"), "参考转写。", "utf8");
    const shim = join(dir, "broken-python.sh");
    writeFileSync(
      shim,
      "#!/bin/sh\necho 'ModuleNotFoundError' >&2\nexit 1\n",
      "utf8",
    );
    chmodSync(shim, 0o755);
    const s = await f5ttsStatus({ pythonPath: shim, refAudioPath: ref });
    expect(s.available).toBe(false);
    expect(s.reason).toContain("import probe exit 1");
  });
});
