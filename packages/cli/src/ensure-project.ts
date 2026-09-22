import { existsSync } from "node:fs";
import { runNew } from "./new-command.js";

/**
 * Idempotently scaffold a project directory. Used by every agent command
 * (`research`, `script`, `storyboard`, etc.) that needs the project to
 * exist before writing its artifact.
 *
 * - missing project directory → call `runNew` (non-zero on real failure)
 * - existing project directory → no-op, return 0 (the user's work is
 *   preserved; subsequent agent invocations are idempotent)
 */
export async function ensureProject(
  cwd: string,
  slug: string,
  projectRoot: string,
): Promise<number> {
  if (existsSync(projectRoot)) return 0;
  return runNew({ projectId: slug, cwd });
}
