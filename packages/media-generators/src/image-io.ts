import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePythonDir } from "./contact-sheet.js";

/**
 * Picture normalization for the image pipeline.
 *
 * A retrieved archive picture arrives in whatever format the archive had.
 * The scene image contract is a JPEG at `assets/images/scene_N.jpg`, and
 * the image model only accepts JPEG/PNG references — so a borrowed picture
 * is converted before it is used.
 *
 * The conversion is Pillow (the repo's own python helper project, same as
 * the contact sheet and the text baker) rather than ffmpeg: this is an
 * image operation, and Pillow is already a dependency of that project.
 */

export interface NormalizedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg";
}

export interface NormalizeOptions {
  /** Longest edge kept, in pixels. Default 1920 — the scene frame width. */
  maxEdge?: number | undefined;
  /** JPEG quality. Default 92. */
  quality?: number | undefined;
  /** Override `uv` (tests). */
  pythonBin?: string | undefined;
}

/** The file extension the bytes claim to be, by magic number. Returns ""
 *  when the bytes are not a picture Pillow is likely to read. */
export function detectImageExtension(bytes: Uint8Array): string {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return ".jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return ".png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return ".webp";
  }
  if (
    bytes.length >= 4 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "GIF8"
  ) {
    return ".gif";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d)
    return ".bmp";
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d))
  ) {
    return ".tiff";
  }
  return "";
}

/**
 * Convert bytes to a scene-sized JPEG. Null when the bytes are not a
 * picture, or when Pillow is unavailable — the caller then falls back to
 * plain generation.
 *
 * JPEG in, JPEG out: the bytes are returned untouched. The archive
 * thumbnails are already JPEG, and re-encoding them costs a python start
 * for nothing.
 */
export async function normalizeToJpeg(
  bytes: Uint8Array,
  opts: NormalizeOptions = {},
): Promise<NormalizedImage | null> {
  const ext = detectImageExtension(bytes);
  if (ext === "") return null;
  if (ext === ".jpg") {
    return { bytes, contentType: "image/jpeg" };
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "normalize-image-"));
  const src = path.join(workDir, `in${ext}`);
  const dst = path.join(workDir, "out.jpg");
  try {
    await writeFile(src, bytes);
    const code = await new Promise<number>((resolve, reject) => {
      const proc = spawn(
        opts.pythonBin ?? "uv",
        [
          "run",
          "python",
          "normalize_image.py",
          "--in",
          src,
          "--out",
          dst,
          "--max-edge",
          String(opts.maxEdge ?? 1920),
          "--quality",
          String(opts.quality ?? 92),
        ],
        { cwd: resolvePythonDir(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      proc.stdout.on("data", () => undefined);
      proc.stderr.on("data", (d) => {
        stderr += String(d);
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      proc.on("error", reject);
      proc.on("close", (c) => resolve(c ?? 1));
    });
    if (code !== 0) return null;
    const out = await readFile(dst);
    return { bytes: new Uint8Array(out), contentType: "image/jpeg" };
  } catch {
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
