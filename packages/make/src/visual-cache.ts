import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Storyboard scene order + component map (shared by generateSceneVisuals
 * and the read-only impact report — one source, no drift).
 *
 * `selfRendered` = scenes whose component draws its own visuals, i.e. every
 * component EXCEPT the two that consume assets/images/scene_N.jpg:
 * `AnimatedIllustration` (the generator switches it to ImageBackground once
 * an image exists) and `ImageBackground` (already bound to its image — a
 * changed `visual:` must be able to regenerate it; v0.8 G1).
 */
export function storyboardSceneComponents(projectRoot: string): {
  ids: string[];
  components: Map<number, string>;
} {
  const ids: string[] = [];
  const components = new Map<number, string>();
  try {
    const parsed = parseYaml(
      readFileSync(
        path.join(projectRoot, "storyboard", "storyboard.yaml"),
        "utf8",
      ),
    ) as { scenes?: { id?: string; visual?: { component?: string } }[] };
    for (const s of parsed.scenes ?? []) {
      const m = s.id?.match(/scene[-_]?(\d+)/);
      if (!m) continue;
      const n = parseInt(m[1]!, 10);
      ids.push(s.id ?? "");
      components.set(n, s.visual?.component ?? "");
    }
  } catch {
    /* unreadable storyboard → treat as empty */
  }
  return { ids, components };
}

export function selfRenderedSceneNumbers(projectRoot: string): Set<number> {
  const { components } = storyboardSceneComponents(projectRoot);
  const out = new Set<number>();
  for (const [n, component] of components) {
    if (
      component === "AnimatedIllustration" ||
      component === "ImageBackground"
    ) {
      continue;
    }
    out.add(n);
  }
  return out;
}

/**
 * Visual asset caching + review state (v0.8 visual-guardrails plan, G1/G4).
 *
 * G1: image cache is content-keyed — a sidecar `scene_N.cache.json` next to
 * each `scene_N.jpg` records the inputs that produced the image. A changed
 * `visual:` line, image-style flip, or provider change produces a different
 * key ⇒ the stale jpg is deleted and regenerated.
 * Before v0.8 the cache keyed on file EXISTENCE ONLY, so an edited visual
 * direction never regenerated its image (ground truth, 2026-10-16).
 *
 * Legacy migration: an existing jpg with NO sidecar is adopted (sidecar
 * written with the current key, image kept) — upgrading must not trigger a
 * full paid re-generation of untouched scenes.
 */

export interface ImageCacheKeyInput {
  sceneNumber: number;
  /** Raw `visual:` direction text from article.md. */
  visual: string;
  imageStyle: string | undefined;
  provider: string;
  /** Digest of active human-review prompt rules ("" when none). A new
   *  lesson changes this, so the scenes it could improve regenerate
   *  instead of silently keeping pre-lesson art. */
  learnedDigest: string;
  /** Revision of the image-brief expander that produced the prompt this
   *  image was generated from (`IMAGE_PROMPT_REVISION` in @video/draft).
   *  A brief reworded after the fact no longer describes the image that
   *  came from it, so the image is stale on the same terms a changed
   *  `visual:` line is. */
  promptRevision: string;
  /** Digest of this scene's bake.json spec ("" when none). Baked text lives
   *  INSIDE the jpg, so an edited title must invalidate the cached image —
   *  otherwise the old typography ships forever behind a "fresh" key. */
  bakeDigest: string;
  width: number;
  height: number;
}

export function imageCacheKey(input: ImageCacheKeyInput): string {
  // Keyed on INPUTS, not the LLM-expanded prompt: expansion is itself
  // content-cached on disk, so same inputs ⇒ same expansion ⇒ same image
  // intent. This keeps the key computable before any provider is built
  // (dry-run / impact table need it offline).
  const stable = JSON.stringify([
    input.sceneNumber,
    input.visual.trim(),
    input.imageStyle ?? null,
    input.provider,
    input.learnedDigest,
    input.promptRevision,
    input.bakeDigest,
    input.width,
    input.height,
  ]);
  return "sha256:" + createHash("sha256").update(stable).digest("hex");
}

export interface ImageCacheSidecar {
  cacheKey: string;
  createdAt: string;
}

export function imageCacheSidecarPath(jpgPath: string): string {
  return jpgPath.replace(/\.jpg$/i, "") + ".cache.json";
}

