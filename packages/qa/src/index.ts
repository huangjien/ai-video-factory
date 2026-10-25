import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RenderPlan } from "@video/vdsl";
import { loadPrompt } from "@video/prompts";
import {
  LayaClient,
  recordDecision,
  resolveLayaConfig,
  type LayaMode,
} from "@video/llm";
import {
  checkCaptions,
  checkSceneAudioSync,
  checkSceneBoundaries,
  checkStaleSceneRenders,
} from "./checks.js";
import { gradeFindings } from "./severity.js";
export {
  LAYA_SEVERITY_QID,
  QA_SEVERITY_INSTRUCTIONS,
  SEVERITY_AGREEMENT_TOLERANCE,
  SEVERITY_ERROR_THRESHOLD,
  SEVERITY_PROMOTE_THRESHOLD,
  buildSeverityState,
  gradeFindings,
  gradeSeverity,
  isGradedFinding,
  levelForScore,
  severityFactsFrom,
  severityScaleFor,
  type GradeSeveritiesOptions,
  type SeverityFacts,
  type SeverityOutcome,
} from "./severity.js";

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

/** Tile N evenly-spaced frames into one PNG (plan §28 contact sheet).
 * `caption` (v0.6) is drawn as a bottom overlay when a system font is
 * available; no font → no caption, sheet unchanged. */
export async function makeContactSheet(
  file: string,
  outPath: string,
  opts: { frames?: number; thumbWidth?: number; caption?: string } = {},
): Promise<void> {
  const info = await probeVideo(file);
  const frames = Math.min(
    opts.frames ?? 12,
    Math.max(1, Math.floor(info.duration)),
  );
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const thumbWidth = opts.thumbWidth ?? 320;
  const vf = contactSheetFilter(
    frames / info.duration,
    thumbWidth,
    cols,
    rows,
    opts.caption,
  );
  await mkdir(path.dirname(outPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    file,
    "-vf",
    vf,
    "-frames:v",
    "1",
    outPath,
  ]);
}

/** Pure filter-string builder (unit-testable without ffmpeg). */
export function contactSheetFilter(
  fps: number,
  thumbWidth: number,
  cols: number,
  rows: number,
  caption?: string,
): string {
  const base = `fps=${fps},scale=${thumbWidth}:-1,tile=${cols}x${rows}`;
  const font = caption ? firstSystemFont() : null;
  if (!caption || !font) return base;
  const escaped = caption
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
  return (
    base +
    `,drawtext=fontfile='${font}':text='${escaped}':x=8:y=h-th-8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`
  );
}

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Helvetica.ttc", // macOS
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", // Linux
];

function firstSystemFont(): string | null {
  for (const f of FONT_CANDIDATES) {
    if (existsSync(f)) return f;
  }
  return null;
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
  /** v0.6 D3: Laya's advisory triage. Present ONLY in LAYA_MODE=on —
   * shadow logs to the sidecar and never mutates the report, and the
   * export gate NEVER reads this field (v0.6 plan §1 rule 1: advisory
   * only, human gates stay human). */
  advisory?: { laya?: QaLayaTriage };
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
    staleRenders: import("./checks.js").StaleRenderChecks;
  };
}

/** Laya's "where should a human look first" hint for the QA report. */
export interface QaLayaTriage {
  verdict: "pass" | "review" | "block";
  confidence: number;
  routingModel: string;
  latencyMs: number;
}

export interface RenderReportOptions {
  /** Duration tolerance in seconds (frame rounding at 30fps ≈ 0.03s/scene). */
  durationToleranceSec?: number;
  /** Root for resolving project-relative asset/audio paths. Defaults to
   * the standard layout's project root: the parent of the video's dir. */
  projectRoot?: string;
  /** The Laya mode for severity grading. Defaults to the configured
   *  mode; `off` skips grading entirely. */
  layaMode?: LayaMode | undefined;
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
  // Severity grading needs a client only when the mode is not off.
  const layaMode = opts.layaMode ?? resolveLayaConfig().mode;
  const layaClient =
    layaMode === "off"
      ? null
      : new LayaClient({ resolvedConfig: resolveLayaConfig() });

