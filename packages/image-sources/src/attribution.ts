import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { PictureSourceName, SourceMode } from "./types.js";

/**
 * The audit trail for borrowed pictures.
 *
 * The audio library sets the precedent: `assets/bgm/<tag>.license.txt` sits
 * next to the track and names its source, its author and its license. Images
 * get the same treatment — a machine-readable sidecar next to each scene
 * image, plus one human-readable file for the whole set.
 *
 * Without this, a picture that ends up on screen has no trace of where it
 * came from, and "no copyright issue" is a promise nobody can check.
 */

export interface SceneSourceRecord {
  schema: "scene-source/1";
  mode: SourceMode;
  source: PictureSourceName;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** Where a human checks the picture. */
  pageUrl: string;
  /** Direct bytes URL (network sources) or "" for on-disk artifacts. */
  fileUrl: string;
  /** Absolute path for on-disk artifacts; null otherwise. */
  localPath: string | null;
  /** The cache-key term this picture produced. */
  digest: string;
  /** sha256 of the picture's bytes. */
  sha256: string;
  retrievedAt: string;
}

export const ATTRIBUTION_FILENAME = "ATTRIBUTION.md";

/** `assets/images/scene_7.source.json` */
export function sceneSourcePath(imagesDir: string, sceneNumber: number): string {
  return path.join(imagesDir, `scene_${sceneNumber}.source.json`);
}

export function readSceneSource(
  imagesDir: string,
  sceneNumber: number,
): SceneSourceRecord | null {
  try {
    const raw = JSON.parse(
      readFileSync(sceneSourcePath(imagesDir, sceneNumber), "utf8"),
    ) as Partial<SceneSourceRecord>;
    if (raw.schema !== "scene-source/1") return null;
    return {
      schema: "scene-source/1",
      mode: raw.mode ?? "none",
      source: raw.source ?? "artifact",
      title: raw.title ?? "",
      author: raw.author ?? "",
      license: raw.license ?? "",
      licenseUrl: raw.licenseUrl ?? "",
      pageUrl: raw.pageUrl ?? "",
      fileUrl: raw.fileUrl ?? "",
      localPath: raw.localPath ?? null,
      digest: raw.digest ?? "",
      sha256: raw.sha256 ?? "",
      retrievedAt: raw.retrievedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function writeSceneSource(
  imagesDir: string,
  sceneNumber: number,
  record: SceneSourceRecord,
): void {
  mkdirSync(imagesDir, { recursive: true });
  writeFileSync(
    sceneSourcePath(imagesDir, sceneNumber),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

/** Remove the sidecar for a scene that no longer uses a picture. */
export function clearSceneSource(
  imagesDir: string,
  sceneNumber: number,
): void {
  try {
    const file = sceneSourcePath(imagesDir, sceneNumber);
    if (existsSync(file)) writeFileSync(file, "", "utf8");
  } catch {
    /* best effort */
  }
}

/** Every recorded picture in the images dir, by scene number. The sidecars
 *  persist across runs, so a scene whose image was cached still appears in
 *  the attribution file. */
export function readAllSceneSources(
  imagesDir: string,
): { scene: number; record: SceneSourceRecord }[] {
  if (!existsSync(imagesDir)) return [];
  let files: string[];
  try {
    files = readdirSync(imagesDir);
  } catch {
    return [];
  }
  const out: { scene: number; record: SceneSourceRecord }[] = [];
  for (const file of files) {
    const m = file.match(/^scene_(\d+)\.source\.json$/);
    if (m === null || m[1] === undefined) continue;
    const record = readSceneSource(imagesDir, parseInt(m[1], 10));
    if (record === null) continue;
    if (record.digest === "" && record.mode === "none") continue;
    out.push({ scene: parseInt(m[1], 10), record });
  }
  return out.sort((a, b) => a.scene - b.scene);
}

/** The run-log line, shaped like the audio license lines. */
export function sourceLogLine(
  sceneNumber: number,
  record: SceneSourceRecord,
): string {
  const credit =
    record.author.trim() !== "" ? `, ${shortAuthor(record.author)}` : "";
  return (
    `assets/images/scene_${sceneNumber}.jpg ` +
    `(${record.source}, ${record.license}${credit}, "${record.title}")`
  );
}

/** An author's name, trimmed to a readable length. Commons often stores
 *  a whole biography in the Artist field; the sidecar keeps the full
 *  text, the log line and the table do not. */
export function shortAuthor(author: string, max = 60): string {
  const text = author.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The human-readable attribution file — one row per borrowed picture. */
export function writeAttributionFile(
  imagesDir: string,
  records: { scene: number; record: SceneSourceRecord }[],
): string {
  const rows = [...records].sort((a, b) => a.scene - b.scene);
  const lines: string[] = [
    "# Image attribution",
    "",
    "Pictures borrowed from public collections for this video. Every row is",
    "also recorded machine-readably next to its scene image as",
    "`scene_<N>.source.json`.",
    "",
  ];
  if (rows.length === 0) {
    lines.push("_No external pictures were used._", "");
  } else {
    lines.push(
      "| Scene | Use | Picture | Source | Author | License | Where |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const { scene, record } of rows) {
      const where =
        record.pageUrl.trim() !== ""
          ? `[link](${record.pageUrl})`
          : (record.localPath ?? "");
      // "frame" = the picture IS the shot. "reference" = the picture was
      // fed to the image model and the model drew the frame.
      const use = record.mode === "direct" ? "frame" : "reference";
      lines.push(
        `| ${scene} | ${use} | ${escapeCell(record.title)} | ${record.source} | ` +
          `${escapeCell(shortAuthor(record.author)) || "—"} | ${record.license} | ${where} |`,
      );
    }
    lines.push("");
  }
  const out = path.join(imagesDir, ATTRIBUTION_FILENAME);
  mkdirSync(imagesDir, { recursive: true });
  writeFileSync(out, lines.join("\n"), "utf8");
  return out;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