export function readImageCacheSidecar(
  jpgPath: string,
): ImageCacheSidecar | null {
  try {
    const raw = JSON.parse(
      readFileSync(imageCacheSidecarPath(jpgPath), "utf8"),
    ) as Partial<ImageCacheSidecar>;
    if (
      typeof raw.cacheKey === "string" &&
      raw.cacheKey.startsWith("sha256:")
    ) {
      return { cacheKey: raw.cacheKey, createdAt: raw.createdAt ?? "" };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeImageCacheSidecar(
  jpgPath: string,
  cacheKey: string,
): void {
  writeFileSync(
    imageCacheSidecarPath(jpgPath),
    JSON.stringify({ cacheKey, createdAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

/** sha256 of a file's bytes, or null when unreadable. */
export function fileSha256(filePath: string): string | null {
  try {
    return (
      "sha256:" +
      createHash("sha256").update(readFileSync(filePath)).digest("hex")
    );
  } catch {
    return null;
  }
}

// ─── Visuals approval checkpoint (G4) ────────────────────────────────────────

export interface VisualsCheckpointEntry {
  hash: string;
  cacheKey?: string;
  status?: "approved" | "rejected";
  reason?: string;
  rejectedAt?: string;
}

export interface VisualsCheckpoint {
  schema: "visuals-checkpoint/1";
  approvedAt: string;
  actor: "human";
  scenes: Record<string, VisualsCheckpointEntry>;
}

export function visualsCheckpointPath(projectRoot: string): string {
  return path.join(projectRoot, "checkpoints", "visuals.yaml");
}

/** Parse the on-disk checkpoint (yaml). Null when absent/unreadable. */
export function readVisualsCheckpoint(
  projectRoot: string,
): VisualsCheckpoint | null {
  try {
    const raw = parseYaml(
      readFileSync(visualsCheckpointPath(projectRoot), "utf8"),
    ) as Partial<VisualsCheckpoint>;
    if (raw === null || typeof raw !== "object" || raw.scenes === undefined) {
      return null;
    }
    return {
      schema: "visuals-checkpoint/1",
      approvedAt: raw.approvedAt ?? "",
      actor: "human",
      scenes: raw.scenes,
    };
  } catch {
    return null;
  }
}

/** jpg scene numbers present in assets/images (sorted ascending). */
export function imageSceneNumbers(projectRoot: string): number[] {
  const imageDir = path.join(projectRoot, "assets", "images");
  if (!existsSync(imageDir)) return [];
  const nums: number[] = [];
  for (const f of readdirSync(imageDir)) {
    const m = f.match(/^scene[_-](\d+)\.jpg$/);
    if (m) nums.push(parseInt(m[1]!, 10));
  }
  return nums.sort((a, b) => a - b);
}

/** Write the checkpoint recording the CURRENT image set (hash + cache key
 * per scene that has an image on disk). Used by `video approve visuals`. */
export function writeVisualsCheckpoint(projectRoot: string): VisualsCheckpoint {
  const imageDir = path.join(projectRoot, "assets", "images");
  const scenes: Record<string, VisualsCheckpointEntry> = {};
  for (const n of imageSceneNumbers(projectRoot)) {
    const jpg = path.join(imageDir, `scene_${n}.jpg`);
    const hash = fileSha256(jpg);
    if (hash === null) continue;
    const sidecar = readImageCacheSidecar(jpg);
    scenes[`scene_${n}`] = {
      hash,
      ...(sidecar ? { cacheKey: sidecar.cacheKey } : {}),
      status: "approved",
    };
  }
  const checkpoint: VisualsCheckpoint = {
    schema: "visuals-checkpoint/1",
    approvedAt: new Date().toISOString(),
    actor: "human",
    scenes,
  };
  mkdirSync(path.dirname(visualsCheckpointPath(projectRoot)), {
    recursive: true,
  });
  writeFileSync(
    visualsCheckpointPath(projectRoot),
    toVisualsCheckpointYaml(checkpoint),
    "utf8",
  );
  return checkpoint;
}

/** Mark a scene's checkpoint entry rejected (reason recorded). The next
 * `video visuals` run force-regenerates rejected scenes. Null when no
 * checkpoint exists yet. */
export function rejectVisualsScene(
  projectRoot: string,
  sceneNumber: number,
  reason: string,
): VisualsCheckpoint | null {
  const checkpoint = readVisualsCheckpoint(projectRoot);
  if (checkpoint === null) return null;
  const key = `scene_${sceneNumber}`;
  const current = checkpoint.scenes[key];
  const jpg = path.join(projectRoot, "assets", "images", `${key}.jpg`);
  const hash = fileSha256(jpg) ?? current?.hash ?? "";
  checkpoint.scenes[key] = {
    ...(current ?? {}),
    hash,
    status: "rejected",
    reason,
    rejectedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(visualsCheckpointPath(projectRoot)), {
    recursive: true,
  });
  writeFileSync(
    visualsCheckpointPath(projectRoot),
    toVisualsCheckpointYaml(checkpoint),
    "utf8",
  );
  return checkpoint;
}

function toVisualsCheckpointYaml(cp: VisualsCheckpoint): string {
  const entries = Object.entries(cp.scenes)
    .sort(
      ([a], [b]) =>
        parseInt(a.slice("scene_".length), 10) -
        parseInt(b.slice("scene_".length), 10),
    )
    .map(([k, v]) => {
      const bits = [`hash: ${v.hash}`];
      if (v.cacheKey) bits.push(`cache_key: ${v.cacheKey}`);
      if (v.status) bits.push(`status: ${v.status}`);
      if (v.reason) bits.push(`reason: "${v.reason.replace(/"/g, "'")}"`);
      if (v.rejectedAt) bits.push(`rejected_at: "${v.rejectedAt}"`);
      return `  ${k}: { ${bits.join(", ")} }`;
    });
  return [
    `schema: ${cp.schema}`,
    `approved_at: "${cp.approvedAt}"`,
    `actor: ${cp.actor}`,
    `scenes:`,
    ...entries,
    "",
  ].join("\n");
}

/** G4 gate evaluation: compare the approved checkpoint against the current
 * image set. Only scenes WITH an image on disk participate (missing images
 * are the generator's business, not the approval gate's). */
export function visualsGateState(projectRoot: string): {
  state: "ok" | "missing-checkpoint" | "stale";
  staleScenes: number[];
} {
  const checkpoint = readVisualsCheckpoint(projectRoot);
  if (checkpoint === null) {
    return { state: "missing-checkpoint", staleScenes: [] };
  }
  const imageDir = path.join(projectRoot, "assets", "images");
  const stale: number[] = [];
  for (const n of imageSceneNumbers(projectRoot)) {
    const hash = fileSha256(path.join(imageDir, `scene_${n}.jpg`));
    const approved = checkpoint.scenes[`scene_${n}`];
    if (!approved || approved.hash !== hash || approved.status === "rejected") {
      stale.push(n);
    }
  }
  return { state: stale.length === 0 ? "ok" : "stale", staleScenes: stale };
}
