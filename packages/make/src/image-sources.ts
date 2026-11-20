import type { Provider } from "@video/llm";
import type { ParsedArticle } from "@video/draft";
import {
  collectCandidates,
  defaultPictureSources,
  matchSceneSources,
  pickBest,
  planSceneSources,
  resolutionAsFrame,
  resolveSceneSource,
  type PictureSource,
  type SceneSourcePlan,
  type SceneSourceResolution,
} from "@video/image-sources";

/**
 * The make-side orchestration of historical picture retrieval.
 *
 * Three steps, in this order, and every one of them is allowed to fail:
 *  1. PLAN — one LLM call for the whole article says which scenes are
 *     about a real historical subject and how to use the picture.
 *  2. RETRIEVE — only the scenes the plan marked historical spend a
 *     network round-trip. A non-history film pays nothing.
 *  3. RESOLVE — the picture, its mode, and the cache digest it produces.
 *
 * A failure at any step turns the feature off for this run. The run
 * continues exactly as it did before this feature existed; no scene fails
 * because a picture archive was down.
 */

/** Whether the retrieval runs at all. "on" = run it for historical
 *  scenes; "off" = never. */
export type ImageSourcesMode = "on" | "off";

/** The mode, from the CLI flag, the article frontmatter, or the default. */
export function resolveImageSourcesMode(
  explicit: ImageSourcesMode | undefined,
  frontmatter: string | undefined,
): ImageSourcesMode {
  if (explicit !== undefined) return explicit;
  const raw = (frontmatter ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "no" || raw === "0") {
    return "off";
  }
  // "on"/"true"/"auto"/absent/typo → the default, which is "on". The
  // frontmatter is hand-edited; an unknown value must not brick the run.
  return "on";
}

/** Parse the CLI's `--image-sources` value. An unknown value is ignored
 *  (undefined) so the article frontmatter or the default decides.
 *  "auto" is accepted as the older spelling of "on". */
export function parseImageSourcesMode(
  raw: string | undefined,
): ImageSourcesMode | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "off" || value === "none" || value === "false" || value === "no") {
    return "off";
  }
  if (value === "on" || value === "auto" || value === "true" || value === "yes") {
    return "on";
  }
  return undefined;
}

export interface HistoricalSourceOutcome {
  /** Scene number → the picture to use and how. */
  resolutions: Map<number, SceneSourceResolution>;
  /** The plan, for the run log and the tests. */
  plan: SceneSourcePlan[];
  /** Run-report lines. */
  notes: string[];
  /** True when a plan ran — false means the feature was off or the plan
   *  failed, and no network was spent. */
  planned: boolean;
}

const EMPTY: HistoricalSourceOutcome = {
  resolutions: new Map(),
  plan: [],
  notes: [],
  planned: false,
};

