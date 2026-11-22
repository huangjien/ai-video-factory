import type { Command } from "commander";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync, readFileSync } from "node:fs";
import { formatRunId } from "@video/workflow";
import { readSceneTimings } from "@video/media";
import {
  MiniMaxVideoProvider,
  MockVideoProvider,
  type VideoProvider,
  type VideoResult,
} from "@video/media-generators";

const execFileAsync = promisify(execFile);

export interface ShortsOptions {
  project: string;
  cwd?: string | undefined;
  durationSec?: number;
  startSec?: number;
  providerName?: "mock" | "minimax" | undefined;
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Resolve the thumbnail image bytes for the minimax video path.
 * v0.3 phase 1 may write either thumbnail.png (mock) or thumbnail.jpg (real). */
function readThumbnail(
  projectRoot: string,
): { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" } | null {
  for (const name of ["thumbnail.jpg", "thumbnail.png"]) {
    const p = path.join(projectRoot, "youtube", name);
    if (existsSync(p)) {
      return {
        bytes: new Uint8Array(readFileSync(p)),
        contentType: name === "thumbnail.jpg" ? "image/jpeg" : "image/png",
      };
    }
  }
  return null;
}

async function shortsFfmpeg(
  src: string,
  out: string,
  start: number,
  duration: number,
): Promise<void> {
  // Aspect-aware filter (2026-11-20): a landscape master must be
  // center-cropped to 9:16, but a VERTICAL master (the native vertical
  // workdir) must only be trimmed — cropping it would cut the composed
  // frame and its burned-in captions.
  const filter = (await isVerticalVideo(src))
    ? "scale=1080:1920"
    : "crop=ih*9/16:ih,scale=1080:1920";
  // A trimmed cut fades its last second out (video + audio) so the
  // out-point reads as an ending, not a hard chop.
  const fadeStart = Math.max(0, start + duration - 1);
  const vf = duration > 0 ? `${filter},fade=t=out:st=${fadeStart}:d=1` : filter;
  const af = duration > 0 ? `afade=t=out:st=${fadeStart}:d=1` : undefined;
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    String(start),
    "-i",
    src,
    ...(duration > 0 ? ["-t", String(duration)] : []),
    "-vf",
    vf,
    ...(af ? ["-af", af] : []),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    out,
  ]);
}

/** Probe the source frame: true when it is already portrait. */
async function isVerticalVideo(file: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ]);
    const [w, h] = stdout
      .trim()
      .split(",")
      .map((v) => parseInt(v, 10));
    if (w === undefined || h === undefined) return false;
    return h > w;
  } catch {
    return false;
  }
}

/** Probe the container duration in seconds (0 when unreadable). */
export async function probeDurationSec(file: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]);
    const v = parseFloat(stdout.trim());
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export interface ShortsWindow {
  start: number;
  /** Cut out-point in source seconds; 0 with full=true means "to EOF". */
  end: number;
  /** True when the whole film is kept (no re-timing needed). */
  full: boolean;
}

/** Choose the cut window for the mock (ffmpeg) path.
 *
 *  Default (no requested teaser length): the WHOLE film — the scene-01
 *  hook opens the cut and the payoff scene closes it (feedback 2026-11-21:
 *  the old 60 s slice skipped the hook, cut mid-scene, and truncated the
 *  story). With a requested length: still start at 0 so the hook is kept,
 *  and end on the last scene boundary that fits, so the out-point lands
 *  between scenes instead of mid-narration.
 */
export function selectShortsWindow(
  timings: { duration: number }[],
  masterDurationSec: number,
  requestedDurationSec?: number,
): ShortsWindow {
  if (
    requestedDurationSec === undefined ||
    (masterDurationSec > 0 && requestedDurationSec >= masterDurationSec)
  ) {
    return { start: 0, end: masterDurationSec, full: true };
  }
  let end = requestedDurationSec;
  let cum = 0;
  for (const t of timings) {
    const next = cum + t.duration;
    if (next <= requestedDurationSec) end = next;
    else break;
    cum = next;
  }
  return { start: 0, end, full: false };
}

