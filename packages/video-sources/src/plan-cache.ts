import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { sha256Text } from "@video/image-sources";
import type { SceneVideoPlan } from "./types.js";

/**
 * The video plan, cached per project — same discipline as the picture
 * plan (packages/make/src/source-plan-cache.ts): the plan is an LLM's
 * reading of the article, re-reading it on every render made the footage
 * scenes a lottery, and a changed clip invalidates the scene's cache key.
 *
 * Keyed by the inputs the planner READS; the file lives next to the clips
 * it decided on (`assets/video/video-source-plan.yaml`).
 */

export const VIDEO_PLAN_FILENAME = "video-source-plan.yaml";

export function videoPlanPath(projectRoot: string): string {
  return path.join(projectRoot, "assets", "video", VIDEO_PLAN_FILENAME);
}

/** The key: everything the planner reads, hashed. */
export function videoPlanCacheKey(input: {
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
    kind: "video-sources/1",
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
export function readVideoPlanCache(
  projectRoot: string,
  key: string,
): SceneVideoPlan[] | null {
  const file = videoPlanPath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    const raw = parseYaml(readFileSync(file, "utf8")) as {
      schema?: string;
      key?: string;
      plan?: SceneVideoPlan[];
    } | null;
    if (raw === null || raw.schema !== "video-source-plan/1") return null;
    if (raw.key !== key) return null;
    if (!Array.isArray(raw.plan)) return null;
    return raw.plan.filter(
      (p) =>
        typeof p?.scene === "number" &&
        typeof p?.historical === "boolean" &&
        typeof p?.query === "string",
    );
  } catch {
    return null;
  }
}

/** Write the plan next to the clips it decided on. */
export function writeVideoPlanCache(
  projectRoot: string,
  key: string,
  plan: SceneVideoPlan[],
): string {
  const file = videoPlanPath(projectRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    stringifyYaml({
      schema: "video-source-plan/1",
      key,
      created_at: new Date().toISOString(),
      plan,
    }),
    "utf8",
  );
  return file;
}
