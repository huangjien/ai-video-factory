import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { sha256Text, type SceneSourcePlan } from "@video/image-sources";

/**
 * The picture plan, cached per project.
 *
 * The plan is an LLM's reading of the article: which scenes are about a
 * real historical subject, what to search for, and whether the picture is
 * the frame. Re-planning on every render made that reading a lottery —
 * the same film carried a picture in one render and none in the next,
 * and a changed picture invalidates the scene's image cache key, so a
 * re-render could spend again on scenes that had already been paid for.
 *
 * The cache is keyed by the inputs the planner READS (the title, the
 * setting, and every scene's visual line, caption and narration). Edit
 * the article and the key changes, so the plan is re-made; leave it alone
 * and the same plan is reused, and the same picture is found.
 */

export const SOURCE_PLAN_FILENAME = "source-plan.yaml";

/** `assets/images/source-plan.yaml` */
export function sourcePlanPath(projectRoot: string): string {
  return path.join(projectRoot, "assets", "images", SOURCE_PLAN_FILENAME);
}

/** The key: everything the planner reads, hashed. */
export function planCacheKey(input: {
  title: string;
  setting?: string | undefined;
  scenes: {
    id: string;
    visual: string;
    caption?: string | undefined;
    narration?: string | undefined;
  }[];
}): string {
  const payload = JSON.stringify({
    title: input.title,
    setting: input.setting ?? "",
    scenes: input.scenes.map((s) => [
      s.id,
      s.visual,
      s.caption ?? "",
      s.narration ?? "",
    ]),
  });
  return sha256Text(payload);
}

/** The cached plan, or null when there is none for this key. */
export function readSourcePlanCache(
  projectRoot: string,
  key: string,
): SceneSourcePlan[] | null {
  const file = sourcePlanPath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    const raw = parseYaml(readFileSync(file, "utf8")) as {
      schema?: string;
      key?: string;
      plan?: SceneSourcePlan[];
    } | null;
    if (raw === null || raw.schema !== "source-plan/1") return null;
    if (raw.key !== key) return null;
    if (!Array.isArray(raw.plan)) return null;
    return raw.plan.filter(
      (p) =>
        typeof p?.scene === "number" &&
        typeof p?.historical === "boolean" &&
        typeof p?.mode === "string",
    );
  } catch {
    return null;
  }
}

/** Write the plan next to the pictures it decided on. */
export function writeSourcePlanCache(
  projectRoot: string,
  key: string,
  plan: SceneSourcePlan[],
): string {
  const file = sourcePlanPath(projectRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    stringifyYaml({
      schema: "source-plan/1",
      key,
      created_at: new Date().toISOString(),
      plan,
    }),
    "utf8",
  );
  return file;
}
