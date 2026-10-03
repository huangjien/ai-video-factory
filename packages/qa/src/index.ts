import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RenderPlan } from "@vf/vdsl";
import {
  checkCaptions,
  checkSceneAudioSync,
  checkSceneBoundaries,
} from "./checks.js";

const execFileAsync = promisify(execFile);

/**
 * QA groundwork (plan §28 / T3.3): after every render, probe the artifact
 * and write qa/render-report.json + qa/contact-sheet.png. Deterministic,
 * ffmpeg/ffprobe-based; the export gate itself lands in T6.2 — for now
 * callers surface the report but previews do not hard-fail on findings.
 */

export interface VideoStreamInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
}

export async function probeVideo(file: string): Promise<VideoStreamInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height,r_frame_rate,codec_type",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: {
      width?: number;
      height?: number;
      r_frame_rate?: string;
      codec_type?: string;
    }[];
    format?: { duration?: string };
  };
  const video = parsed.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height || !video.r_frame_rate) {
    throw new Error(`probeVideo: no video stream in ${file}`);
  }
  const [num, den] = video.r_frame_rate.split("/").map(Number);
  const fps = den ? (num ?? 0) / den : 0;
  return {
    width: video.width,
    height: video.height,
    fps: Math.round(fps * 1000) / 1000,
    duration: Number.parseFloat(parsed.format?.duration ?? "0"),
    hasAudio: parsed.streams.some((s) => s.codec_type === "audio"),
  };
}

export interface BlackSegment {
  start: number;
  end: number;
  duration: number;
}

/**
 * Detect fully-black segments via ffmpeg blackdetect. pix_th=0.05 keeps
 * the pixel-black threshold BELOW the dark-tech theme background
 * (~7% luma / #0a0e14): at the previous 0.10, background pixels counted
 * as black, so sparse diagram scenes (thin strokes on the dark theme)
 * tripped the ≥98%-black-pixels frame rule. True black (luma ~0 —
 * injected gaps, dead renders) still detects; the theme never does.
 */
export async function detectBlackFrames(
  file: string,
  opts: { minDurationSec?: number } = {},
): Promise<BlackSegment[]> {
  const d = opts.minDurationSec ?? 0.5;
  let stderr = "";
  try {
    const res = await execFileAsync("ffmpeg", [
      "-i",
      file,
      "-vf",
      `blackdetect=d=${d}:pix_th=0.05`,
      "-f",
      "null",
      "-",
    ]);
    stderr = res.stderr;
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? "";
    if (!stderr) throw err;
  }
  const segments: BlackSegment[] = [];
  for (const m of stderr.matchAll(
    /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g,
  )) {
    segments.push({
      start: Number.parseFloat(m[1]!),
      end: Number.parseFloat(m[2]!),
      duration: Number.parseFloat(m[3]!),
    });
  }
  return segments;
}

/** Tile N evenly-spaced frames into one PNG (plan §28 contact sheet). */
export async function makeContactSheet(
  file: string,
  outPath: string,
  opts: { frames?: number; thumbWidth?: number } = {},
): Promise<void> {
  const info = await probeVideo(file);
  const frames = Math.min(
    opts.frames ?? 12,
    Math.max(1, Math.floor(info.duration)),
  );
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const thumbWidth = opts.thumbWidth ?? 320;
  await mkdir(path.dirname(outPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    file,
    "-vf",
    `fps=${frames / info.duration},scale=${thumbWidth}:-1,tile=${cols}x${rows}`,
    "-frames:v",
    "1",
    outPath,
  ]);
}

export interface QaFinding {
  level: "error" | "warn";
  check: string;
  message: string;
  /** Concrete remediation — every T6.1 finding carries one. */
  fix?: string;
}

export interface RenderReport {
  video: string;
  generatedAt: string;
  ok: boolean;
  findings: QaFinding[];
  checks: {
    duration: { expectedSec: number; actualSec: number; ok: boolean };
    fps: { expected: number; actual: number; ok: boolean };
    resolution: { expected: string; actual: string; ok: boolean };
    audio: { hasAudio: boolean; expectedAudio: boolean; ok: boolean };
    blackFrames: BlackSegment[];
    assets: { missing: string[]; ok: boolean };
    sceneAudioSync: {
      rows: import("./checks.js").SceneSyncRow[];
      ok: boolean;
    };
    captions: import("./checks.js").CaptionChecks;
    sceneBoundaries: import("./checks.js").BoundaryChecks;
  };
}

export interface RenderReportOptions {
  /** Duration tolerance in seconds (frame rounding at 30fps ≈ 0.03s/scene). */
  durationToleranceSec?: number;
  /** Root for resolving project-relative asset/audio paths. Defaults to
   * the standard layout's project root: the parent of the video's dir. */
  projectRoot?: string;
}

