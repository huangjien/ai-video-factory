import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { FakeTTSProvider, type TTSProvider } from "@vf/tts";
import { resolveProjectDir } from "./project-path.js";

const execFileAsync = promisify(execFile);

export interface AudioOptions {
  cwd?: string | undefined;
  project: string;
  /** Force fake provider (no network). */
  fake?: boolean | undefined;
}

// Default: male narration voices. Female alternatives: zh-CN-XiaoxiaoNeural,
// en-US-AriaNeural.
const ZH_VOICE = "zh-CN-YunjianNeural";
const EN_VOICE = "en-US-ChristopherNeural";

/** Run ffmpeg to convert mp3 bytes (from TTS) to 44.1kHz mono WAV. Pads to
 * `minDurationSec` if the TTS is shorter; never truncates if it's longer.
 * (Truncating used to chop off long narrations mid-sentence.) */
async function mp3ToWav(
  mp3Bytes: Uint8Array,
  minDurationSec: number,
): Promise<Uint8Array> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "vf-tts-"));
  try {
    const inPath = path.join(dir, "in.mp3");
    const outPath = path.join(dir, "out.wav");
    await writeFile(inPath, mp3Bytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-af",
      `apad=pad_dur=${minDurationSec}`,
      outPath,
    ]);
    const { readFile } = await import("node:fs/promises");
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runAudio(opts: AudioOptions): Promise<number> {
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const scriptPath = path.join(projectRoot, "script", "script.zh-CN.md");
  // Allow en-US too
  const enPath = path.join(projectRoot, "script", "script.en-US.md");
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const language: "zh-CN" | "en-US" =
    existsSync(enPath) && !existsSync(scriptPath) ? "en-US" : "zh-CN";
  const activeScript = language === "en-US" ? enPath : scriptPath;
  if (!existsSync(sbPath)) {
    console.error(`storyboard not found: ${sbPath}`);
    return 1;
  }
  if (!existsSync(activeScript)) {
    console.error(
      `script not found: ${activeScript} — run "vf script <topic>" first`,
    );
    return 1;
  }

  const sbYaml = await readFile(sbPath, "utf8");
  const sbParsed = parseYaml(sbYaml) as {
    scenes?: { id: string; duration: number; narration?: { text: string } }[];
  };
  const scenes = sbParsed.scenes ?? [];
  if (scenes.length === 0) {
    console.error(`storyboard has no scenes: ${sbPath}`);
    return 1;
  }

  // Parse script — split by `## <section>` headings, map to scenes in order
  const scriptText = await readFile(activeScript, "utf8");
  const sections = parseScriptSections(scriptText);
  // Naive 1:1 mapping: scene i gets sections[i] (or last section if i >= sections.length)
  const sceneNarrations: { sceneId: string; text: string; duration: number }[] =
    scenes.map((s, i) => {
      const sectionText = sections[i] ?? sections[sections.length - 1] ?? "";
      return {
        sceneId: s.id,
        text: s.narration?.text || sectionText || "",
        duration: s.duration,
      };
    });

  const provider: TTSProvider = opts.fake
    ? new FakeTTSProvider({ sampleBytes: 256 })
    : new (await import("@vf/tts")).EdgeTTSProvider();
  const voice = language === "en-US" ? EN_VOICE : ZH_VOICE;

  await mkdir(path.join(projectRoot, "assets", "audio"), { recursive: true });
  await mkdir(path.join(projectRoot, "captions"), { recursive: true });

  let totalActualMs = 0;
  for (const scene of sceneNarrations) {
    if (!scene.text) {
      // No narration — skip (keep existing anullsrc placeholder behavior untouched)
      continue;
    }
    try {
      const result = await provider.synthesize({
        text: scene.text,
        voice,
        language,
      });
      // If the provider returned WAV bytes already (e.g. FakeTTSProvider for
      // tests), write them as-is. Otherwise treat as MP3 and convert to WAV
      // at the scene's exact duration via ffmpeg.
      const isWav =
        result.audio.length >= 12 &&
        result.audio[0] === 0x52 && // R
        result.audio[1] === 0x49 && // I
        result.audio[2] === 0x46 && // F
        result.audio[3] === 0x46; // F
      const wavBytes = isWav
        ? result.audio
        : await mp3ToWav(result.audio, scene.duration);
      await writeFile(
        path.join(projectRoot, "assets", "audio", `${scene.sceneId}.wav`),
        wavBytes,
      );
      totalActualMs += result.durationMs;
    } catch (err) {
      console.error(
        `TTS failed for ${scene.sceneId}: ${(err as Error).message}`,
      );
      return 1;
    }
  }

  // Write a minimal SRT — one cue per scene at its start time
  const srtPath = path.join(projectRoot, "captions", `${language}.srt`);
  const srtLines = scenes.map((s, i) => {
    const start = scenes.slice(0, i).reduce((acc, x) => acc + x.duration, 0);
    const end = start + s.duration;
    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600)
        .toString()
        .padStart(2, "0");
      const m = Math.floor((sec % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const s2 = Math.floor(sec % 60)
        .toString()
        .padStart(2, "0");
      const ms = Math.round((sec - Math.floor(sec)) * 1000)
        .toString()
        .padStart(3, "0");
      return `${h}:${m}:${s2},${ms}`;
    };
    const narration = s.narration?.text ?? "";
    return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${narration}\n`;
  });
  await writeFile(srtPath, srtLines.join("\n"), "utf8");

  // Run record (provider/tool/prompt_hash/tokens absent — no LLM, just TTS)
  const runId = `tts-${new Date().toISOString().replace(/\.\d+Z$/, "Z")}-${Math.floor(
    Math.random() * 1000,
  )
    .toString()
    .padStart(3, "0")}`;
  const record = {
    run_id: runId,
    stage: "audio",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: provider.name,
    input_commit: safeGitHead(projectRoot),
    input_files: ["storyboard/storyboard.yaml", `script/script.${language}.md`],
    output_files: ["captions/" + `${language}.srt`, "assets/audio/scene-*.wav"],
    created_at: new Date().toISOString(),
    duration_ms: totalActualMs,
    provider: provider.name,
    model: voice,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@vf/workflow");
  await writeRun(projectRoot, record);

  console.log(
    `\u2713 generated audio for ${sceneNarrations.filter((s) => s.text).length}/${scenes.length} scenes`,
  );
  console.log(
    `  provider=${provider.name}  voice=${voice}  srt=captions/${language}.srt`,
  );
  console.log(
    `  next: \`vf preview\` will pick up the real audio automatically`,
  );
  return 0;
}

/** Parse a script Markdown into ordered sections by `## <heading>`. */
function parseScriptSections(scriptText: string): string[] {
  const sections: string[] = [];
  const lines = scriptText.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current.length > 0) sections.push(current.join(" ").trim());
      current = [];
    } else if (line.trim() && !line.startsWith("# ")) {
      current.push(line.trim());
    }
  }
  if (current.length > 0) sections.push(current.join(" ").trim());
  return sections;
}