  const expectedDuration = plan.totalFrames / plan.project.fps;
  const durationOk = Math.abs(info.duration - expectedDuration) <= tolerance;
  if (!durationOk) {
    findings.push({
      level: "error",
      check: "duration",
      message: `video is ${info.duration.toFixed(2)}s but the plan says ${expectedDuration.toFixed(2)}s (tolerance ${tolerance}s)`,
      fix: "Re-render (`video preview` / `video final`) or check the storyboard for duration drift.",
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
      fix: "Regenerate with `video make` / `video audio`, or remove the dangling reference from the storyboard.",
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
  const staleRenders = await checkStaleSceneRenders(plan, projectRoot);
  findings.push(...staleRenders.findings);

  // v0.6 D4: severity grading. A finding whose severity is a matter of
  // DEGREE (not structurally wrong) may be graded by a `score` decision.
  // The decision may RAISE a level; it may never lower one — a defect
  // the deterministic check found does not become acceptable because a
  // score said so. Off by default; shadow records, `on` promotes.
  const gradedFindings = await gradeFindings(findings, {
    mode: layaMode,
    client: layaClient,
    sidecarPath: path.join(projectRoot, "laya-decisions.jsonl"),
  });

  return {
    video: videoPath,
    generatedAt: new Date().toISOString(),
    ok: !gradedFindings.some((f) => f.level === "error"),
    findings: gradedFindings,
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
      staleRenders: staleRenders.checks,
    },
  };
}

/** Write qa/render-report.json + qa/contact-sheet.png under projectRoot.
 * Returns the report; throws on ffmpeg failure (callers decide loudly).
 *
 * v0.6 D3: when LAYA_MODE is on/shadow the finished report is ALSO
 * triaged by the Laya sidecar. shadow → one `laya-decisions.jsonl` row,
 * report untouched. on → the verdict rides along as
 * `report.advisory.laya` and is captioned on the contact sheet. The
 * export gate never reads the advisory (human gates stay human). */
export async function writeQaArtifacts(
  projectRoot: string,
  plan: RenderPlan,
  videoPath: string,
  opts: { layaMode?: LayaMode } = {},
): Promise<RenderReport> {
  const qaDir = path.join(projectRoot, "qa");
  const report = await buildRenderReport(plan, videoPath);

  const layaCfg = resolveLayaConfig();
  const mode = opts.layaMode ?? layaCfg.mode;
  if (mode !== "off") {
    const client = new LayaClient({ resolvedConfig: layaCfg });
    // The deterministic gate IS the baseline: it is what today's path
    // would have said about this report.
    const expected = deterministicTriageVerdict(report);
    // ONE consult, one recorded row — the shared seam owns the consult,
    // the answer validation, the row, and the expected/agreed pair.
    const res = await recordDecision(client, {
      surface: "triage",
      state: buildTriageState(report),
      question: {
        id: "triage",
        type: "choice",
        instructions: QA_TRIAGE_INSTRUCTIONS,
        criteria: ["pass", "review", "block"],
      },
      mode,
      baseline: expected,
      sidecarPath: path.join(projectRoot, "laya-decisions.jsonl"),
    });
    const triage: QaLayaTriage | null =
      res.choice === null
        ? null
        : {
            verdict: res.choice as QaLayaTriage["verdict"],
            confidence: res.answer?.confidence ?? 0,
            routingModel: res.answer?.routingModel ?? "unknown",
            latencyMs: 0,
          };
    if (mode === "on" && triage) {
      report.advisory = { laya: triage };
    }
  }

  await mkdir(qaDir, { recursive: true });
  await writeFile(
    path.join(qaDir, "render-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  const caption = report.advisory?.laya
    ? `laya: ${report.advisory.laya.verdict} (conf ${report.advisory.laya.confidence.toFixed(2)})`
    : undefined;
  await makeContactSheet(videoPath, path.join(qaDir, "contact-sheet.png"), {
    ...(caption !== undefined ? { caption } : {}),
  });
  return report;
}

/** Body lives in `packages/prompts/prompts/qa-triage.md` — edit it there. */
export const QA_TRIAGE_INSTRUCTIONS = loadPrompt("qa-triage");

/** Compact state string for the triage consult (≤ ~2k chars). */
export function buildTriageState(report: RenderReport): string {
  const c = report.checks;
  const errorCount = report.findings.filter((f) => f.level === "error").length;
  const warnCount = report.findings.filter((f) => f.level === "warn").length;
  const worst = report.findings
    .slice(0, 5)
    .map((f) => `- [${f.level}] ${f.check}: ${f.message}`)
    .join("\n");
  return [
    `QA verdict ok=${report.ok}`,
    `errors=${errorCount} warnings=${warnCount}`,
    `duration ${c.duration.actualSec}s vs plan ${c.duration.expectedSec}s ok=${c.duration.ok}`,
    `fps ${c.fps.actual} ok=${c.fps.ok}`,
    `resolution ${c.resolution.actual} ok=${c.resolution.ok}`,
    `audio present=${c.audio.hasAudio} ok=${c.audio.ok}`,
    `black frames: ${c.blackFrames.length} segment(s)`,
    `missing assets: ${c.assets.missing.length}`,
    `scene audio sync ok=${c.sceneAudioSync.ok}`,
    `captions ok=${c.captions.ok}`,
    `scene boundaries ok=${c.sceneBoundaries.ok}`,
    worst ? `top findings:\n${worst}` : "no findings",
  ].join("\n");
}

/** What today's deterministic gate logic would say (the shadow baseline):
 * error findings → block, warn-only → review, clean → pass. */
export function deterministicTriageVerdict(
  report: Pick<RenderReport, "ok" | "findings">,
): "pass" | "review" | "block" {
  if (report.findings.some((f) => f.level === "error")) return "block";
  if (report.findings.some((f) => f.level === "warn")) return "review";
  return "pass";
}

/** Ask Laya to triage a finished report. Null = no usable answer. */
export async function triageReportWithLaya(
  client: LayaClient,
  report: RenderReport,
): Promise<QaLayaTriage | null> {
  let decision: Awaited<ReturnType<LayaClient["decide"]>>;
  try {
    decision = await client.decide(buildTriageState(report), {
      triage: {
        type: "choice",
        instructions: QA_TRIAGE_INSTRUCTIONS,
        criteria: ["pass", "review", "block"],
      },
    });
  } catch {
    return null; // decide() is never-throwing by contract; belt and braces
  }
  const answer = decision?.answers["triage"];
  if (decision === null || decision === undefined || answer === undefined) {
    return null;
  }
  const v = answer.value;
  const verdict = v === "pass" || v === "review" || v === "block" ? v : null;
  if (verdict === null) return null;
  return {
    verdict,
    confidence: answer.confidence,
    routingModel: answer.routingModel,
    latencyMs: decision.latencyMs,
  };
}

// Re-exports from the extended-checks module (T6.1) so consumers import
// everything QA-related from "@video/qa".
export {
  checkCaptions,
  checkSceneAudioSync,
  checkSceneBoundaries,
  checkStaleSceneRenders,
  findCaptionFile,
  parseSrt,
  type BoundaryChecks,
  type CaptionChecks,
  type QaFixableFinding,
  type SceneSyncRow,
  type StaleRenderChecks,
  type SrtCue,
} from "./checks.js";
