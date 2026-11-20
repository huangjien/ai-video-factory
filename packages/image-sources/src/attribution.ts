import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  PictureSourceName,
  SceneSourcePlan,
  SceneSourceResolution,
  SourceMode,
} from "./types.js";

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

/** The plan-and-outcome summary. `ATTRIBUTION.md` says which pictures were
 *  used; this one says what the video ASKED for and what each scene got —
 *  including the scenes that asked for a picture and got none. Without it,
 *  a run that borrowed nothing looks exactly like a run that never planned
 *  anything. */
export const HISTORICAL_FILENAME = "HISTORICAL.md";

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

/**
 * The plan-and-outcome summary for the whole film.
 *
 * `ATTRIBUTION.md` is the credit list — only the pictures that made it on
 * screen. This file is the other half: what the planner ASKED for, and
 * what each planned scene ended up with, including the ones that asked for
 * a picture and got none. A run that borrowed nothing and a run that never
 * planned anything must not look the same.
 */
export function writeHistoricalSummaryFile(
  imagesDir: string,
  opts: {
    plan: SceneSourcePlan[];
    resolutions: Map<number, SceneSourceResolution>;
    /** True when the film turned the feature off — the file then says so
     *  instead of leaving a stale table from an earlier run. */
    disabled?: boolean | undefined;
  },
): string {
  const planned = opts.plan.filter((p) => p.historical && p.mode !== "none");
  const rows = planned.map((p) => {
    const resolution = opts.resolutions.get(p.scene);
    const candidate = resolution?.candidate ?? null;
    const outcome =
      resolution === undefined
        ? "not reached"
        : resolution.mode === "direct"
          ? "frame"
          : resolution.mode === "reference"
            ? "reference"
            : "no picture";
    return {
      scene: p.scene,
      planned: p.mode,
      subject: p.subject,
      query: p.query,
      reason: p.reason,
      outcome,
      title: candidate?.title ?? "",
      source: candidate?.source ?? "",
      license: candidate?.license ?? "",
      pageUrl: candidate?.pageUrl ?? "",
    };
  });
  const withPicture = rows.filter((r) => r.outcome !== "no picture" && r.outcome !== "not reached");

  const lines: string[] = ["# Historical pictures", ""];
  if (opts.disabled === true) {
    lines.push(
      "Historical pictures are OFF for this film (`historical_images: off` in",
      "article.md, or `--image-sources off`). Every scene image is generated.",
      "",
    );
  } else {
    lines.push(
      "What the picture plan asked for in this film, and what each scene got.",
      "The credit list for the pictures that reached the screen is in",
      "`ATTRIBUTION.md`.",
      "",
      `Historical scenes planned: ${planned.length} of ${opts.plan.length} · scenes with a picture: ${withPicture.length}`,
      "",
    );
    if (rows.length === 0) {
      lines.push("_No scene was planned as historical._", "");
    } else {
      lines.push("| Scene | Planned | Subject | Query | Outcome | Picture | License |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const r of rows) {
        const picture =
          r.title === ""
            ? "—"
            : r.pageUrl.trim() === ""
              ? escapeCell(r.title)
              : `[${escapeCell(r.title)}](${r.pageUrl})`;
        lines.push(
          `| ${r.scene} | ${r.planned} | ${escapeCell(r.subject) || "—"} | ` +
            `${escapeCell(r.query) || "—"} | ${r.outcome} | ${picture} | ${r.license || "—"} |`,
        );
      }
      lines.push("");
    }
  }
  const out = path.join(imagesDir, HISTORICAL_FILENAME);
  mkdirSync(imagesDir, { recursive: true });
  writeFileSync(out, lines.join("\n"), "utf8");
  return out;
}
