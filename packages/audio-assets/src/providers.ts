import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  AudioAssetProvider,
  BgmOptions,
  SfxOptions,
  AssetResult,
} from "./schemas.js";
import { AudioAssetError } from "./schemas.js";

/** Deterministic local-only provider — returns a short synthetic WAV
 * (RIFF header + 1-second silence at 8kHz mono 8-bit) so downstream mixers
 * have valid audio bytes. Use this when no real assets are available —
 * the default `vf audio-asset` path. */
export class MockAudioAssetProvider implements AudioAssetProvider {
  readonly name = "mock";

  private toAssetBytes(src: Uint8Array): Uint8Array {
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out;
  }

  async pickBackgroundMusic(_opts?: BgmOptions): Promise<AssetResult> {
    return {
      bytes: this.toAssetBytes(silentWav(1)),
      contentType: "audio/wav",
      durationSec: 1,
      license: "CC0 (mock placeholder)",
      source: "mock://silence/1s",
    };
  }

  async pickSoundEffect(_opts: SfxOptions): Promise<AssetResult> {
    if (!_opts.tag) {
      throw new AudioAssetError("SFX tag is required", this.name);
    }
    return {
      bytes: this.toAssetBytes(silentWav(1)),
      contentType: "audio/wav",
      durationSec: 1,
      license: "CC0 (mock placeholder)",
      source: `mock://silence/${_opts.tag}`,
    };
  }
}

/** Real-files provider — looks up tag-named files in user-configured
 * directories. Match rule: exact filename `{tag}.wav` (case-insensitive),
 * then fallback to any file whose name contains the tag. The user is
 * responsible for licensing the assets (recorded on the returned result
 * based on a sibling `{tag}.license.txt` if present). */
export class FileBasedAudioAssetProvider implements AudioAssetProvider {
  readonly name = "file-based";
  private readonly bgmDirectory: string;
  private readonly sfxDirectory: string;

  constructor(opts: { bgmDirectory?: string; sfxDirectory?: string }) {
    if (!opts.bgmDirectory || !opts.sfxDirectory) {
      throw new AudioAssetError(
        "FileBasedAudioAssetProvider requires both bgmDirectory and sfxDirectory",
        "file-based",
      );
    }
    this.bgmDirectory = opts.bgmDirectory;
    this.sfxDirectory = opts.sfxDirectory;
  }

  async pickBackgroundMusic(opts?: BgmOptions): Promise<AssetResult> {
    return this.lookup(this.bgmDirectory, opts?.tag ?? "default", "bgm");
  }

  async pickSoundEffect(opts: SfxOptions): Promise<AssetResult> {
    return this.lookup(this.sfxDirectory, opts.tag, "sfx");
  }

  private async lookup(
    directory: string,
    tag: string,
    kind: string,
  ): Promise<AssetResult> {
    if (!existsSync(directory)) {
      throw new AudioAssetError(
        `${kind} directory not found: ${directory}`,
        this.name,
      );
    }
    const exact = path.join(directory, `${tag}.wav`);
    let chosen = exact;
    if (!existsSync(exact)) {
      const entries = readdirSync(directory).filter(
        (f) =>
          f.toLowerCase().includes(tag.toLowerCase()) &&
          f.toLowerCase().endsWith(".wav"),
      );
      if (entries.length === 0) {
        throw new AudioAssetError(
          `${kind} tag "${tag}" not found in ${directory}`,
          this.name,
        );
      }
      chosen = path.join(directory, entries[0] ?? "");
    }
    const bytes = readFileSync(chosen);
    const license = readLicense(directory, tag);
    return {
      bytes: new Uint8Array(bytes),
      contentType: "audio/wav",
      durationSec: 1,
      license,
      source: chosen,
    };
  }
}

function readLicense(directory: string, tag: string): string {
  try {
    const text = readFileSync(
      path.join(directory, `${tag}.license.txt`),
      "utf8",
    );
    return text.trim();
  } catch {
    return "user-provided (no license file found)";
  }
}

/** Minimal valid WAV: RIFF header + 1 second of 8 kHz mono 8-bit silence. */
function silentWav(seconds: number): Uint8Array {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const dataSize = samples;
  const fileSize = 36 + dataSize;
  const buf = new Uint8Array(8 + fileSize);
  const view = new DataView(buf.buffer);
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, fileSize, true);
  buf.set([0x57, 0x41, 0x56, 0x45], 8);
  buf.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  buf.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples; i++) buf[44 + i] = 0x80; // 8-bit silence = 0x80 (centered)
  return buf;
}