/** Build the render report for a rendered video against its RenderPlan. */
export async function buildRenderReport(
  plan: RenderPlan,
  videoPath: string,
  opts: RenderReportOptions = {},
): Promise<RenderReport> {
  const tolerance = opts.durationToleranceSec ?? 0.5;
  const projectRoot = opts.projectRoot ?? path.dirname(path.dirname(videoPath));
  const findings: QaFinding[] = [];
  const info = await probeVideo(videoPath);

  const expectedDuration = plan.totalFrames / plan.project.fps;
  const durationOk = Math.abs(info.duration - expectedDuration) <= tolerance;
  if (!durationOk) {
    findings.push({
      level: "error",
      check: "duration",
      message: `video is ${info.duration.toFixed(2)}s but the plan says ${expectedDuration.toFixed(2)}s (tolerance ${tolerance}s)`,
      fix: "Re-render (`vf preview` / `vf final`) or check the storyboard for duration drift.",
    });
  }

  const fpsOk = Math.abs(info.fps - plan.project.fps) < 0.01;
  if (!fpsOk) {
    findings.push({
      level: "error",
      check: "fps",
      message: `video is ${info.fps}fps but the plan says ${plan.project.fps}fps`,
      fix: "Re-render without --draft, or align the plan fps with the composition.",
    });
  }

  const expectedRes = `${plan.project.width}x${plan.project.height}`;
  const actualRes = `${info.width}x${info.height}`;
  const resOk = actualRes === expectedRes;
  if (!resOk) {
    findings.push({
      level: "error",
      check: "resolution",
      message: `video is ${actualRes} but the plan says ${expectedRes}`,
      fix: "Draft renders are 960x540@15 — this report must come from a full-resolution render.",
    });
  }

  const expectedAudio = plan.scenes.some((s) => s.audio !== null);
  const audioOk = info.hasAudio === expectedAudio;
  if (!audioOk) {
    findings.push({
      level: "warn",
      check: "audio",
      message: info.hasAudio
        ? "video has an audio track but no scene declares narration audio"
        : "scenes declare narration audio but the video has no audio track",
    });
  }

  const blackFrames = await detectBlackFrames(videoPath);
  for (const seg of blackFrames) {
    findings.push({
      level: "warn",
      check: "blackFrames",
      message: `black segment ${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s (${seg.duration.toFixed(2)}s) — intentional fade-to-black or a dead scene?`,
    });
  }

  const missing: string[] = [];
  for (const asset of plan.assets ?? []) {
    const abs = path.isAbsolute(asset.path)
      ? asset.path
      : path.join(projectRoot, asset.path);
    if (asset.path && !existsSync(abs)) missing.push(asset.path);
  }
  for (const scene of plan.scenes) {
    if (scene.audio && !existsSync(path.join(projectRoot, scene.audio))) {
      missing.push(scene.audio);
    }
  }
  if (missing.length > 0) {
    findings.push({
      level: "error",
      check: "assets",
      message: `missing files: ${missing.join(", ")}`,
      fix: "Regenerate with `vf make` / `vf audio`, or remove the dangling reference from the storyboard.",
    });
  }

  // T6.1 extended checks: per-scene narration sync, caption sync + fit,
  // scene-boundary detection. All findings carry fix suggestions.
  const sceneSync = await checkSceneAudioSync(plan, projectRoot);
  findings.push(...sceneSync.findings);
  const captions = await checkCaptions(plan, projectRoot, info.duration);
  findings.push(...captions.findings);
  const boundaries = await checkSceneBoundaries(plan, videoPath);
  findings.push(...boundaries.findings);

  return {
    video: videoPath,
    generatedAt: new Date().toISOString(),
    ok: !findings.some((f) => f.level === "error"),
    findings,
    checks: {
      duration: {
        expectedSec: Math.round(expectedDuration * 100) / 100,
        actualSec: Math.round(info.duration * 100) / 100,
        ok: durationOk,
      },
      fps: { expected: plan.project.fps, actual: info.fps, ok: fpsOk },
      resolution: { expected: expectedRes, actual: actualRes, ok: resOk },
      audio: {
        hasAudio: info.hasAudio,
        expectedAudio,
        ok: audioOk,
      },
      blackFrames,
      assets: { missing, ok: missing.length === 0 },
      sceneAudioSync: {
        rows: sceneSync.rows,
        ok: sceneSync.findings.length === 0,
      },
      captions: captions.checks,
      sceneBoundaries: boundaries.checks,
    },
  };
}

/** Write qa/render-report.json + qa/contact-sheet.png under projectRoot.
 * Returns the report; throws on ffmpeg failure (callers decide loudly). */
export async function writeQaArtifacts(
  projectRoot: string,
  plan: RenderPlan,
  videoPath: string,
): Promise<RenderReport> {
  const qaDir = path.join(projectRoot, "qa");
  const report = await buildRenderReport(plan, videoPath);
  await mkdir(qaDir, { recursive: true });
  await writeFile(
    path.join(qaDir, "render-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  await makeContactSheet(videoPath, path.join(qaDir, "contact-sheet.png"));
  return report;
}

// Re-exports from the extended-checks module (T6.1) so consumers import
// everything QA-related from "@vf/qa".
export {
  checkCaptions,
  checkSceneAudioSync,
  checkSceneBoundaries,
  findCaptionFile,
  parseSrt,
  type BoundaryChecks,
  type CaptionChecks,
  type QaFixableFinding,
  type SceneSyncRow,
  type SrtCue,
} from "./checks.js";
