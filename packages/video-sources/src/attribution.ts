import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SceneVideoResolution, VideoCandidate } from "./types.js";

/**
 * The audit trail for borrowed clips.
 *
 * The pictures set the precedent (`scene-source/1` sidecars plus
 * ATTRIBUTION.md, after the audio library's `<tag>.license.txt`). A clip
 * that ends up on screen must carry its own trace: source, author,
 * licence, where a human checks it. A Content-ID claim on PD footage is
 * answerable only with this record — which is why it is mandatory, not
 * optional: the validator rejects a clip without its sidecar.
 */

export interface SceneVideoRecord {
  schema: "scene-video-source/1";
  source: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** Where a human checks the clip. */
  pageUrl: string;
  /** Direct bytes URL of the ORIGINAL download. */
  fileUrl: string;
  /** Absolute path of the preprocessed clip on disk. */
  localPath: string;
  /** Playback length of the clip, seconds. */
  durationSec: number | null;
  /** The cache-key term this clip produced. */
  digest: string;
  /** sha256 of the ORIGINAL downloaded bytes. */
  sha256: string;
  retrievedAt: string;
}

export const VIDEO_ATTRIBUTION_FILENAME = "ATTRIBUTION.md";

/** `assets/video/scene_7.source.json` — same shape family as the
 *  pictures' `scene_7.source.json`. */
export function sceneVideoSourcePath(
  videoDir: string,
  sceneNumber: number,
): string {
  return path.join(videoDir, `scene_${sceneNumber}.source.json`);
}

export function recordFromResolution(
  resolution: SceneVideoResolution,
): SceneVideoRecord | null {
  const candidate: VideoCandidate | null = resolution.candidate;
  if (candidate === null || resolution.localPath === null) return null;
  return {
    schema: "scene-video-source/1",
    source: candidate.source,
    title: candidate.title,
    author: candidate.author,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    pageUrl: candidate.pageUrl,
    fileUrl: candidate.fileUrl,
    localPath: resolution.localPath,
    durationSec: candidate.durationSec,
    digest: resolution.digest,
    sha256: resolution.sha256,
    retrievedAt: new Date().toISOString(),
  };
}

export function writeSceneVideoSource(
  videoDir: string,
  sceneNumber: number,
  record: SceneVideoRecord,
): void {
  mkdirSync(videoDir, { recursive: true });
  writeFileSync(
    sceneVideoSourcePath(videoDir, sceneNumber),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

export function readSceneVideoSource(
  videoDir: string,
  sceneNumber: number,
): SceneVideoRecord | null {
  try {
    const raw = JSON.parse(
      readFileSync(sceneVideoSourcePath(videoDir, sceneNumber), "utf8"),
    ) as Partial<SceneVideoRecord>;
    if (raw.schema !== "scene-video-source/1") return null;
    return {
      schema: "scene-video-source/1",
      source: raw.source ?? "",
      title: raw.title ?? "",
      author: raw.author ?? "",
      license: raw.license ?? "",
      licenseUrl: raw.licenseUrl ?? "",
      pageUrl: raw.pageUrl ?? "",
      fileUrl: raw.fileUrl ?? "",
      localPath: raw.localPath ?? "",
      durationSec: raw.durationSec ?? null,
      digest: raw.digest ?? "",
      sha256: raw.sha256 ?? "",
      retrievedAt: raw.retrievedAt ?? "",
    };
  } catch {
    return null;
  }
}

/** Every recorded clip in the video dir, by scene number. The sidecars
 *  persist across runs, so a scene whose clip was cached still appears
 *  in the attribution file. */
export function readAllSceneVideoSources(
  videoDir: string,
): { scene: number; record: SceneVideoRecord }[] {
  if (!existsSync(videoDir)) return [];
  let files: string[];
  try {
    files = readdirSync(videoDir);
  } catch {
    return [];
  }
  const out: { scene: number; record: SceneVideoRecord }[] = [];
  for (const file of files) {
    const m = file.match(/^scene_(\d+)\.source\.json$/);
    if (m === null || m[1] === undefined) continue;
    const record = readSceneVideoSource(videoDir, parseInt(m[1], 10));
    if (record === null) continue;
    if (record.localPath === "" && record.digest === "") continue;
    out.push({ scene: parseInt(m[1], 10), record });
  }
  return out.sort((a, b) => a.scene - b.scene);
}

/** An author's name, trimmed to a readable length — Commons stores whole
 *  biographies in the Artist field. */
export function shortVideoAuthor(author: string, max = 60): string {
  const text = author.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** The human-readable attribution file — one row per borrowed clip. */
export function writeVideoAttributionFile(
  videoDir: string,
  records: { scene: number; record: SceneVideoRecord }[],
): string {
  const rows = [...records].sort((a, b) => a.scene - b.scene);
  const lines: string[] = [
    "# Video attribution",
    "",
    "Clips borrowed from public collections for this video. Every row is",
    "also recorded machine-readably next to its scene clip as",
    "`scene_<N>.source.json`.",
    "",
  ];
  if (rows.length === 0) {
    lines.push("_No external clips were used._", "");
  } else {
    lines.push("| Scene | Clip | Source | Author | License | Where |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const { scene, record } of rows) {
      const where =
        record.pageUrl.trim() !== ""
          ? `[link](${record.pageUrl})`
          : record.localPath;
      lines.push(
        `| ${scene} | ${escapeCell(record.title)} | ${record.source} | ` +
          `${escapeCell(shortVideoAuthor(record.author)) || "—"} | ${record.license} | ${where} |`,
      );
    }
    lines.push("");
  }
  const out = path.join(videoDir, VIDEO_ATTRIBUTION_FILENAME);
  mkdirSync(videoDir, { recursive: true });
  writeFileSync(out, lines.join("\n"), "utf8");
  return out;
}
