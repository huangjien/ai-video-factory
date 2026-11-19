/**
 * Historical picture retrieval — the vocabulary of the layer.
 *
 * The pipeline asks: "is there a real, freely-licensed picture of the thing
 * this scene shows?" A picture answers with a `HistoricalCandidate`; the
 * scene's `SceneSourcePlan` says HOW to use it.
 */

/** How a retrieved picture is used for one scene.
 *  - `direct`   — the picture IS the scene image (an artifact, a portrait).
 *  - `reference` — the picture is fed to the image model as a reference, and
 *    the model draws a composed scene that borrows its likeness/period detail.
 *  - `none`     — nothing retrieved; the scene is generated from text alone. */
export type SourceMode = "direct" | "reference" | "none";

/** Where a picture came from. */
export type PictureSourceName =
  | "commons"
  | "wikipedia"
  | "artifact"
  | "met"
  | "smithsonian"
  | "openverse";

/** One retrieved picture, with everything needed to credit it. */
export interface HistoricalCandidate {
  source: PictureSourceName;
  /** Human-readable title — the file name, the object title, the sheet name. */
  title: string;
  /** Where a human can check the picture and its license. */
  pageUrl: string;
  /** Direct bytes URL. Empty for on-disk artifacts. */
  fileUrl: string;
  /** Absolute path for on-disk artifacts. Null for network sources. */
  localPath: string | null;
  /** Creator/artist, plain text. Empty when unknown. */
  author: string;
  /** Normalized license code — `PD`, `CC0`, `PDM`, `OWNED`, … */
  license: string;
  /** Where the license text lives. Empty when unknown. */
  licenseUrl: string;
  width: number | null;
  height: number | null;
  /**
   * Identity of the picture for cache purposes. Network sources use the
   * bytes URL; on-disk artifacts use the path PLUS the file's content hash
   * (a re-rendered character sheet must invalidate the scene that used it).
   */
  digestKey: string;
  /** The search terms that surfaced it. */
  query: string;
  /** Owned by the project (AI-generated art, character sheets) — no
   *  third-party rights, so the license filter does not apply. */
  owned: boolean;
  /** True when the picture may BE the frame (`direct` mode). An archive
   *  picture may; the film's own character art may not — showing the
   *  cast sheet on screen would put the drawing, not the person, in the
   *  shot. It can still inform a generated frame as a reference. */
  directEligible: boolean;
}

export interface PictureSearchOptions {
  /** Maximum candidates to return. */
  limit: number;
  signal?: AbortSignal | undefined;
}

/** A source of pictures. Every source answers the same question: "what
 *  freely-licensed pictures exist for these terms?" */
export interface PictureSource {
  readonly name: PictureSourceName;
  /** True when the source needs no network (on-disk artifacts). */
  readonly offline: boolean;
  search(
    query: string,
    opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]>;
}

/** The plan for ONE scene: is it historical, what do we look for, and how
 *  do we use what we find. */
export interface SceneSourcePlan {
  /** 1-based scene number. */
  scene: number;
  /** False → the scene is not about a real historical subject; skip retrieval. */
  historical: boolean;
  /** The real-world subject, if any ("Li Shimin"). Empty when not historical. */
  subject: string;
  /** Search terms for the picture sources. */
  query: string;
  mode: SourceMode;
  /** Why the planner chose this mode — kept for the run log. */
  reason: string;
}

/** The resolved outcome for one scene: the plan, the picture that was found
 *  (if any), and the cache digest of that choice. */
export interface SceneSourceResolution {
  scene: number;
  mode: SourceMode;
  candidate: HistoricalCandidate | null;
  /** Cache-key term: "" when no picture is used. */
  digest: string;
  /** One-line explanation for the run log. */
  note: string;
}
