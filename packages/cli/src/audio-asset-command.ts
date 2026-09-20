import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  FileBasedAudioAssetProvider,
  type AudioAssetProvider,
} from "@vf/audio-assets";
import { formatRunId } from "@vf/workflow";

export interface AudioAssetOptions {
  project: string;
  cwd?: string | undefined;
  /** Which BGM to pick — tag (mock) or filename without extension (file-based). */
  bgmTag?: string | undefined;
  /** Which SFX to pick — required for `pick`. */
  sfxTag?: string | undefined;
  /** file-based provider config (when set, picks from real files instead of mock). */
  bgmDir?: string | undefined;
  sfxDir?: string | undefined;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function pickProvider(opts: AudioAssetOptions): AudioAssetProvider {
  if (opts.bgmDir && opts.sfxDir) {
    return new FileBasedAudioAssetProvider({
      bgmDirectory: opts.bgmDir,
      sfxDirectory: opts.sfxDir,
    });
  }
  // Mock fallback — no network, deterministic placeholder WAV.
  return {
    name: "mock",
    async pickBackgroundMusic(opts) {
      const { MockAudioAssetProvider } = await import("@vf/audio-assets");
      return new MockAudioAssetProvider().pickBackgroundMusic(opts);
    },
    async pickSoundEffect(opts) {
      const { MockAudioAssetProvider } = await import("@vf/audio-assets");
      return new MockAudioAssetProvider().pickSoundEffect(opts);
    },
  };
}

async function writeAsset(
  projectRoot: string,
  kind: "bgm" | "sfx",
  tag: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = path.join(projectRoot, "assets", "audio-assets", kind);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${tag}.wav`);
  await writeFile(file, bytes);
  return file;
}

export async function runAudioAsset(opts: AudioAssetOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectRoot = path.join(cwd, "projects", opts.project);
  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    return 1;
  }
  if (!opts.bgmTag && !opts.sfxTag) {
    console.error("specify --bgm <tag> and/or --sfx <tag>");
    return 1;
  }
  const provider = pickProvider(opts);
  const providerName = provider.name;
  try {
    if (opts.bgmTag) {
      const r = await provider.pickBackgroundMusic({ tag: opts.bgmTag });
      const file = await writeAsset(projectRoot, "bgm", opts.bgmTag, r.bytes);
      bgmOut = `${file} (${r.bytes.byteLength} bytes, ${r.durationSec}s, ${r.license})`;
    }
    if (opts.sfxTag) {
      const r = await provider.pickSoundEffect({ tag: opts.sfxTag });
      const file = await writeAsset(projectRoot, "sfx", opts.sfxTag, r.bytes);
      sfxOut = `${file} (${r.bytes.byteLength} bytes, ${r.durationSec}s, ${r.license})`;
    }
  } catch (err) {
    console.error(`\u2717 ${providerName} asset generation failed:`, (err as Error).message);
    return 1;
  }

  // Run record
  const runId = formatRunId("audio-asset");
  const promptHash =
    "sha256:" +
    createHash("sha256")
      .update(`bgm=${opts.bgmTag ?? ""}|sfx=${opts.sfxTag ?? ""}|provider=${providerName}`)
      .digest("hex");
  const record = {
    run_id: runId,
    stage: "audio-asset",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: providerName,
    input_commit: safeGitHead(projectRoot),
    input_files: [],
    output_files: [
      opts.bgmTag ? `assets/audio-assets/bgm/${opts.bgmTag}.wav` : "",
      opts.sfxTag ? `assets/audio-assets/sfx/${opts.sfxTag}.wav` : "",
    ].filter((f) => f.length > 0),
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: providerName,
    model: "audio-asset",
    prompt_hash: promptHash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 added audio assets for ${opts.project}`);
  console.log(`  provider=${providerName}`);
  if (opts.bgmTag) console.log(`  bgm: ${bgmOut}`);
  if (opts.sfxTag) console.log(`  sfx: ${sfxOut}`);
  console.log(`  next: reference these in your storyboard / pipeline (mixing into final audio is a separate phase)`);
  return 0;
}
