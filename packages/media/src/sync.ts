import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { probeAudioDuration } from "./probe.js";

const execFileAsync = promisify(execFile);

/**
 * Probe each scene's TTS WAV and rewrite storyboard.yaml so its
 * `duration:` field matches the actual audio length. Without this, the
 * renderer's frame count comes from the LLM-estimated duration — which
 * the LLM consistently underestimates — so the video freezes at the
 * planned length while the audio continues.
 *
 * Regex-based line replacement rather than a yaml round-trip: that would
 * lose comments and reformat the file.
 *
 * Home: @vf/media so both `vf make` and `vf preview` can sync before
 * validating (validation hard-fails audio longer than the scene).
 */
export async function syncSceneDurations(
  projectRoot: string,
): Promise<string[]> {
  const audioDir = path.join(projectRoot, "assets", "audio");
  const storyboardPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  if (!existsSync(audioDir) || !existsSync(storyboardPath)) return [];

  const wavs = (await readdir(audioDir))
    .filter((f) => /^scene[-_]?(\d+)\.wav$/.test(f))
    .sort();
  if (wavs.length === 0) return [];

  const durations = new Map<string, number>();
  for (const w of wavs) {
    const m = w.match(/^scene[-_]?(\d+)\.wav$/);
    if (!m) continue;
    // Key by the scene NUMBER (parseInt-normalized): WAV names may be
    // zero-padded ("scene_01.wav") while the lookup below reads the YAML
    // id ("scene-01") the same way. Verbatim keys would never meet.
    const idKey = String(parseInt(m[1]!, 10));
    try {
      const sec = await probeAudioDuration(path.join(audioDir, w));
      // Skip near-zero WAVs (fake TTS placeholder, partial downloads).
      if (Number.isFinite(sec) && sec >= 1) {
        durations.set(idKey, sec);
      }
    } catch {
      // ignore unprobeable files
    }
  }
  if (durations.size === 0) return [];

  const yaml = await readFile(storyboardPath, "utf8");
  const lines = yaml.split("\n");
  const outputs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const idMatch = lines[i]!.match(/^\s*-\s*id:\s*scene[-_]?(\d+)\s*$/);
    if (!idMatch) continue;
    // YAML ids may be zero-padded (scene-01 …); the Map is keyed by the
    // parseInt-normalized scene number, so "01" and "1" both hit.
    const sceneKey = String(parseInt(idMatch[1]!, 10));
    const measured = durations.get(sceneKey);
    if (measured === undefined) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const durMatch = lines[j]!.match(/^(\s*)duration:\s*(\d+(?:\.\d+)?)\s*$/);
      if (durMatch) {
        const newSec = measured.toFixed(2);
        // Skip when the value wouldn't change: rewriting unconditionally
        // bumps the storyboard mtime on every preview and makes the
        // per-scene render cache look stale forever.
        if (Math.abs(parseFloat(durMatch[2]!) - measured) < 0.005) break;
        lines[j] = `${durMatch[1]}duration: ${newSec}`;
        outputs.push(`storyboard.yaml: scene_${sceneKey} duration=${newSec}s`);
        break;
      }
    }
  }
  // Nothing changed → don't touch the file. Rewriting unconditionally
  // would bump the storyboard mtime on every preview and make the
  // per-scene render cache look stale forever.
  if (outputs.length === 0) return [];
  await mkdir(path.dirname(storyboardPath), { recursive: true });
  await writeFile(storyboardPath, lines.join("\n"), "utf8");
  return outputs;
}

export interface StoryboardSceneTiming {
  id: string;
  duration: number;
  narration: string;
}

/** Read per-scene id/duration/narration from the (duration-synced)
 * storyboard.yaml. Used to build SRT captions whose cue times match the
 * rendered video instead of the LLM's duration estimates. */
export async function readSceneTimings(
  projectRoot: string,
): Promise<StoryboardSceneTiming[]> {
  const storyboardPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
  const yaml = await readFile(storyboardPath, "utf8");
  const doc = parseYaml(yaml) as {
    scenes?: {
      id?: string;
      duration?: number;
      narration?: { text?: string };
    }[];
  };
  return (doc.scenes ?? [])
    .filter((s) => typeof s.id === "string" && typeof s.duration === "number")
    .map((s) => ({
      id: s.id as string,
      duration: s.duration as number,
      narration: s.narration?.text ?? "",
    }));
}
