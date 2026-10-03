import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Per-scene version history (plan §26: scene-007 v1/v2/v3 + approved).
 *
 * Scenes live inside storyboard.yaml, so a version is the scene's FRAGMENT
 * (its exact YAML block, textually extracted — same philosophy as the
 * duration sync: never round-trip the whole file, never lose comments).
 * Versions are recorded by `video preview` whenever a scene's content changed;
 * `video scene restore` splices an old fragment back into the storyboard.
 */

const VERSIONS_DIRNAME = "versions";

export function hashSceneFragment(fragment: string): string {
  // Hash the trimmed fragment so indentation-only churn doesn't create
  // phantom versions.
  return "sha256:" + createHash("sha256").update(fragment.trim()).digest("hex");
}

export interface SceneVersionMeta {
  version: number;
  hash: string;
  createdAt: string;
  note?: string;
}

interface StoredVersion extends SceneVersionMeta {
  fragment: string;
}

function versionsDir(projectRoot: string, sceneId: string): string {
  return path.join(projectRoot, VERSIONS_DIRNAME, sceneId);
}

/** Extract a scene's YAML block from the storyboard text: starts at the
 * `- id: <sceneId>` list item and extends until the next sibling list
 * item (same indent) or a dedent. Returns null when the scene is absent. */
export function extractSceneFragment(
  storyboardText: string,
  sceneId: string,
): string | null {
  const lines = storyboardText.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^\\s*- id:\\s*${escapeRe(sceneId)}\\s*$`).test(l),
  );
  if (start === -1) return null;
  const indent = leadingSpace(lines[start]!);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (leadingSpace(line) < indent || (leadingSpace(line) === indent && line.trimStart().startsWith("- "))) {
      end = i;
      break;
    }
  }
  // Trim trailing blank lines so the fragment is stable at file edges.
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end).join("\n");
}

/** Replace a scene's YAML block in the storyboard text with `fragment`.
 * Throws when the scene is absent — restore must never silently no-op. */
export function replaceSceneFragment(
  storyboardText: string,
  sceneId: string,
  fragment: string,
): string {
  const before = extractSceneFragment(storyboardText, sceneId);
  if (before === null) {
    throw new Error(`replaceSceneFragment: scene "${sceneId}" not in storyboard`);
  }
  const lines = storyboardText.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^\\s*- id:\\s*${escapeRe(sceneId)}\\s*$`).test(l),
  );
  const indent = leadingSpace(lines[start]!);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (leadingSpace(line) < indent || (leadingSpace(line) === indent && line.trimStart().startsWith("- "))) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...fragment.split("\n"), ...lines.slice(end)].join("\n");
}

/** Record the current fragment as a new version unless it hashes identical
 * to the latest stored version. Returns the new version number, or null
 * when nothing changed. */
export async function recordSceneVersion(
  projectRoot: string,
  sceneId: string,
  fragment: string,
  note?: string,
): Promise<number | null> {
  const hash = hashSceneFragment(fragment);
  const existing = await listSceneVersions(projectRoot, sceneId);
  const latest = existing[existing.length - 1];
  if (latest && latest.hash === hash) return null;
  const version = (latest?.version ?? 0) + 1;
  const record: StoredVersion = {
    version,
    hash,
    createdAt: new Date().toISOString(),
    ...(note !== undefined ? { note } : {}),
    fragment,
  };
  const dir = versionsDir(projectRoot, sceneId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `v${version}.yaml`),
    stringifyYaml(record),
    "utf8",
  );
  return version;
}

export async function listSceneVersions(
  projectRoot: string,
  sceneId: string,
): Promise<SceneVersionMeta[]> {
  const dir = versionsDir(projectRoot, sceneId);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir))
    .filter((f) => /^v\d+\.yaml$/.test(f))
    .sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5)));
  const out: SceneVersionMeta[] = [];
  for (const f of files) {
    try {
      const doc = parseYaml(await readFile(path.join(dir, f), "utf8")) as StoredVersion;
      if (typeof doc?.version === "number" && typeof doc?.hash === "string") {
        out.push({
          version: doc.version,
          hash: doc.hash,
          createdAt: doc.createdAt,
          ...(doc.note !== undefined ? { note: doc.note } : {}),
        });
      }
    } catch {
      // unreadable version file — skip rather than break the listing
    }
  }
  return out;
}

/** Read the stored fragment for a specific version. */
export async function readSceneVersion(
  projectRoot: string,
  sceneId: string,
  version: number,
): Promise<string> {
  const file = path.join(versionsDir(projectRoot, sceneId), `v${version}.yaml`);
  const doc = parseYaml(await readFile(file, "utf8")) as StoredVersion;
  if (typeof doc?.fragment !== "string") {
    throw new Error(`scene version ${sceneId} v${version} has no fragment`);
  }
  return doc.fragment;
}

/** Persist the human approval: which version of this scene is approved,
 * by whom, when (plan §14 Checkpoint 2 — review state, not chat). */
export async function approveSceneVersion(
  projectRoot: string,
  sceneId: string,
  version: number,
  approver: string = "human",
): Promise<void> {
  const dir = versionsDir(projectRoot, sceneId);
  const versions = await listSceneVersions(projectRoot, sceneId);
  if (!versions.some((v) => v.version === version)) {
    throw new Error(
      `approveSceneVersion: ${sceneId} v${version} not recorded (have: ${versions.map((v) => `v${v.version}`).join(", ") || "none"})`,
    );
  }
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "approved.yaml"),
    stringifyYaml({ scene: sceneId, version, approver, approved_at: new Date().toISOString() }),
    "utf8",
  );
}

export interface SceneApproval {
  scene: string;
  version: number;
  approver: string;
  approved_at: string;
}

export async function readSceneApproval(
  projectRoot: string,
  sceneId: string,
): Promise<SceneApproval | null> {
  const file = path.join(versionsDir(projectRoot, sceneId), "approved.yaml");
  if (!existsSync(file)) return null;
  return parseYaml(await readFile(file, "utf8")) as SceneApproval;
}

function leadingSpace(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
