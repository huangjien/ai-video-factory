import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeAudioDuration } from "@vf/media";
import type { RenderPlan } from "@vf/vdsl";

const execFileAsync = promisify(execFile);

/**
 * Extended QA checks (plan T6.1, §13 QA Agent / §28): per-scene narration
 * sync, caption sync + caption fit (out-of-bounds proxy), and scene-boundary
 * detection — layered on top of the T3.3 duration/fps/resolution/audio/
 * black-frame/asset checks. Every finding carries a `fix` suggestion.
 */

const SCENE_SYNC_TOLERANCE_S = 0.15;
const CAPTION_MAX_LINES = 3;
const CAPTION_MAX_UNITS = 24;
const CAPTION_TAIL_TOLERANCE_S = 1;

export interface QaFixableFinding {
  level: "error" | "warn";
  check: string;
  message: string;
  fix?: string;
}

// ---------------------------------------------------------------------------
// SRT parsing
// ---------------------------------------------------------------------------

export interface SrtCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

function parseSrtTime(stamp: string): number {
  const m = stamp.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return Number.NaN;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4]!.padEnd(3, "0")) / 1000
  );
}

export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [from, to] = timing.split("-->");
    const startSec = parseSrtTime(from ?? "");
    const endSec = parseSrtTime(to ?? "");
    if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
    const body = lines
      .filter((l) => l !== timing && !/^\d+$/.test(l.trim()))
      .join(" ")
      .trim();
    cues.push({ index: cues.length + 1, startSec, endSec, text: body });
  }
  return cues;
}

export async function findCaptionFile(
  projectRoot: string,
): Promise<string | null> {
  const dir = path.join(projectRoot, "captions");
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".srt")).sort();
  const first = files[0];
  return first ? path.join(dir, first) : null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface SceneSyncRow {
  scene: string;
  audioSec: number;
  sceneSec: number;
  ok: boolean;
}

/** Narration vs scene duration, per scene (audio/caption sync §28): the
 * pipeline pads/normalizes WAVs to the synced storyboard duration, so any
 * drift beyond the tolerance means audio and storyboard disagree. */
export async function checkSceneAudioSync(
  plan: RenderPlan,
  projectRoot: string,
): Promise<{ rows: SceneSyncRow[]; findings: QaFixableFinding[] }> {
  const rows: SceneSyncRow[] = [];
  const findings: QaFixableFinding[] = [];
  for (const scene of plan.scenes) {
    if (!scene.audio) continue;
    const abs = path.isAbsolute(scene.audio)
      ? scene.audio
      : path.join(projectRoot, scene.audio);
    if (!existsSync(abs)) continue; // already an assets error
    let audioSec = 0;
    try {
      audioSec = await probeAudioDuration(abs);
    } catch {
      findings.push({
        level: "warn",
        check: "sceneAudioSync",
        message: `scene ${scene.id}: narration audio unreadable (${scene.audio})`,
        fix: "Re-run `vf audio` / `vf make` to regenerate it.",
      });
      continue;
    }
    const sceneSec = scene.durationInFrames / plan.project.fps;
    const ok = Math.abs(audioSec - sceneSec) <= SCENE_SYNC_TOLERANCE_S;
    rows.push({
      scene: scene.id,
      audioSec: Math.round(audioSec * 100) / 100,
      sceneSec: Math.round(sceneSec * 100) / 100,
      ok,
    });
    if (!ok) {
      findings.push({
        level: "error",
        check: "sceneAudioSync",
        message: `scene ${scene.id}: narration is ${audioSec.toFixed(2)}s but the scene is ${sceneSec.toFixed(2)}s`,
        fix: "Re-run `vf make` (its sync-durations step rewrites the storyboard to measured audio) or `vf audio` to regenerate.",
      });
    }
  }
  return { rows, findings };
}

export interface CaptionChecks {
  file: string | null;
  cues: number;
  ok: boolean;
}

/** Caption sync + fit (§28): the SRT must exist when scenes want captions,
 * stay monotonic, end inside the video, and fit the caption safe area.
 * Caption fit is plan-only and always runs — it must not depend on an SRT
 * existing. */
