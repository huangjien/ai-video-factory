import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  VIDEO_PLAN_FILENAME,
  readVideoPlanCache,
  videoPlanCacheKey,
  videoPlanPath,
  writeVideoPlanCache,
} from "./plan-cache.js";

const input = {
  title: "谁被允许下阴间",
  setting: "Tang China",
  scenes: [
    {
      id: "scene_1",
      visual: "a bronze underworld gate",
      caption: "死亡不等于放行",
      narration: "孙悟空的名字被写进生死簿。",
    },
  ],
};

const plan = [
  {
    scene: 1,
    historical: true,
    subject: "阎罗王",
    query: "ten kings of hell",
    reason: "a historical figure",
  },
];

function projectRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "vf-video-plan-cache-"));
}

describe("videoPlanCacheKey", () => {
  it("is the same for the same inputs", () => {
    expect(videoPlanCacheKey(input)).toBe(videoPlanCacheKey(input));
  });

  it("changes when a scene's visual changes", () => {
    const changed = {
      ...input,
      scenes: [{ ...input.scenes[0]!, visual: "a stone step" }],
    };
    expect(videoPlanCacheKey(changed)).not.toBe(videoPlanCacheKey(input));
  });

  it("changes when the setting or the title changes", () => {
    expect(videoPlanCacheKey({ ...input, title: "另一个题目" })).not.toBe(
      videoPlanCacheKey(input),
    );
    expect(videoPlanCacheKey({ ...input, setting: "Han China" })).not.toBe(
      videoPlanCacheKey(input),
    );
  });
});

describe("the plan cache", () => {
  it("writes the plan next to the clips it decided on", () => {
    const root = projectRoot();
    const key = videoPlanCacheKey(input);
    const file = writeVideoPlanCache(root, key, plan);
    expect(file).toBe(videoPlanPath(root));
    expect(file.endsWith(VIDEO_PLAN_FILENAME)).toBe(true);
    expect(readVideoPlanCache(root, key)).toEqual(plan);
  });

  it("has nothing for a different key", () => {
    const root = projectRoot();
    writeVideoPlanCache(root, videoPlanCacheKey(input), plan);
    expect(readVideoPlanCache(root, "another-key")).toBeNull();
  });

  it("has nothing when the project never planned", () => {
    expect(readVideoPlanCache(projectRoot(), "any-key")).toBeNull();
  });

  it("has nothing when the cached file is another schema's", () => {
    const root = projectRoot();
    const file = videoPlanPath(root);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "schema: something-else/1\nkey: k\nplan: []\n", "utf8");
    expect(readVideoPlanCache(root, "k")).toBeNull();
  });

  it("has nothing when the cached plan is not a list", () => {
    const root = projectRoot();
    mkdirSync(path.dirname(videoPlanPath(root)), { recursive: true });
    writeFileSync(
      videoPlanPath(root),
      "schema: video-source-plan/1\nkey: k\nplan: not-a-list\n",
      "utf8",
    );
    expect(readVideoPlanCache(root, "k")).toBeNull();
  });

  it("has nothing when the cached file is unreadable", () => {
    const root = projectRoot();
    mkdirSync(path.dirname(videoPlanPath(root)), { recursive: true });
    writeFileSync(videoPlanPath(root), "not: yaml: at: all", "utf8");
    expect(readVideoPlanCache(root, "k")).toBeNull();
  });

  it("drops a cached entry that lost its shape", () => {
    const root = projectRoot();
    const key = videoPlanCacheKey(input);
    writeVideoPlanCache(root, key, [
      plan[0]!,
      { scene: "two", historical: true, query: "x" } as never,
    ]);
    const read = readVideoPlanCache(root, key);
    expect(read).toHaveLength(1);
    expect(read?.[0]?.scene).toBe(1);
  });
});
