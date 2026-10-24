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
  // Speech windows are applied AFTER the loop: inserting a line while the
  // loop is still walking `lines` shifts every later index, and the loop
  // reads scene ids by index — so a mid-loop insert makes it attribute
  // one scene's window to the previous scene's captions block.
  const speechWindows: { at: number; line: string }[] = [];
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
        collectSpeechWindow(
          lines,
          i,
          measured,
          sceneKey,
          outputs,
          speechWindows,
        );
        break;
      }
    }
  }
  // Nothing changed → don't touch the file. Rewriting unconditionally
  // would bump the storyboard mtime on every preview and make the
  // per-scene render cache look stale forever.
  if (outputs.length === 0) return [];
  // ONE descending pass over BOTH edit kinds. The drops and the
  // speech-window inserts are collected against the ORIGINAL line
  // numbers, so applying the inserts first shifted every later index
  // and the drops then cut the wrong lines — observed 2026-10-24: a
  // lead-in insert near the top moved the animation drops one line
  // early, orphaning a `source: narration` and leaving the storyboard
  // unparseable. Going backwards keeps the not-yet-applied positions
  // valid, and the two kinds never overlap (a scene's captions block
  // sits above its animations block).
  const edits: {
    at: number;
    kind: "insert" | "drop";
    to?: number;
    line?: string;
  }[] = [];
  for (const w of speechWindows) {
    edits.push({ at: w.at, kind: "insert", line: w.line });
  }
  for (const [from, to] of dropRanges) {
    edits.push({ at: from, kind: "drop", to });
  }
  edits.sort((a, b) => b.at - a.at);
  for (const edit of edits) {
    if (edit.kind === "insert") {
      lines.splice(edit.at, 0, edit.line ?? "");
    } else {
      const to = edit.to ?? edit.at;
      lines.splice(edit.at, to - edit.at + 1);
    }
  }
  await mkdir(path.dirname(storyboardPath), { recursive: true });
  await writeFile(storyboardPath, lines.join("\n"), "utf8");
  return outputs;
}

/** CS-03: when a scene holds silence after its narration, the caption cues
 *  must be timed against the SPOKEN part only. The measured wav is speech
 *  + hold, so the speech length is measured minus the declared hold; it
 *  is written to `captions.speech_sec` for the compiler to use. */
function collectSpeechWindow(
  lines: string[],
  sceneStart: number,
  measured: number,
  sceneKey: string,
  outputs: string[],
  into: { at: number; line: string }[],
): void {
  const sceneEnd = nextSceneStart(lines, sceneStart);
  let hold = 0;
  let holdIdx = -1;
  let captionsIdx = -1;
  let speechIdx = -1;
  let leadIn = 0;
  for (let k = sceneStart + 1; k < sceneEnd; k++) {
    const line = lines[k]!;
    const holdMatch = line.match(/^(\s*)hold_after_sec:\s*([0-9.]+)\s*$/);
    if (holdMatch) {
      hold = parseFloat(holdMatch[2]!);
      holdIdx = k;
      continue;
    }
    // The opening beat: silence BEFORE the narration. The measured wav
    // length covers lead-in + speech (+ hold), so the spoken window must
    // exclude it or the caption text precedes the words it captions.
    const leadMatch = line.match(/^(\s*)lead_in_sec:\s*([0-9.]+)\s*$/);
    if (leadMatch) {
      leadIn = parseFloat(leadMatch[2]!);
      continue;
    }
    if (/^\s*captions:\s*$/.test(line)) captionsIdx = k;
    // Already written by a previous pass — leave it alone, or the block
    // would grow a second `speech_sec` key and stop being valid YAML.
    if (/^\s*speech_sec:\s*[0-9.]+\s*$/.test(line)) speechIdx = k;
  }
  if (captionsIdx < 0) return;
  if (hold <= 0 && leadIn <= 0) return;
  const speech = measured - hold - leadIn;
  if (speech <= 0) return;
  if (speechIdx >= 0) {
    const indent = lines[speechIdx]!.match(/^(\s*)/)![1] ?? "";
    lines[speechIdx] = `${indent}speech_sec: ${speech.toFixed(2)}`;
    return;
  }
  // The captions block is written AFTER the `captions:` key, so the
  // speech window goes on the following line at the same indent.
  const indent = lines[captionsIdx]!.match(/^(\s*)/)![1] ?? "";
  into.push({
    at: captionsIdx + 1,
    line: `${indent}  speech_sec: ${speech.toFixed(2)}`,
  });
  outputs.push(
    `storyboard.yaml: scene_${sceneKey} speech=${speech.toFixed(2)}s (lead-in ${leadIn}s, hold ${hold}s)`,
  );
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
  /** CS-03: the spoken length when the scene holds silence after it. */
  speechSec?: number | undefined;
  /** The opening beat: silence BEFORE the voice. Cues start after it, so
   *  the SRT and the burned-in track agree (CS-07). */
  leadInSec?: number | undefined;
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
      lead_in_sec?: number;
      narration?: { text?: string };
      captions?: { speech_sec?: number };
    }[];
  };
  return (doc.scenes ?? [])
    .filter((s) => typeof s.id === "string" && typeof s.duration === "number")
    .map((s) => ({
      id: s.id as string,
      duration: s.duration as number,
      narration: s.narration?.text ?? "",
      speechSec: s.captions?.speech_sec,
      leadInSec: s.lead_in_sec,
    }));
}