export async function checkCaptions(
  plan: RenderPlan,
  projectRoot: string,
  videoDurationSec: number,
): Promise<{ checks: CaptionChecks; findings: QaFixableFinding[] }> {
  const findings: QaFixableFinding[] = [];

  // Caption fit (out-of-bounds proxy, §28 "out-of-bounds elements"): the
  // plan's captions are already CJK-wrapped by the compiler (24 units);
  // the overlay safe area fits at most 3 lines.
  for (const scene of plan.scenes) {
    const lines = scene.captions?.lines ?? [];
    if (lines.length > CAPTION_MAX_LINES) {
      findings.push({
        level: "error",
        check: "captionFit",
        message: `scene ${scene.id}: captions wrap to ${lines.length} lines (safe area fits ${CAPTION_MAX_LINES} × ${CAPTION_MAX_UNITS} units)`,
        fix: "Shorten the caption text or split the scene.",
      });
    }
  }

  const wantsCaptions = plan.scenes.some(
    (s) => s.captions !== null && s.captions !== undefined,
  );
  const file = await findCaptionFile(projectRoot);

  if (wantsCaptions && file === null) {
    findings.push({
      level: "warn",
      check: "captions",
      message: "scenes declare captions but no captions/*.srt exists",
      fix: "Run `vf make` or `vf audio` to write captions from the synced storyboard.",
    });
    return {
      checks: { file: null, cues: 0, ok: !findings.some((f) => f.level === "error") },
      findings,
    };
  }

  if (file === null) {
    return { checks: { file: null, cues: 0, ok: true }, findings };
  }

  const cues = parseSrt(await readFile(file, "utf8"));
  if (cues.length === 0) {
    findings.push({
      level: "warn",
      check: "captions",
      message: `${path.basename(file)} parsed to zero cues`,
      fix: "Regenerate captions (`vf make` rewrites them from the storyboard).",
    });
    return { checks: { file, cues: 0, ok: false }, findings };
  }

  for (let i = 1; i < cues.length; i++) {
    if (cues[i]!.startSec < cues[i - 1]!.startSec) {
      findings.push({
        level: "error",
        check: "captions",
        message: `cue ${i + 1} starts before cue ${i} (non-monotonic captions)`,
        fix: "Regenerate captions — `vf make` rewrites them from the synced storyboard.",
      });
      break;
    }
  }

  const last = cues[cues.length - 1]!;
  if (last.endSec > videoDurationSec + CAPTION_TAIL_TOLERANCE_S) {
    findings.push({
      level: "warn",
      check: "captions",
      message: `last caption ends at ${last.endSec.toFixed(2)}s but the video is ${videoDurationSec.toFixed(2)}s — cue times likely came from LLM estimates, not measured audio`,
      fix: "Re-run `vf make` — its captions step times cues from the synced storyboard durations.",
    });
  }

  return {
    checks: { file, cues: cues.length, ok: !findings.some((f) => f.level === "error") },
    findings,
  };
}

export interface BoundaryChecks {
  expectedStartsSec: number[];
  detectedCutsSec: number[];
  ok: boolean;
}

/** Scene-boundary detection (§28): cuts are detected from pixel scene
 * scores and compared to the plan's expected boundaries. Fades blur the
 * exact timestamp, so this is tolerance- and warn-level — the contact
 * sheet remains the visual ground truth. */
export async function checkSceneBoundaries(
  plan: RenderPlan,
  videoPath: string,
): Promise<{ checks: BoundaryChecks; findings: QaFixableFinding[] }> {
  const fps = plan.project.fps;
  const expectedStartsSec = plan.scenes
    .slice(1) // scene 0 always starts at 0 — not a "cut"
    .map((s) => Math.round((s.startFrame / fps) * 100) / 100);

  let detected: number[] = [];
  try {
    const res = await execFileAsync("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      "select='gte(scene,0.4)',showinfo",
      "-f",
      "null",
      "-",
    ]);
    detected = [...res.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) =>
      Math.round(Number.parseFloat(m[1]!) * 100) / 100,
    );
  } catch (err) {
    return {
      checks: {
        expectedStartsSec,
        detectedCutsSec: [],
        ok: false,
      },
      findings: [
        {
          level: "warn",
          check: "sceneBoundaries",
          message: `cut detection failed: ${(err as Error).message.split("\n")[0]}`,
          fix: "Inspect qa/contact-sheet.png manually.",
        },
      ],
    };
  }

  // Count how many expected boundaries have a detected cut nearby (±0.5s
  // — fade transitions shift the score peak off the exact boundary).
  const matched = expectedStartsSec.filter((e) =>
    detected.some((d) => Math.abs(d - e) <= 0.5),
  ).length;
  const ok =
    expectedStartsSec.length === 0 ||
    matched >= Math.ceil(expectedStartsSec.length * 0.5);
  const findings: QaFixableFinding[] = ok
    ? []
    : [
        {
          level: "warn",
          check: "sceneBoundaries",
          message: `only ${matched}/${expectedStartsSec.length} expected scene cuts detected (transitions and slow scenes blur pixel deltas)`,
          fix: "Check qa/contact-sheet.png; if scenes truly ran together, verify per-scene durations in the storyboard.",
        },
      ];
  return {
    checks: { expectedStartsSec, detectedCutsSec: detected, ok },
    findings,
  };
}
