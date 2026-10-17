import { describe, expect, it } from "vitest";
import { RENDERER_REVISION, sceneCacheIsFresh } from "./pipeline.js";

const HASH_A = "sha256:" + "a".repeat(64);
const HASH_B = "sha256:" + "b".repeat(64);
const AUDIO = "/proj/assets/audio/scene-01.wav";

/** A sidecar as the CURRENT renderer writes it — see renderer-revision.test.ts
 *  for why the revision field is part of freshness. */
type Sidecar = NonNullable<Parameters<typeof sceneCacheIsFresh>[0]>;
const current = (over: Record<string, unknown> = {}): Sidecar =>
  ({
    rendererRevision: RENDERER_REVISION,
    ...over,
  }) as Sidecar;

describe("sceneCacheIsFresh — project-level render inputs invalidate the cache", () => {
  it("is fresh when fragment, project inputs, and audio all match", () => {
    expect(
      sceneCacheIsFresh(
        current({
          sceneHash: HASH_A,
          projectHash: HASH_B,
          audioPath: AUDIO,
          audioMtimeMs: 1000,
          renderedAt: "t",
        }),
        HASH_A,
        HASH_B,
        AUDIO,
        1000,
      ),
    ).toBe(true);
  });

  it("is stale when the theme changed (projectHash differs, fragments identical)", () => {
    expect(
      sceneCacheIsFresh(
        current({ sceneHash: HASH_A, projectHash: HASH_B, renderedAt: "t" }),
        HASH_A,
        "sha256:" + "c".repeat(64),
        null,
        0,
      ),
    ).toBe(false);
  });

  it("is stale on legacy sidecars written before projectHash existed (one-time invalidation)", () => {
    expect(
      sceneCacheIsFresh(
        { sceneHash: HASH_A, renderedAt: "t" },
        HASH_A,
        HASH_B,
        null,
        0,
      ),
    ).toBe(false);
  });

  it("is stale when the scene fragment changed", () => {
    expect(
      sceneCacheIsFresh(
        current({ sceneHash: HASH_A, projectHash: HASH_B, renderedAt: "t" }),
        HASH_B,
        HASH_B,
        null,
        0,
      ),
    ).toBe(false);
  });

  it("is stale with no sidecar or no fragment hash", () => {
    expect(sceneCacheIsFresh(null, HASH_A, HASH_B, null, 0)).toBe(false);
    expect(
      sceneCacheIsFresh(
        current({ sceneHash: HASH_A, projectHash: HASH_B, renderedAt: "t" }),
        null,
        HASH_B,
        null,
        0,
      ),
    ).toBe(false);
  });
});
