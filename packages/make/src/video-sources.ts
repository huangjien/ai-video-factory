import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Provider } from "@video/llm";
import type { ParsedArticle } from "@video/draft";
import type { SceneVideoPlan } from "@video/video-sources";

/** Re-exported so callers of this module can type plans without reaching
 *  into @video/video-sources directly. */
export type { SceneVideoPlan };
import {
  CommonsVideoSource,
  collectVideoCandidates,
  downloadClip,
  matchSceneVideos,
  pickBestVideo,
  planSceneVideos,
  preprocessClip,
  readAllSceneVideoSources,
  readVideoPlanCache,
  recordFromResolution,
  resolveSceneVideo,
  videoDigest,
  videoPlanCacheKey,
  writeSceneVideoSource,
  writeVideoAttributionFile,
  writeVideoPlanCache,
  type SceneVideoPick,
  type SceneVideoResolution,
  type VideoSource,
} from "@video/video-sources";

/**
 * The make-side orchestration of public-domain footage retrieval — the
 * video sibling of image-sources.ts, with one extra stage: a found clip
 * is DOWNLOADED and PREPROCESSED (crop 1080×1920, strip audio, trim to
 * the scene duration) before the pipeline moves on, so the render-side
 * binding (assets/video/scene_N.mp4 ⇒ VideoBackground) is pure file
 * existence.
 *
 * Steps, in order, every one allowed to fail:
 *  1. PLAN-V — one LLM call for the whole article (cached per project).
 *  2. RETRIEVE — only the footage-suitable scenes spend network.
 *  3. MATCH — one LLM call picks the real subject among candidates.
 *  4. RESOLVE + DOWNLOAD + PREPROCESS — the clip lands at
 *     assets/video/scene_N.mp4 with its attribution sidecar.
 *
 * A failure at any step turns the feature off for this run; the film
 * renders exactly as it did before this feature existed.
 */

/** Whether the retrieval runs at all. "off" is the default until the
 *  first live run is reviewed — the default lives in
 *  `resolveVideoSourcesMode`, in ONE place. */
export type VideoSourcesMode = "on" | "off";

/** The mode, from the CLI flag, the article frontmatter, or the default. */
export function resolveVideoSourcesMode(
  explicit: VideoSourcesMode | undefined,
  frontmatter: string | undefined,
): VideoSourcesMode {
  if (explicit !== undefined) return explicit;
  const raw = (frontmatter ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "true" || raw === "yes") return "on";
  // "off"/typo/absent → OFF. Opt-in until proven.
  return "off";
}

/** Parse the CLI's `--video-sources` value. An unknown value is ignored
 *  (undefined) so the article frontmatter or the default decides. */
export function parseVideoSourcesMode(
  raw: string | undefined,
): VideoSourcesMode | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "off" || value === "none" || value === "false" || value === "no") {
    return "off";
  }
  if (value === "on" || value === "true" || value === "yes") return "on";
  return undefined;
}

export interface VideoSourcesOutcome {
  /** Scene numbers whose background is now a clip on disk. The image
   *  stage must skip them — a generated jpg behind a VideoBackground
   *  is money burned on pixels nobody sees. */
  videoScenes: number[];
  /** Scene number → resolution (for the run log and tests). */
  resolutions: Map<number, SceneVideoResolution>;
  plan: SceneVideoPlan[];
  notes: string[];
  /** True when a plan ran — false means the feature was off or the plan
   *  failed, and no network was spent. */
  planned: boolean;
}

const EMPTY: VideoSourcesOutcome = {
  videoScenes: [],
  resolutions: new Map(),
  plan: [],
  notes: [],
  planned: false,
};

