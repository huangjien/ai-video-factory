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
 * Home: @video/media so both `video make` and `video preview` can sync before
 * validating (validation hard-fails audio longer than the scene).
 */
export async function syncSceneDurations(
  projectRoot: string,
): Promise<string[]> {
  const audioDir = path.join(projectRoot, "assets", "audio");
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
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
  const dropRanges: Array<[number, number]> = [];
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
        clampAnimations(lines, i, measured, sceneKey, outputs, dropRanges);
        break;
      }
    }
  }
  // Nothing changed → don't touch the file. Rewriting unconditionally
  // would bump the storyboard mtime on every preview and make the
  // per-scene render cache look stale forever.
  if (outputs.length === 0) return [];
  if (dropRanges.length > 0) {
    const dropped = new Set<number>();
    for (const [from, to] of dropRanges) {
      for (let k = from; k <= to; k++) dropped.add(k);
    }
    for (let k = lines.length - 1; k >= 0; k--) {
      if (dropped.has(k)) lines.splice(k, 1);
    }
  }
  await mkdir(path.dirname(storyboardPath), { recursive: true });
  await writeFile(storyboardPath, lines.join("\n"), "utf8");
  return outputs;
}

/** Clamp the scene block's `animations:` entries to the measured duration:
 * validation hard-fails any animation whose start+duration exceeds the
 * scene (the LLM plans against longer estimated durations). An animation
 * that STARTS past the measured end can never fit — mark its line range
 * for removal instead. Line-based (same rationale as the duration
 * rewrite: no yaml round-trip that would lose comments). */
function clampAnimations(
  lines: string[],
  sceneStart: number,
  measured: number,
  sceneKey: string,
  outputs: string[],
  dropRanges: Array<[number, number]>,
): void {
  const sceneEnd = nextSceneStart(lines, sceneStart);
  let entryStart = -1;
  let startIdx = -1;
  let startVal = 0;
  let durationIdx = -1;
  let lastKeyIdx = -1;
  let animId = "";
  let sawAnimations = false;

  const finalize = () => {
    if (entryStart < 0 || startIdx < 0 || durationIdx < 0) return;
    const durVal = parseFloat(
      lines[durationIdx]!.match(/(\d+(?:\.\d+)?)\s*$/)![1]!,
    );
    if (startVal >= measured - 0.01) {
      dropRanges.push([entryStart, lastKeyIdx]);
      outputs.push(
        `storyboard.yaml: scene_${sceneKey} animation ${animId} dropped (starts ${startVal.toFixed(2)}s, scene is ${measured.toFixed(2)}s)`,
      );
    } else if (startVal + durVal > measured - 0.005) {
      const clamped = Math.max(0.05, measured - startVal);
      const indent = lines[durationIdx]!.match(/^(\s*)/)![1];
      lines[durationIdx] =
        `${indent}duration: ${Math.round(clamped * 100) / 100}`;
      outputs.push(
        `storyboard.yaml: scene_${sceneKey} animation ${animId} clamped ${durVal.toFixed(2)}→${(Math.round(clamped * 100) / 100).toFixed(2)}s`,
      );
    }
  };

  for (let k = sceneStart + 1; k < sceneEnd; k++) {
    const line = lines[k]!;
    if (/^\s*animations:\s*$/.test(line)) {
      sawAnimations = true;
      continue;
    }
    if (!sawAnimations) continue;
    const entryMatch = line.match(/^\s*-\s*id:\s*(.+)$/);
    if (entryMatch) {
      finalize();
      entryStart = k;
      animId = entryMatch[1]!.trim().replace(/^["']|["']$/g, "");
      startIdx = -1;
      durationIdx = -1;
      lastKeyIdx = k;
      continue;
    }
    if (line.trim().length === 0) continue;
    const startMatch = line.match(/^\s*start:\s*(\d+(?:\.\d+)?)\s*$/);
    if (startMatch) {
      startIdx = k;
      startVal = parseFloat(startMatch[1]!);
      lastKeyIdx = k;
      continue;
    }
    const durMatch = line.match(/^\s*duration:\s*(\d+(?:\.\d+)?)\s*$/);
    if (durMatch) {
      durationIdx = k;
    }
    lastKeyIdx = k;
  }
  finalize();
}

function nextSceneStart(lines: string[], from: number): number {
  for (let k = from + 1; k < lines.length; k++) {
    if (/^\s*-\s*id:\s*scene[-_]?\d+\s*$/.test(lines[k]!)) return k;
  }
  return lines.length;
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
  const storyboardPath = path.join(
    projectRoot,
    "storyboard",
    "storyboard.yaml",
  );
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
