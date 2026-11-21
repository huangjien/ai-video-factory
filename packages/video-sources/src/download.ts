import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { USER_AGENT } from "@video/image-sources";
import { preprocessClip } from "./preprocess.js";

/** Bytes cap for a downloaded clip — mirrors MAX_CANDIDATE_BYTES at the
 *  search layer; a stream that exceeds it mid-download is abandoned. */
export const MAX_CLIP_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export interface DownloadedClip {
  /** Path of the RAW downloaded file (deleted by the caller after
   *  preprocessing). */
  rawPath: string;
  /** sha256 of the raw bytes — the audit trail's fingerprint. */
  sha256: string;
}

/**
 * Fetch a clip's original bytes to a temp file. Null when the download
 * fails or is too big; the caller then falls back to the scene's
 * generated image.
 */
export async function downloadClip(
  fileUrl: string,
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<DownloadedClip | null> {
  if (fileUrl === "") return null;
  const workDir = await mkdtemp(path.join(tmpdir(), "vf-clip-"));
  const rawPath = path.join(workDir, "raw");
  try {
    const res = await fetch(fileUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_CLIP_DOWNLOAD_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_CLIP_DOWNLOAD_BYTES) {
      return null;
    }
    await writeFile(rawPath, buf);
    return { rawPath, sha256: sha256(buf) };
  } catch {
    return null;
  }
}

/** sha256 of the bytes, hex — the audit trail's fingerprint. */
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export { preprocessClip };
