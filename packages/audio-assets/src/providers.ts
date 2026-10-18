import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type {
  AssetResult,
  AudioAssetProvider,
  BgmOptions,
  SfxOptions,
} from "./schemas.js";
import { AudioAssetError } from "./schemas.js";

const execFileAsync = promisify(execFile);

/** Audio formats `FileBasedAudioAssetProvider.lookup` accepts. Order matches
 *  the priority of "exact filename match" — the first extension tried is
 *  the file the resolver will hand to ffmpeg without a remux step. */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".m4a",
] as const;

export type AudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];

/** Map an extension to the MIME type `AssetResult.contentType` expects. */
function contentTypeFor(ext: string): AssetResult["contentType"] {
  const lower = ext.toLowerCase();
  if (lower === ".wav") return "audio/wav";
  if (lower === ".mp3") return "audio/mpeg";
  if (lower === ".m4a") return "audio/mp4";
  throw new AudioAssetError(`unsupported extension: ${ext}`, "file-based");
}

/** Probe duration in seconds via ffprobe. Returns null when ffprobe is
 *  unavailable or fails — the caller then falls back to a placeholder
 *  duration. The provider's `durationSec` is advisory (mix plans
 *  re-probe via `bgm-timeline`), so a missing probe must not break
 *  tag resolution. */
async function probeDurationSec(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** Deterministic local-only provider — returns a short synthetic WAV
 * (RIFF header + 1-second silence at 8kHz mono 8-bit) so downstream mixers
 * have valid audio bytes. Use this when no real assets are available —
 * the default `video audio-asset` path. */
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
 * directories. Match rule: try `{tag}.{wav,mp3,m4a}` in order, then
 * fallback to any file in the directory whose name contains the tag.
 * The user is responsible for licensing the assets (recorded on the
 * returned result based on a sibling `{tag}.license.txt` if present).
 *
 * Since v2026-10-18, multi-format support covers `.wav`, `.mp3`, and `.m4a`.
 * The new `assets/bgm/` curated library uses 192 kbps mp3; the project-local
 * `assets/audio-assets/bgm/` previously emitted wav. Both paths resolve
 * transparently via this provider. */
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

    // 1) Exact match — try every supported extension in order; the first
    //    existing file wins. Picking the most-favorable format (wav → mp3
    //    → m4a) keeps the mixer feeding ffmpeg lossless audio when both
    //    formats are on disk for the same tag.
    const tagLc = tag.toLowerCase();
    let chosen: string | null = null;
    for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
      const p = path.join(directory, `${tag}${ext}`);
      if (existsSync(p)) {
        chosen = p;
        break;
      }
    }

    // 2) Substring fallback — any file in the directory whose name
    //    (case-insensitive, without the extension) contains the tag.
    if (!chosen) {
      const entries = readdirSync(directory).filter((f) => {
        const lc = f.toLowerCase();
        if (!SUPPORTED_AUDIO_EXTENSIONS.some((ext) => lc.endsWith(ext))) {
          return false;
        }
        return lc.slice(0, lc.lastIndexOf(".")).includes(tagLc);
      });
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
    const ext = path.extname(chosen).toLowerCase() as AudioExtension;
    const durationSec = (await probeDurationSec(chosen)) ?? statSync(chosen).size;
    return {
      bytes: new Uint8Array(bytes),
      contentType: contentTypeFor(ext),
      durationSec,
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
