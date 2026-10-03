import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approveSceneVersion,
  extractSceneFragment,
  hashSceneFragment,
  listSceneVersions,
  readSceneApproval,
  readSceneVersion,
  recordSceneVersion,
  replaceSceneFragment,
} from "@video/workflow";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";

const STORYBOARD_REL = path.join("storyboard", "storyboard.yaml");

async function resolveTarget(
  projectName: string | undefined,
  cwd: string | undefined,
): Promise<string | null> {
  if (projectName) {
    const resolved = resolveProjectDir(projectName, cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return null;
    }
    return resolved.root;
  }
  const resolved = resolveProjectRoot(cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return null;
  }
  return resolved.root;
}

export async function runSceneList(
  projectName: string | undefined,
  sceneId: string | undefined,
  cwd: string | undefined,
): Promise<number> {
  const root = await resolveTarget(projectName, cwd);
  if (!root) return 1;
  if (sceneId) {
    const versions = await listSceneVersions(root, sceneId);
    const approval = await readSceneApproval(root, sceneId);
    if (versions.length === 0) {
      console.log(`${sceneId}: no versions recorded yet (run video preview)`);
      return 0;
    }
    for (const v of versions) {
      const approved =
        approval?.version === v.version ? "  ← approved" : "";
      console.log(
        `${sceneId} v${v.version}  ${v.hash.slice(0, 19)}…  ${v.createdAt}${approved}${v.note ? `  (${v.note})` : ""}`,
      );
    }
    return 0;
  }
  // No scene id: list every scene with recorded versions.
  const storyboardPath = path.join(root, STORYBOARD_REL);
  if (!existsSync(storyboardPath)) {
    console.error(`scene list: no storyboard at ${storyboardPath}`);
    return 1;
  }
  const text = await readFile(storyboardPath, "utf8");
  const ids = [...text.matchAll(/^\s*- id:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
  for (const id of ids) {
    const versions = await listSceneVersions(root, id);
    const approval = await readSceneApproval(root, id);
    const tail =
      versions.length === 0
        ? "no versions yet"
        : `v${versions.map((v) => v.version).join(", v")}${approval ? ` (approved: v${approval.version})` : ""}`;
    console.log(`${id}: ${tail}`);
  }
  return 0;
}

export async function runSceneRestore(
  projectName: string | undefined,
  sceneId: string,
  version: number,
  cwd: string | undefined,
): Promise<number> {
  const root = await resolveTarget(projectName, cwd);
  if (!root) return 1;
  const storyboardPath = path.join(root, STORYBOARD_REL);
  if (!existsSync(storyboardPath)) {
    console.error(`scene restore: no storyboard at ${storyboardPath}`);
    return 1;
  }
  let fragment: string;
  try {
    fragment = await readSceneVersion(root, sceneId, version);
  } catch {
    console.error(
      `scene restore: ${sceneId} v${version} not found — see \`video scene list ${path.basename(root)} ${sceneId}\``,
    );
    return 1;
  }
  const text = await readFile(storyboardPath, "utf8");
  const updated = replaceSceneFragment(text, sceneId, fragment);
  await writeFile(storyboardPath, updated, "utf8");
  // Record the restore as a version too, so the history shows the revert.
  const restored = extractSceneFragment(updated, sceneId);
  if (restored !== null) {
    await recordSceneVersion(
      root,
      sceneId,
      restored,
      `restored from v${version}`,
    );
  }
  // Invalidate just this scene's render caches — the hash-based dirty
  // check re-renders only it on the next preview.
  for (const dir of ["scenes", "scenes-draft"]) {
    const p = path.join(root, dir);
    if (!existsSync(p)) continue;
    const { readdir, rm } = await import("node:fs/promises");
    for (const f of await readdir(p)) {
      if (f.includes(sceneId.replace(/[^a-zA-Z0-9_-]+/g, "_"))) {
        await rm(path.join(p, f), { force: true });
      }
    }
  }
  console.log(`✓ restored ${sceneId} to v${version} — only that scene re-renders`);
  return 0;
}

export async function runSceneApprove(
  projectName: string | undefined,
  sceneId: string,
  version: number | undefined,
  note: string | undefined,
  cwd: string | undefined,
): Promise<number> {
  const root = await resolveTarget(projectName, cwd);
  if (!root) return 1;
  const storyboardPath = path.join(root, STORYBOARD_REL);
  if (!existsSync(storyboardPath)) {
    console.error(`scene approve: no storyboard at ${storyboardPath}`);
    return 1;
  }
  // Default: approve the version matching the CURRENT storyboard content.
  let target = version;
  if (target === undefined) {
    const text = await readFile(storyboardPath, "utf8");
    const frag = extractSceneFragment(text, sceneId);
    if (frag === null) {
      console.error(`scene approve: scene "${sceneId}" not in storyboard`);
      return 1;
    }
    const hash = hashSceneFragment(frag);
    const versions = await listSceneVersions(root, sceneId);
    const match = versions.find((v) => v.hash === hash);
    if (!match) {
      // Unversioned content: record it first, then approve it.
      const created = await recordSceneVersion(root, sceneId, frag);
      if (created === null) {
        console.error(`scene approve: could not version current content`);
        return 1;
      }
      target = created;
    } else {
      target = match.version;
    }
  }
  try {
    await approveSceneVersion(root, sceneId, target as number, "human");
  } catch (err) {
    console.error(`scene approve: ${(err as Error).message}`);
    return 1;
  }
  if (note !== undefined) {
    console.log(`  note: ${note}`);
  }
  console.log(`✓ ${sceneId} v${target} approved`);
  return 0;
}
