import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * The scene-mp4 cache contract in one module: sidecar schema, file naming,
 * content digests, and the single freshness comparison.
 *
 * Two callers with different knowledge share it:
 *  - the renderer (write side) — computes its terms from the COMPILED
 *    render plan and records them in the sidecar;
 *  - `video make --dry-run` (read side) — computes the subset it can
 *    derive offline from storyboard.yaml and asks the SAME comparison,
 *    so a new freshness term can no longer be patched into one side and
 *    forgotten in the other (the "lying dry-run" incident class,
 *    2026-10-17 captions and 2026-10-24 image bytes).
 */

export interface SceneCacheMeta {
  sceneHash: string;
  /** Hash of project-level render inputs (style.theme + project geometry).
   * Absent on sidecars written before this field existed — treated as a
   * mismatch so legacy caches invalidate exactly once. */
  projectHash?: string;
  /** Hash of the scene's COMPILED caption lines. The storyboard fragment
   * cannot see wrapText output: a change to @video/media's wrapText or the
   * compile-time caption width alters the burned-in lines while every
   * fragment hash stays identical. Absent on legacy sidecars — mismatch. */
  captionsHash?: string;
  /** `RENDERER_REVISION` that produced these pixels. Explicit rather than
   * folded into `projectHash` so `video make --dry-run` can check it with a
   * string compare — the dry-run has no compiled renderPlan and must not
   * reconstruct one just to answer "will this re-render?". */
  rendererRevision?: string;
  /** sha256 (first 16 hex) of the scene image's CONTENT (ImageBackground
   * scenes only). Absent on sidecars written before this field existed —
   * treated as a mismatch on image scenes so legacy caches invalidate
   * exactly once (2026-10-24: same-prompt image regeneration changed
   * bytes without moving the fragment hash, replaying old renders). */
  imageHash?: string;
  /** sha256 (first 16 hex) of the Pillow text-overlay PNG composited onto
   * the scene (ImageBackground scenes with `textOverlaySrc`). The overlay
   * is a RENDER input — it is composited into the frame — so a regenerated
   * banner must invalidate the cached scene mp4 (2026-10-24: the zh
   * banners were re-rendered with a CJK font while the scene mp4s kept
   * the tofu boxes baked in). Absent on legacy sidecars — mismatch. */
  overlayHash?: string;
  audioPath?: string;
  audioMtimeMs?: number;
  renderedAt: string;
}

/**
 * Identity of the renderer build, recorded in every scene cache sidecar.
 *
 * The cache decides freshness from the storyboard fragment, the project
 * inputs, and the audio. None of those move when the RENDERER changes —
 * editing a component's colour, type size, or layout leaves all three
 * identical, so every cached scene mp4 is replayed with the old pixels.
 * That is not hypothetical: changing the caption treatment on 2026-10-17
 * left all 59 cached scene mp4s across the four shipped projects matching,
 * i.e. the change was invisible in any re-render.
 *
 * Bump this whenever a change under `video-renderer/src` or
 * `video-components/src` alters what a frame looks like. It does NOT need
 * bumping for refactors with identical output — an unnecessary bump
 * re-renders every scene, which is expensive.
 *
 * Frame-affecting inputs also live OUTSIDE those two directories: the
 * compiled caption lines come from @video/media's `wrapText` and the vdsl
 * compiler (compile.ts). Caption-content changes are covered by the
 * sidecar's `captionsHash`, but a wrapText/compile change that alters
 * frames in other ways (timing, geometry) still requires a revision bump.
 *
 * Same contract as `IMAGE_PROMPT_REVISION` in @video/draft, and deliberately
 * manual: hashing the source tree would re-render on every comment edit.
 */
export const RENDERER_REVISION = "10";
// 2: caption type + halo + no-plate overlay
// 3: the title card preserves inter-word spaces — each glyph is its own flex
// item, so a bare space collapsed to zero width and headlines rendered run-on.
// 4: ImageBackground's caption band now shares captionStyle.ts geometry
// (bottom offset, max-width, padding) with the CaptionsOverlay track and
// drops the title-face override — image-scene captions moved.
// 5: ImageBackground's veil is bottom-weighted (was a 0.45→0.65 full-frame
// wash, which cost a paper-white ground half its luma), the img no longer
// fades in, and `kenBurnsScale: 0` now freezes the opacity ramps too.
// 6: captions are timed cues — the overlay draws only the cue active at the
// current frame, so a scene's narration can no longer stack past two rows.
// 7: the per-scene corner watermark honours `brand.watermark: false`, so a
// project can drop the inherited mark without dropping the rest of the brand.
// 8: the film's head and tail fade through black (0.8s) — the opening no
// longer starts on a bare lit canvas with the voice already talking.
// 9: the edge fade covers the branding chrome too (the corner watermark
// sat above it), and the caption overlay no longer paints a cue before
// the scene's first cue starts (the lead-in beat).
// 10: the edge fade belongs to the FILM, not to every scene — a sliced
// per-scene render carried no film context, so every scene faded to
// black at its own edges.