export async function runShorts(opts: ShortsOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const shortsPath = path.join(projectRoot, "youtube", "shorts.mp4");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });

  // Provider selection: mock (default, mechanical ffmpeg) or minimax (real AI
  // video from thumbnail + shorts-hook). The minimax path requires:
  //   - MINIMAX_API_KEY env var
  //   - youtube/thumbnail.{png|jpg} produced by `video thumbnail`
  //   - youtube/shorts-hook.txt produced by `video youtube`
  const provider: VideoProvider =
    opts.providerName === "minimax"
      ? new MiniMaxVideoProvider()
      : new MockVideoProvider();

  let result: VideoResult;
  let runRecord: {
    provider: string;
    model: string;
    input_files: string[];
    prompt_hash: string;
  };

  if (provider.name === "minimax-video") {
    const thumb = readThumbnail(projectRoot);
    if (!thumb) {
      console.error(
        `\u2717 missing thumbnail for minimax provider: youtube/thumbnail.{png,jpg}`,
      );
      console.error(`  run \`video thumbnail <project>\` first`);
      return 1;
    }
    const hookPath = path.join(projectRoot, "youtube", "shorts-hook.txt");
    if (!existsSync(hookPath)) {
      console.error(`\u2717 missing shorts hook: ${hookPath}`);
      console.error(`  run \`video youtube <project>\` first`);
      return 1;
    }
    const hookText = readFileSync(hookPath, "utf8").trim();
    const dataUrl = `data:${thumb.contentType};base64,${Buffer.from(thumb.bytes).toString("base64")}`;
    const duration = opts.durationSec ?? 5;
    console.log(
      `  requesting MiniMax video (model ${provider.name}, ${duration}s, polling...)`,
    );
    try {
      result = await provider.generate({
        prompt: hookText,
        width: 1080,
        height: 1920,
        durationSec: duration,
        firstFrameImageUrl: dataUrl,
      });
    } catch (err) {
      console.error(
        `\u2717 ${provider.name} video generation failed:`,
        (err as Error).message,
      );
      return 1;
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(shortsPath, result.bytes);
    runRecord = {
      provider: provider.name,
      model: "MiniMax-Hailuo-2.3",
      input_files: [
        "youtube/thumbnail." + thumb.contentType.split("/")[1],
        "youtube/shorts-hook.txt",
      ],
      prompt_hash:
        "sha256:" +
        createHash("sha256")
          .update(hookText + "|" + dataUrl.slice(0, 64))
          .digest("hex"),
    };
  } else {
    // Mock path — mechanical ffmpeg clip from the finished film. The
    // make flow writes output/final-mixed.mp4; `video final` additionally
    // writes final-faststart.mp4 — prefer the latter, fall back to the
    // mixed master so a make-produced film can be cut without a final
    // pass (2026-11-20: the OPFOR film had only final-mixed.mp4).
    const outDir = path.join(projectRoot, "output");
    const src = ["final-faststart.mp4", "final-mixed.mp4"]
      .map((name) => path.join(outDir, name))
      .find((p) => existsSync(p));
    if (src === undefined) {
      console.error(`missing final mp4 under ${outDir} (final-faststart.mp4 / final-mixed.mp4)`);
      console.error(`  run \`video make <project>\` first`);
      return 1;
    }
    // Window: full story by default (hook → payoff). An explicit
    // --duration cuts a scene-aligned teaser; an explicit --start wins
    // verbatim for manual surgical cuts.
    const masterDur = await probeDurationSec(src);
    const explicitStart = opts.startSec ?? -1;
    const timings = await readSceneTimings(projectRoot).catch(() => []);
    const window = selectShortsWindow(timings, masterDur, opts.durationSec);
    const start = explicitStart >= 0 ? explicitStart : window.start;
    const duration =
      explicitStart >= 0 ? (opts.durationSec ?? 60) : window.end - window.start;
    // Full-length vertical master: stream-copy remux — the master's own
    // hook/outro already carry the polish, and re-encoding 3 minutes buys
    // nothing. Anything else (landscape master, teaser, manual window)
    // goes through the re-encode cut.
    if (window.full && explicitStart < 0 && (await isVerticalVideo(src))) {
      try {
        await execFileAsync("ffmpeg", [
          "-y",
          "-i",
          src,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          shortsPath,
        ]);
      } catch (err) {
        console.error(`ffmpeg failed: ${(err as Error).message}`);
        return 1;
      }
    } else {
      try {
        await shortsFfmpeg(src, shortsPath, start, duration);
      } catch (err) {
        console.error(`ffmpeg failed: ${(err as Error).message}`);
        return 1;
      }
    }
    if (window.full && masterDur > 180) {
      console.log(
        `  note: ${Math.round(masterDur)} s exceeds YouTube's 180 s Shorts cap — it uploads as a regular video; pass --duration <sec> for a scene-aligned teaser`,
      );
    }
    const hash = createHash("sha256")
      .update(`${src}|${start}|${duration}`)
      .digest("hex");
    runRecord = {
      provider: "ffmpeg",
      model: window.full
        ? `9:16 1080x1920 full@${start}`
        : `9:16 1080x1920 ${duration}s@${start}`,
      input_files: [path.relative(projectRoot, src)],
      prompt_hash: "sha256:" + hash,
    };
  }

  const runId = formatRunId("shorts");
  const record = {
    run_id: runId,
    stage: "shorts",
    status: "succeeded" as const,
    actor: "tool" as const,
    tool: runRecord.provider,
    input_commit: safeGitHead(projectRoot),
    input_files: runRecord.input_files,
    output_files: ["youtube/shorts.mp4"],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: runRecord.provider,
    model: runRecord.model,
    prompt_hash: runRecord.prompt_hash,
    tokens: { input: 0, output: 0 },
    estimated_cost_usd: 0,
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(`\u2713 extracted ${opts.project}/youtube/shorts.mp4`);
  console.log(
    `  provider=${runRecord.provider}  model=${runRecord.model}  hash=${runRecord.prompt_hash.slice(7, 19)}…`,
  );
  console.log(`  next: upload shorts.mp4 as a YouTube Short`);
  return 0;
}

export function registerShorts(program: Command): void {
  program
    .command("shorts")
    .argument(
      "<project>",
      "project to clip: topic, folder name, path, or unique prefix",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--duration <seconds>",
      "teaser length; the cut ends on the last scene boundary that fits (default: the full film, hook through payoff)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--start <seconds>",
      "start offset into the master (mock provider only; default 0 — keep the scene-01 hook)",
      (v) => parseInt(v, 10),
    )
    .option(
      "--provider <name>",
      "video provider: mock|minimax (default mock — minimax needs MINIMAX_API_KEY)",
    )
    .action(
      async (
        project: string,
        opts: {
          cwd?: string;
          duration?: number;
          start?: number;
          provider?: "mock" | "minimax";
        },
      ) => {
        process.exitCode = await runShorts({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.duration !== undefined
            ? { durationSec: opts.duration }
            : {}),
          ...(opts.start !== undefined ? { startSec: opts.start } : {}),
          ...(opts.provider !== undefined
            ? { providerName: opts.provider }
            : {}),
        });
      },
    );
}
