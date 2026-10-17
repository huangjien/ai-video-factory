import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePythonDir } from "./contact-sheet.js";

/**
 * Scene-text baking (v0.10.5): titles and quotes are typeset onto the
 * generated scene images with Pillow instead of being rendered as
 * SvgScene-family card components. Requested after review of projects/玄武门 —
 * the vector card scenes were the weakest frames in the video, and a baked
 * title keeps the whole video in one medium (photographed/illustrated frames)
 * with typography as part of the image.
 *
 * The manifest lives NEXT TO the images (assets/images/bake.json) so it is
 * project data, survives storyboard re-derivation, and needs no VDSL schema
 * change:
 *
 *   { "scenes": { "1":  { "style": "title", "text": "...", "subtext": "..." },
 *                 "26": { "style": "quote", "text": "...", "attribution": "..." } } }
 *
 * Text lands in the upper two-thirds; the lower third stays quiet because the
 * caption overlay renders there.
 */

/** One scene's baking instruction. `style` picks the layout. */
export interface BakeSpec {
  style: "title" | "quote";
  text: string;
  subtext?: string | undefined;
  attribution?: string | undefined;
}

export interface BakeManifest {
  scenes: Record<string, BakeSpec>;
  palette?: Record<string, unknown> | undefined;
}

/** Read a project's bake.json. Null when absent — the common case. */
export async function loadBakeManifest(
  imagesDir: string,
): Promise<BakeManifest | null> {
  return loadBakeManifestSync(imagesDir);
}

/** Sync twin for synchronous call sites (the make impact table). */
export function loadBakeManifestSync(imagesDir: string): BakeManifest | null {
  const file = path.join(imagesDir, "bake.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as BakeManifest;
    return parsed.scenes ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Digest of one scene's bake spec ("" when the scene has none). Part of the
 * image cache key: baked text lives INSIDE the jpg, so a changed title must
 * invalidate the cached image exactly like a changed `visual:` line does.
 */
export function bakeDigestFor(
  sceneNumber: number,
  manifest: BakeManifest | null,
): string {
  const spec = manifest?.scenes[String(sceneNumber)];
  if (!spec) return "";
  return (
    "sha256:" +
    createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16)
  );
}

export interface BakeTextResult {
  ok: boolean;
  /** Scene numbers that were baked, unpadded. */
  baked: number[];
  error?: string;
}

/** Run the Pillow baker over every manifest scene that has an image. */
export async function runBakeText(opts: {
  imagesDir: string;
  manifest: BakeManifest;
  /** Override `uv` (tests). */
  pythonBin?: string;
}): Promise<BakeTextResult> {
  const manifestPath = path.join(opts.imagesDir, "bake.json");
  // Rewrite the manifest so the python side reads exactly what we validated.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(manifestPath, JSON.stringify(opts.manifest, null, 2), "utf8");

  const code = await new Promise<number>((resolve, reject) => {
    const proc = spawn(
      opts.pythonBin ?? "uv",
      [
        "run",
        "python",
        "bake_text.py",
        "--images-dir",
        opts.imagesDir,
        "--manifest",
        manifestPath,
      ],
      { cwd: resolvePythonDir(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stdout.on("data", () => undefined);
    proc.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    return {
      ok: false,
      baked: [],
      error: `bake_text.py exited ${code}`,
    };
  }
  return { ok: true, baked: bakeableSceneNumbers(opts.manifest) };
}

function bakeableSceneNumbers(manifest: BakeManifest): number[] {
  return Object.keys(manifest.scenes)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}