/** Cache directory for a project — final renders in `scenes/`, draft-mode
 *  (960x540@15) renders in `scenes-draft/`. */
export function scenesDirFor(root: string, draft: boolean): string {
  return path.join(root, draft ? "scenes-draft" : "scenes");
}

/** Per-scene cache file name: index-prefixed (stable concat order) with a
 *  filesystem-safe slug of the scene id. The sidecar is `<this>.json`. */
export function sceneFileName(index: number, id: string): string {
  const slug = id.replace(/[^a-zA-Z0-9_-]+/g, "_") || "scene";
  return `${String(index).padStart(2, "0")}-${slug}.mp4`;
}

/** Full path of a scene's cache mp4 (sidecar: append `.json`). */
export function sceneCacheFile(
  scenesDir: string,
  index: number,
  id: string,
): string {
  return path.join(scenesDir, sceneFileName(index, id));
}

/** Freshness terms a caller can compute. The renderer passes every field;
 * `video make --dry-run` passes the subset derivable offline from
 * storyboard.yaml — omitted fields are SKIPPED, never guessed, so the
 * impact table can only under-predict work (the honest direction), while
 * every field it does pass is enforced with the renderer's exact rule. */
export interface SceneCacheTerms {
  /** Fragment hash; null when the fragment is unresolvable ⇒ never fresh. */
  sceneHash: string | null;
  /** Strict compare (legacy sidecars lacking it invalidate exactly once). */
  projectHash?: string;
  /** Defaults to the current `RENDERER_REVISION`. */
  rendererRevision?: string;
  /** null/undefined ⇒ term skipped. */
  captionsHash?: string | null;
  /** null/undefined ⇒ term skipped. */
  imageHash?: string | null;
  /** Pillow overlay PNG digest; null/undefined ⇒ term skipped. */
  overlayHash?: string | null;
  /** Omitted ⇒ audio terms skipped. */
  audio?: { path: string | null; mtimeMs: number };
}

/** Cache freshness: the scene fragment, the narration audio, AND every
 *  project-level render input (theme, fps/width/height) must match. A
 *  style.theme flip leaves all fragment hashes identical — without the
 *  projectHash term it silently reused the old-theme MP4s. Optional terms
 *  (captionsHash, imageHash, overlayHash, audio) are skipped when the caller omits
 *  them, never silently satisfied. */
export function sceneCacheIsFresh(
  meta: SceneCacheMeta | null,
  terms: SceneCacheTerms,
): boolean {
  return (
    meta !== null &&
    terms.sceneHash !== null &&
    meta.sceneHash === terms.sceneHash &&
    // Absent on sidecars written before the field existed — a mismatch,
    // so pre-existing caches invalidate exactly once.
    (terms.projectHash === undefined ||
      meta.projectHash === terms.projectHash) &&
    meta.rendererRevision === (terms.rendererRevision ?? RENDERER_REVISION) &&
    (terms.captionsHash == null || meta.captionsHash === terms.captionsHash) &&
    (terms.imageHash == null || meta.imageHash === terms.imageHash) &&
    (terms.overlayHash == null || meta.overlayHash === terms.overlayHash) &&
    (terms.audio === undefined ||
      ((meta.audioPath ?? null) === terms.audio.path &&
        Math.abs((meta.audioMtimeMs ?? 0) - terms.audio.mtimeMs) < 1))
  );
}

/** Content digest of a scene image, in the sidecar convention shared with
 * bake-text.ts (`sha256:` + first 16 hex of sha256). Accepts a file path OR
 * a `data:` URI — the compiled render plan embeds scene images as base64
 * data URIs (Remotion bundling), while the dry-run only ever sees the file
 * path; hashing the DECODED bytes keeps both sides identical. Null when
 * the file is missing/unreadable — the freshness term is then skipped
 * rather than falsely stale (a missing jpg fails the render on its own). */
export function sceneImageDigest(src: string): string | null {
  try {
    const data =
      src.startsWith("data:") && src.includes(";base64,")
        ? Buffer.from(src.slice(src.indexOf(";base64,") + 8), "base64")
        : readFileSync(src);
    const hex = createHash("sha256").update(data).digest("hex");
    return `sha256:${hex.slice(0, 16)}`;
  } catch {
    return null;
  }
}

/** Read a scene's sidecar; null when absent/corrupt (⇒ not fresh). */
export function readSceneCacheMeta(file: string): SceneCacheMeta | null {
  try {
    return JSON.parse(readFileSync(`${file}.json`, "utf8")) as SceneCacheMeta;
  } catch {
    return null;
  }
}

export function writeSceneCacheMeta(file: string, meta: SceneCacheMeta): void {
  writeFileSync(`${file}.json`, JSON.stringify(meta, null, 2), "utf8");
}
