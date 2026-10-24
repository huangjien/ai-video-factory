import type { Command } from "commander";
import { execSync } from "node:child_process";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { FakeTTSProvider, type TTSProvider } from "@video/tts";
import { syncSceneDurations } from "@video/media";
import {
  EN_VOICE,
  synthesizeSceneAudio,
  writeCaptionsSrt,
  ZH_VOICE,
} from "@video/make";
import { formatRunId } from "@video/workflow";
import { resolveProjectDir } from "./project-path.js";
import { assertStageWritable } from "./stage-guard.js";
import { formatProgressEvent } from "./ui.js";

export interface AudioOptions {
  cwd?: string | undefined;
  project: string;
  /** Force fake provider (no network). */
  fake?: boolean | undefined;
  /** Overwrite a human-approved storyboard's audio without the guard. */
  force?: boolean | undefined;
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
  if (!(await assertStageWritable(projectRoot, "audio", opts.force === true))) {
    return 1;
  }
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
      `script not found: ${activeScript} — run "video script <topic>" first`,
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
    : new (await import("@video/tts")).EdgeTTSProvider();
  const voice = language === "en-US" ? EN_VOICE : ZH_VOICE;

  // Same synthesis loop, WAV handling, content-keyed cache, and hold
  // padding as `video make`'s tts step (@video/make) — one implementation,
  // two entry points.
  let totalDurationMs = 0;
  let cachedCount = 0;
  let spokenCount = 0;
  try {
    const r = await synthesizeSceneAudio({
      projectRoot,
      scenes: sceneNarrations.map((s) => ({
        id: s.sceneId,
        narration: s.text,
        durationSec: s.duration,
      })),
      provider,
      voice,
      language,
      onEvent: (e) => process.stderr.write(formatProgressEvent(e) + "\n"),
    });
    totalDurationMs = r.totalDurationMs;
    cachedCount = r.cached.length;
    spokenCount = r.synthesized.length;
  } catch (err) {
    console.error(`TTS failed: ${(err as Error).message}`);
    return 1;
  }

  // Captions from MEASURED durations — sync the storyboard to the actual
  // wavs first (syncSceneDurations), then the same cue builder the burn-in
  // track uses (CS-07: SRT and burned captions cannot disagree). The old
  // one-cue-per-scene SRT at LLM-estimated times drifted from the audio.
  await syncSceneDurations(projectRoot);
  await writeCaptionsSrt(projectRoot, language);

  // Run record (provider/tool/prompt_hash/tokens absent — no LLM, just TTS)
  const runId = formatRunId("tts");
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
    duration_ms: totalDurationMs,
    provider: provider.name,
    model: voice,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  const target = sceneNarrations.filter((s) => s.text).length;
  console.log(
    `\u2713 generated audio for ${spokenCount}/${target} scenes` +
      (cachedCount > 0 ? ` (${cachedCount} cached)` : ""),
  );
  console.log(
    `  provider=${provider.name}  voice=${voice}  srt=captions/${language}.srt`,
  );
  console.log(
    `  next: \`video preview\` will pick up the real audio automatically`,
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

export function registerAudio(program: Command): void {
  program
    .command("audio")
    .argument(
      "<project>",
      "project: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option("--fake", "use FakeTTSProvider (no network) for tests")
    .option(
      "--force",
      "regenerate even when the project is FINAL_APPROVED (prints a warning)",
    )
    .action(
      async (
        project: string,
        opts: { cwd?: string; fake?: boolean; force?: boolean },
      ) => {
        process.exitCode = await runAudio({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
          ...(opts.force !== undefined ? { force: opts.force } : {}),
        });
      },
    );
}