export async function resolveHistoricalSources(opts: {
  projectRoot: string;
  article: ParsedArticle;
  workspaceRoot: string | null;
  /** The LLM that writes the plan. Null → the feature is off (the mock
   *  provider has no network contract of its own). */
  provider: Provider | null;
  mode: ImageSourcesMode;
  /** A pre-computed plan — the injection seam for callers (and tests)
   *  that already know which scenes are historical. */
  plan?: SceneSourcePlan[] | undefined;
  /** The picture sources to search. Defaults to the standard set. */
  sources?: PictureSource[] | undefined;
  /** True when one of the image providers can take a reference image.
   *  False → a `reference` plan becomes a `direct` one: a picture the
   *  model cannot be shown alongside is better used as the frame than
   *  dropped. Defaults to false — the safe side of the choice. */
  referenceCapable?: boolean | undefined;
}): Promise<HistoricalSourceOutcome> {
  if (opts.mode === "off") return EMPTY;
  // A pre-computed plan needs no LLM — the caller already decided.
  if (opts.provider === null && opts.plan === undefined) return EMPTY;

  const scenes = opts.article.scenes.map((scene, i) => ({
    scene: i + 1,
    id: scene.id ?? `scene_${i + 1}`,
    visual: scene.visual ?? "",
    ...(scene.caption !== undefined ? { caption: scene.caption } : {}),
    ...(scene.narration !== undefined ? { narration: scene.narration } : {}),
  }));

  let plan: SceneSourcePlan[];
  if (opts.plan !== undefined) {
    plan = opts.plan;
  } else {
    const provider = opts.provider;
    if (provider === null) return EMPTY;
    // Nothing to look for without a visual direction.
    const searchable = scenes.filter((s) => s.visual.trim() !== "");
    if (searchable.length === 0) return EMPTY;
    try {
      plan = await planSceneSources(
        {
          title: opts.article.title ?? "",
          ...(opts.article.frontmatter.setting !== undefined
            ? { setting: opts.article.frontmatter.setting }
            : {}),
          scenes: searchable,
        },
        provider,
      );
    } catch (err) {
      // A failed plan is not a failed run — the feature switches itself off.
      return {
        ...EMPTY,
        notes: [
          `historical pictures: plan failed (${(err as Error).message.slice(0, 60)}) — generating without them`,
        ],
      };
    }
  }

  const historical = plan.filter((p) => p.historical && p.mode !== "none");
  const notes: string[] = [];
  if (historical.length === 0) {
    notes.push("historical pictures: no historical scene in this video");
    return { resolutions: new Map(), plan, notes, planned: true };
  }

  const sources =
    opts.sources ??
    defaultPictureSources({
      projectRoot: opts.projectRoot,
      workspaceRoot: opts.workspaceRoot,
    });
  const candidates = await collectCandidates(plan, { sources });

  // The matcher: an archive matches STRINGS, so a query for 李治 can
  // return a Song-dynasty portrait. One LLM call for the whole video
  // decides which picture is really the subject. Without it, the
  // token-scored pick stands in — and it is wrong across languages.
  const provider = opts.provider;
  let picks: Map<number, number> = new Map();
  if (provider !== null && candidates.size > 0) {
    const scenes = [...candidates.entries()]
      .map(([scene, list]) => {
        const planned = plan.find((p) => p.scene === scene);
        return {
          scene,
          subject: planned?.subject ?? "",
          mode: planned?.mode ?? ("none" as const),
          candidates: list.map((c) => ({
            title: c.title,
            source: c.source,
            pageUrl: c.pageUrl,
          })),
        };
      })
      .filter((s) => s.candidates.length > 0);
    try {
      picks = await matchSceneSources(scenes, provider);
    } catch (err) {
      notes.push(
        `historical pictures: matching failed (${(err as Error).message.slice(0, 60)}) — falling back to the search order`,
      );
      picks = new Map();
    }
  }

  const resolutions = new Map<number, SceneSourceResolution>();
  for (const [scene, list] of candidates) {
    const planned = plan.find((p) => p.scene === scene);
    const index = picks.get(scene);
    const chosen =
      index !== undefined && index >= 0 && index < list.length
        ? list[index]!
        : index === undefined
          ? // The matcher did not answer for this scene — fall back to the
            // search order.
            (list.length > 0 ? pickBest(list, planned?.query ?? "") : null)
          : // The matcher answered "none": this scene gets no picture.
            null;
    const resolution = resolveSceneSource(
      scene,
      planned?.mode ?? "none",
      chosen === null ? [] : [chosen],
      planned?.query ?? "",
    );
    // A reference the providers cannot take is a picture that never
    // reaches the screen. When no provider can take one, the picture
    // becomes the frame instead — unless it may not be the frame, in
    // which case the scene drops it and says so.
    if (resolution.mode === "reference" && opts.referenceCapable !== true) {
      const asFrame = resolutionAsFrame(resolution);
      if (asFrame.mode === "direct") {
        resolutions.set(scene, asFrame);
        notes.push(
          `scene ${scene}: no reference-capable image provider — the picture becomes the frame`,
        );
        continue;
      }
      resolutions.set(scene, {
        ...resolution,
        mode: "none",
        candidate: null,
        digest: "",
        note: "no reference-capable image provider",
      });
      notes.push(
        `scene ${scene}: no reference-capable image provider — generating without the historical picture`,
      );
      continue;
    }
    resolutions.set(scene, resolution);
  }
  const found = [...resolutions.values()].filter((r) => r.mode !== "none");
  notes.push(
    `historical pictures: ${historical.length} historical scene(s) planned, ${found.length} with a freely-licensed picture`,
  );
  for (const r of resolutions.values()) {
    if (r.mode === "none") continue;
    notes.push(`scene ${r.scene}: ${r.note}`);
  }
  return { resolutions, plan, notes, planned: true };
}
