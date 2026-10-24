import { describe, expect, it } from "vitest";
import { RENDERER_REVISION, sceneCacheIsFresh } from "./scene-cache.js";

/**
 * A rendered scene mp4 is reused when its storyboard fragment, its
 * project-level inputs, and its narration audio are unchanged. That misses a
 * whole class of change: anything in the renderer itself. Editing a
 * component — caption type, a colour, a layout — leaves the fragment,
 * `projectHash`, and audio identical, so every previously-rendered scene is
 * replayed with the old pixels.
 *
 * Observed 2026-10-17: the caption plate and 45px type were changed and all
 * 59 cached scene mp4s across the four shipped projects still matched, so
 * the change was invisible in any re-render. `rendererRevision` closes that.
 */

const HASH_A = "sha256:" + "a".repeat(64);
const HASH_B = "sha256:" + "b".repeat(64);

const sidecar = (
  over: Partial<Parameters<typeof sceneCacheIsFresh>[0]> = {},
) => ({
  sceneHash: HASH_A,
  projectHash: HASH_B,
  rendererRevision: RENDERER_REVISION,
  audioMtimeMs: 0,
  renderedAt: "t",
  ...over,
});

describe("sceneCacheIsFresh — the renderer is an input", () => {
  it("is fresh when everything matches, including the revision", () => {
    expect(
      sceneCacheIsFresh(sidecar(), {
        sceneHash: HASH_A,
        projectHash: HASH_B,
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(true);
  });

  it("is stale when the renderer revision moved, plan untouched", () => {
    // The exact case that left 59 stale mp4s in place: no storyboard edit,
    // no theme flip, no audio change — only the renderer moved.
    expect(
      sceneCacheIsFresh(sidecar({ rendererRevision: "1" }), {
        sceneHash: HASH_A,
        projectHash: HASH_B,
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(false);
  });

  it("is stale on sidecars written before the field existed (one-time invalidation)", () => {
    // Every sidecar written by an older renderer lacks it — including all 59
    // shipped ones — so they invalidate exactly once and then re-record.
    const legacy = {
      sceneHash: HASH_A,
      projectHash: HASH_B,
      audioMtimeMs: 0,
      renderedAt: "t",
    };
    expect(
      sceneCacheIsFresh(legacy, {
        sceneHash: HASH_A,
        projectHash: HASH_B,
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(false);
  });

  it("accepts a sidecar stamped with the current revision", () => {
    expect(
      sceneCacheIsFresh(sidecar({ rendererRevision: RENDERER_REVISION }), {
        sceneHash: HASH_A,
        projectHash: HASH_B,
        rendererRevision: RENDERER_REVISION,
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(true);
  });

  it("still goes stale on a theme flip (projectHash unchanged behaviour)", () => {
    expect(
      sceneCacheIsFresh(sidecar(), {
        sceneHash: HASH_A,
        projectHash: "sha256:" + "c".repeat(64),
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(false);
  });

  it("exposes a non-empty revision string", () => {
    expect(typeof RENDERER_REVISION).toBe("string");
    expect(RENDERER_REVISION.length).toBeGreaterThan(0);
  });
});
