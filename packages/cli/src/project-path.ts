import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Return the project name as-is. The CLI's positional arg IS the
 * directory name (matching how `vf new` stores the project on disk).
 * We do no slugification here: the user owns the directory name, and
 * lower-casing it would mismatch what `runNew` actually wrote. */
export function slugifyForProject(s: string): string {
  return s;
}

function isProjectRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, "storyboard", "storyboard.yaml")) ||
    existsSync(path.join(dir, "state.yaml"))
  );
}

export type ResolvedProject =
  | { ok: true; root: string }
  | { ok: false; message: string };

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
