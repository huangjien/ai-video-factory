/**
 * Public-domain video retrieval — the vocabulary of the layer.
 *
 * The pipeline asks: "is there a real, freely-licensed FILM of the thing
 * this scene shows?" A clip answers with a `VideoCandidate`; the scene's
 * `SceneVideoPlan` says what to look for. The licence gate is the same one
 * the pictures use: PD / CC0 / PDM only.
 */

/** Where a clip came from. One source in v1 — Commons is the only archive
 *  whose video files carry machine-readable licence records. */
export type VideoSourceName = "commons-video";

/** One retrieved clip, with everything needed to credit it. */
export interface VideoCandidate {
  source: VideoSourceName;
  /** Human-readable title — the file name. */
  title: string;
  /** Where a human can check the clip and its licence. */
  pageUrl: string;
  /** Direct bytes URL (the original transcode). */
  fileUrl: string;
  /** Creator/uploader, plain text. Empty when unknown. */
  author: string;
  /** Normalized licence code — `PD`, `CC0`, `PDM`, … */
  license: string;
  /** Where the licence text lives. Empty when unknown. */
  licenseUrl: string;
  width: number | null;
  height: number | null;
  /** Playback length in seconds; null when the record does not say.
   *  A clip of unknown length cannot be trusted to cover a scene and
   *  is rejected at resolve time. */
  durationSec: number | null;
  /** Bytes of the original file, when the record says. */
  sizeBytes: number | null;
  /** Identity of the clip for cache purposes: the bytes URL + licence. */
  digestKey: string;
  /** The search terms that surfaced it. */
  query: string;
}

export interface VideoSearchOptions {
  /** Maximum candidates to return. */
  limit: number;
  signal?: AbortSignal | undefined;
}

/** A source of clips. Answers one question: "what freely-licensed films
 *  exist for these terms?" */
export interface VideoSource {
  readonly name: VideoSourceName;
  search(query: string, opts: VideoSearchOptions): Promise<VideoCandidate[]>;
}

/** The plan for ONE scene: is it footage-suitable, and what to look for.
 *  There is no `mode` — a clip is always the scene's background, full
 *  bleed, narration and captions unchanged. */
export interface SceneVideoPlan {
  /** 1-based scene number. */
  scene: number;
  /** False → not footage-suitable; skip retrieval. */
  historical: boolean;
  /** The real-world subject, if any. Empty when not historical. */
  subject: string;
  /** Search terms for the clip sources. */
  query: string;
  /** Why the planner chose this — kept for the run log. */
  reason: string;
}

/** The resolved outcome for one scene: the clip that was found (if any),
 *  where it landed on disk, and the cache digest of that choice. */
export interface SceneVideoResolution {
  scene: number;
  candidate: VideoCandidate | null;
  /** Absolute path of the preprocessed `scene_N.mp4`; null when no clip. */
  localPath: string | null;
  /** Cache-key term: "" when no clip is used. */
  digest: string;
  /** sha256 of the ORIGINAL downloaded bytes; "" when no clip. */
  sha256: string;
  /** One-line explanation for the run log. */
  note: string;
}

/** One scene's pick: the winning clip, or null with a reason. */
export interface SceneVideoPick {
  candidate: VideoCandidate | null;
  note: string;
}