export async function resolveVideoSourcesForScenes(opts: {
  projectRoot: string;
  article: ParsedArticle;
  /** The LLM that writes the plan. Null → the plan must come pre-computed
   *  (the injection seam for callers and tests that already know which
   *  scenes are footage-worthy). */
  provider: Provider | null;
  mode: VideoSourcesMode;
  /** Rendered duration of each scene, 1-based (index 0 = scene 1) — the
   *  preprocess trim target AND the coverage filter. Absent → accept any
   *  length and keep the clip whole. */
  sceneDurationsSec?: number[] | undefined;
  /** A pre-computed plan — the injection seam for callers (and tests). */
  plan?: SceneVideoPlan[] | undefined;
  /** The clip sources to search. Defaults to Commons video only. */
  sources?: VideoSource[] | undefined;
}): Promise<VideoSourcesOutcome> {
  if (opts.mode === "off") return EMPTY;
  if (opts.provider === null && opts.plan === undefined) return EMPTY;

  const scenes = opts.article.scenes.map((scene, i) => ({
    scene: i + 1,
    id: scene.id ?? `scene_${i + 1}`,
    visual: scene.visual ?? "",
    ...(scene.caption !== undefined ? { caption: scene.caption } : {}),
    ...(scene.narration !== undefined ? { narration: scene.narration } : {}),
  }));

  let plan: SceneVideoPlan[];
  let reusedPlan = false;
  if (opts.plan !== undefined) {
    plan = opts.plan;
  } else {
    const provider = opts.provider;
    if (provider === null) return EMPTY;
    const searchable = scenes.filter((s) => s.visual.trim() !== "");
    if (searchable.length === 0) return EMPTY;
    const title = opts.article.title ?? "";
    const setting = opts.article.frontmatter.setting;
    const cacheKey = videoPlanCacheKey({
      title,
      ...(setting !== undefined ? { setting } : {}),
      scenes: searchable,
    });
    const cached = readVideoPlanCache(opts.projectRoot, cacheKey);
    if (cached !== null) {
      plan = cached;
      reusedPlan = true;
    } else {
      try {
        plan = await planSceneVideos(
          {
            title,
            ...(setting !== undefined ? { setting } : {}),
            scenes: searchable,
          },
          provider,
        );
        writeVideoPlanCache(opts.projectRoot, cacheKey, plan);
      } catch (err) {
        return {
          ...EMPTY,
          notes: [
            `video sources: plan failed (${(err as Error).message.slice(0, 60)}) — generating without footage`,
          ],
        };
      }
    }
  }

  const wanted = plan.filter((p) => p.historical);
  const notes: string[] = [];
  if (reusedPlan) notes.push("video sources: reusing the project's cached plan");
  if (wanted.length === 0) {
    notes.push("video sources: no footage-worthy scene in this video");
    return { ...EMPTY, plan, notes, planned: true };
  }

  const sources = opts.sources ?? [new CommonsVideoSource()];
  const candidates = await collectVideoCandidates(plan, { sources });

  // The matcher picks the real subject among the candidates; without it
  // the token-scored pick stands in.
  let picks: Map<number, number> = new Map();
  if (opts.provider !== null && candidates.size > 0) {
    const matchScenes = [...candidates.entries()]
      .map(([scene, list]) => {
        const planned = plan.find((p) => p.scene === scene);
        return {
          scene,
          subject: planned?.subject ?? "",
          candidates: list.map((c) => ({
            title: c.title,
            source: c.source,
            pageUrl: c.pageUrl,
            durationSec: c.durationSec,
          })),
        };
      })
      .filter((s) => s.candidates.length > 0);
    try {
      picks = await matchSceneVideos(matchScenes, opts.provider);
    } catch (err) {
      notes.push(
        `video sources: matching failed (${(err as Error).message.slice(0, 60)}) — falling back to the search order`,
      );
      picks = new Map();
    }
  }

  const videoDir = path.join(opts.projectRoot, "assets", "video");
  const durationOf = (scene: number): number =>
    opts.sceneDurationsSec?.[scene - 1] ?? 0;

  const resolutions = new Map<number, SceneVideoResolution>();
  const videoScenes: number[] = [];
  for (const [scene, list] of candidates) {
    const planned = plan.find((p) => p.scene === scene);
    const query = planned?.query ?? "";
    const minDuration = durationOf(scene);
    let chosen: SceneVideoPick;
    const index = picks.get(scene);
    if (index !== undefined && index < 0) {
      // The matcher said "none of these" — the scene keeps its art.
      resolutions.set(scene, {
        scene,
        candidate: null,
        localPath: null,
        digest: "",
        sha256: "",
        note: "matcher rejected every candidate",
      });
      continue;
    }
    if (index !== undefined && index < list.length) {
      const forced = [list[index]!];
      chosen = {
        candidate: pickBestVideo(forced, query) ?? forced[0]!,
        note: "",
      };
    } else {
      chosen = resolveSceneVideo(list, query, minDuration);
    }
    if (chosen.candidate === null) {
      resolutions.set(scene, {
        scene,
        candidate: null,
        localPath: null,
        digest: "",
        sha256: "",
        note: chosen.note,
      });
      notes.push(`scene ${scene}: ${chosen.note}`);
      continue;
    }
    // Download → preprocess → sidecar. Any failure = no clip, scene
    // falls back to its generated image.
    const downloaded = await downloadClip(chosen.candidate.fileUrl);
    if (downloaded === null) {
      resolutions.set(scene, {
        scene,
        candidate: null,
        localPath: null,
        digest: "",
        sha256: "",
        note: "download failed",
      });
      notes.push(`scene ${scene}: clip download failed`);
      continue;
    }
    const outputPath = path.join(videoDir, `scene_${scene}.mp4`);
    try {
      await mkdir(videoDir, { recursive: true });
      await preprocessClip({
        input: downloaded.rawPath,
        output: outputPath,
        ...(minDuration > 0 ? { durationSec: minDuration } : {}),
      });
    } catch (err) {
      resolutions.set(scene, {
        scene,
        candidate: null,
        localPath: null,
        digest: "",
        sha256: "",
        note: `preprocess failed: ${(err as Error).message.slice(0, 40)}`,
      });
      notes.push(`scene ${scene}: clip preprocess failed`);
      await rm(downloaded.rawPath, { force: true }).catch(() => {});
      continue;
    }
    await rm(downloaded.rawPath, { force: true }).catch(() => {});
    const resolution: SceneVideoResolution = {
      scene,
      candidate: chosen.candidate,
      localPath: outputPath,
      digest: videoDigest(chosen.candidate),
      sha256: downloaded.sha256,
      note: `${chosen.note}${minDuration > 0 ? `, trimmed to ${minDuration} s` : ""}`,
    };
    resolutions.set(scene, resolution);
    const record = recordFromResolution(resolution);
    if (record !== null) writeSceneVideoSource(videoDir, scene, record);
    videoScenes.push(scene);
    notes.push(`scene ${scene}: ${resolution.note}`);
  }

  writeVideoAttributionFile(videoDir, readAllSceneVideoSources(videoDir));
  notes.push(
    `video sources: ${wanted.length} footage scene(s) planned, ${videoScenes.length} with a clip on disk`,
  );
  return { videoScenes, resolutions, plan, notes, planned: true };
}
