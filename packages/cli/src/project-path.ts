import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Canonical slugify for a project directory name — used by `vf new`,
 * `vf research`, `vf script`, and `vf storyboard` so the same topic always
 * lands at the same directory regardless of which verb ran first.
 *
 * Rules: lowercase; any non-[a-z0-9 CJK] sequence collapses to a single
 * `-`; leading/trailing `-` stripped; truncated to 40 chars; empty falls
 * back to "project".
 *
 * Example: "orca 新一代 ADE 简介" → "orca-新一代-ade-简介"
 */
export function slugifyProjectName(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project"
  );
}

/** Identity passthrough for the lookup path used by `vf preview` /
 * `vf status` / `vf approve` / etc. The user-supplied positional IS the
 * directory name on disk — slugifying here would mismatch what `runNew`
 * actually wrote (e.g. for legacy pre-slugify projects). */
export function slugifyForProject(s: string): string {
  return s;
}

function isProjectRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, "storyboard", "storyboard.yaml")) ||
    existsSync(path.join(dir, "state.yaml"))
  );
}

/** Normalize for fuzzy comparison: lowercase, collapse any non-
 * alphanumeric/CJK run to a single `-`, trim `-`. "Harness_Engineering",
 * "harness engineering", and "harness-engineering" all normalize alike. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ResolvedProject =
  | { ok: true; root: string }
  | { ok: false; message: string };

/**
 * Resolve a user-supplied project argument to an existing project dir.
 *
 * Accepts any of:
 *   1. a direct path to a project root (e.g. `./projects/my-video`)
 *   2. the exact folder name under `projects/`
 *   3. the human topic — slugified, case- and separator-insensitive
 *      ("Harness Engineering" finds `harness-engineering`)
 *   4. a unique folder-name prefix ("harness" finds `harness-engineering`;
 *      ambiguous prefixes error listing the candidates)
 *
 * Zero matches → error listing every project under `projects/`.
 */
export function resolveProjectDir(
  arg: string,
  cwd?: string,
): ResolvedProject {
  const base = path.resolve(cwd ?? ".");
  const trimmed = arg.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "project argument is empty" };
  }

  const direct = path.resolve(base, trimmed);
  if (isProjectRoot(direct)) {
    return { ok: true, root: direct };
  }

  const projectsDir = path.join(base, "projects");
  const exact = path.join(projectsDir, trimmed);
  if (isProjectRoot(exact)) {
    return { ok: true, root: exact };
  }

  if (existsSync(projectsDir)) {
    const dirs = readdirSync(projectsDir)
      .filter((entry) => isProjectRoot(path.join(projectsDir, entry)))
      .sort();
    const target = normalizeForMatch(trimmed);
    if (target.length > 0) {
      const normalized = dirs.find((d) => normalizeForMatch(d) === target);
      if (normalized !== undefined) {
        return { ok: true, root: path.join(projectsDir, normalized) };
      }
      const prefixed = dirs.filter((d) =>
        normalizeForMatch(d).startsWith(target),
      );
      if (prefixed.length === 1) {
        return { ok: true, root: path.join(projectsDir, prefixed[0] ?? "") };
      }
      if (prefixed.length > 1) {
        return {
          ok: false,
          message: `ambiguous project "${trimmed}": matches ${prefixed.join(", ")} — pass the full folder name`,
        };
      }
    }
    if (dirs.length > 0) {
      return {
        ok: false,
        message: `no project matching "${trimmed}" under ${projectsDir} — available: ${dirs.join(", ")}`,
      };
    }
  }
  return {
    ok: false,
    message: `no project matching "${trimmed}" under ${projectsDir} — run \`vf new <topic>\` first`,
  };
}

/**
 * Resolve which project directory a cwd-style verb should operate on.
 *
 * Resolution order:
 *   1. `cwd` itself, when it is a project root (has storyboard/ or state.yaml)
 *   2. auto-discovery: exactly one project under `${cwd}/projects/` → use it
 *   3. multiple matches → error listing them; zero → error with next-step hint
 *
 * This lets `vf preview` / `vf final` / `vf status` / workflow verbs run from
 * the repo root without passing `--cwd projects/<slug>` every time.
 */
export function resolveProjectRoot(cwd?: string): ResolvedProject {
  const base = path.resolve(cwd ?? ".");
  if (isProjectRoot(base)) {
    return { ok: true, root: base };
  }
  const projectsDir = path.join(base, "projects");
  if (existsSync(projectsDir)) {
    const found = readdirSync(projectsDir)
      .filter((entry) => isProjectRoot(path.join(projectsDir, entry)))
      .sort();
    if (found.length === 1) {
      return { ok: true, root: path.join(projectsDir, found[0] ?? "") };
    }
    if (found.length > 1) {
      return {
        ok: false,
        message: `multiple projects found: ${found.join(", ")} — pass --cwd projects/<name> to pick one`,
      };
    }
  }
  return {
    ok: false,
    message: `no project at ${base} (expected storyboard/storyboard.yaml or state.yaml) — pass --cwd projects/<name>, or run \`vf new <topic>\` first`,
  };
}
