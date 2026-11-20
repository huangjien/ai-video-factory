import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  planCacheKey,
  readSourcePlanCache,
  sourcePlanPath,
  writeSourcePlanCache,
} from "./source-plan-cache.js";

/**
 * The picture plan is an LLM's reading of the article. Caching it keeps
 * a re-render from re-drawing the lottery — and keeps it from spending
 * the picture twice, because a changed picture invalidates the scene's
 * image cache key.
 */

const SCENES = [
  { id: "scene_1", visual: "唐代帝王肖像", narration: "旁白一" },
  { id: "scene_2", visual: "一座古代关隘", caption: "关隘" },
];

const PLAN = [
  {
    scene: 1,
    historical: true,
    subject: "唐太宗",
    query: "唐太宗",
    mode: "direct" as const,
    reason: "a named emperor",
  },
  {
    scene: 2,
    historical: false,
    subject: "",
    query: "",
    mode: "none" as const,
    reason: "a landscape",
  },
];

describe("the source-plan cache", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "source-plan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a plan", () => {
    const key = planCacheKey({ title: "古人长什么样", scenes: SCENES });
    writeSourcePlanCache(dir, key, PLAN);
    const read = readSourcePlanCache(dir, key);
    expect(read).toEqual(PLAN);
  });

  it("ignores a plan made for a different article", () => {
    const key = planCacheKey({ title: "古人长什么样", scenes: SCENES });
    writeSourcePlanCache(dir, key, PLAN);
    // The article changed → the key changes → the plan is re-made.
    const other = planCacheKey({
      title: "古人长什么样",
      scenes: [{ ...SCENES[0]!, visual: "改过的画面" }, SCENES[1]!],
    });
    expect(readSourcePlanCache(dir, other)).toBeNull();
  });

  it("changes the key when a scene's visual changes", () => {
    const a = planCacheKey({ title: "t", scenes: SCENES });
    const b = planCacheKey({
      title: "t",
      scenes: [SCENES[0]!, { ...SCENES[1]!, caption: "改了字幕" }],
    });
    expect(a).not.toBe(b);
  });

  it("survives a corrupt cache file", () => {
    const file = sourcePlanPath(dir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "not: [valid", "utf8");
    expect(readSourcePlanCache(dir, "sha256:whatever")).toBeNull();
  });
});
