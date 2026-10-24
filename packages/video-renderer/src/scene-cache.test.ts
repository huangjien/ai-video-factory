import { mkdtempSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readSceneCacheMeta,
  sceneCacheFile,
  sceneCacheIsFresh,
  sceneImageDigest,
  writeSceneCacheMeta,
} from "./scene-cache.js";

// Minimal sidecar: all pre-imageHash terms matching.
const legacy = {
  sceneHash: "h",
  projectHash: "p",
  rendererRevision: "7",
  renderedAt: "2026-10-24T00:00:00.000Z",
};

/** Full renderer-side terms (what renderScenesIncrementally passes). */
const fullTerms = (
  over: Partial<Parameters<typeof sceneCacheIsFresh>[1]> = {},
) => ({
  sceneHash: "h",
  projectHash: "p",
  rendererRevision: "7",
  captionsHash: null,
  imageHash: null,
  audio: { path: null, mtimeMs: 0 },
  ...over,
});

describe("scene image digest freshness (P1 — image content in the key)", () => {
  it("a sidecar with a DIFFERENT imageHash is stale (regenerated jpg)", () => {
    const meta = { ...legacy, imageHash: "sha256:deadbeefdeadbeef" };
    expect(
      sceneCacheIsFresh(meta, fullTerms({ imageHash: "sha256:cafecafecafe" })),
    ).toBe(false);
  });

  it("a LEGACY sidecar without imageHash on an image scene is stale (one-time invalidation)", () => {
    expect(
      sceneCacheIsFresh(
        legacy,
        fullTerms({ imageHash: "sha256:cafecafecafe" }),
      ),
    ).toBe(false);
  });

  it("a NON-image scene (imageHash null) stays fresh on a legacy sidecar", () => {
    expect(sceneCacheIsFresh(legacy, fullTerms())).toBe(true);
  });

  it("matching imageHash stays fresh", () => {
    const meta = { ...legacy, imageHash: "sha256:cafecafecafe" };
    expect(
      sceneCacheIsFresh(meta, fullTerms({ imageHash: "sha256:cafecafecafe" })),
    ).toBe(true);
  });

  it("sceneImageDigest: stable, content-sensitive, sha256:16-hex, null on missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scene-digest-"));
    const img = path.join(dir, "scene_1.jpg");
    writeFileSync(img, "image-bytes-v1");
    const d1 = sceneImageDigest(img);
    expect(d1).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(sceneImageDigest(img)).toBe(d1);
    writeFileSync(img, "image-bytes-v2");
    expect(sceneImageDigest(img)).not.toBe(d1);
    expect(sceneImageDigest(path.join(dir, "missing.jpg"))).toBeNull();
    // data-URI form (what the compiled render plan carries): decoded bytes
    // hash identically to the file bytes — dry-run/render parity.
    const b64 = Buffer.from("image-bytes-v1").toString("base64");
    expect(sceneImageDigest(`data:image/jpeg;base64,${b64}`)).toBe(d1);
  });
});

describe("sceneCacheIsFresh — dry-run subset terms (video make --dry-run)", () => {
  // The dry-run passes only the terms derivable offline from storyboard.yaml.
  // Omitted terms are SKIPPED — the table can only under-predict work.
  const dryRunTerms = (
    over: Partial<Parameters<typeof sceneCacheIsFresh>[1]> = {},
  ) => ({
    sceneHash: "h",
    rendererRevision: "7",
    ...over,
  });

  it("a sidecar stale on an OMITTED term still reads fresh (under-predict only)", () => {
    // projectHash differs — the dry-run cannot see it and must not guess.
    const meta = { ...legacy, projectHash: "different" };
    expect(sceneCacheIsFresh(meta, dryRunTerms())).toBe(true);
  });

  it("a sidecar stale on a PASSED term reads stale — the lying-dry-run fix", () => {
    // imageHash differs: this is exactly the 2026-10-24 incident shape.
    const meta = { ...legacy, imageHash: "sha256:old" };
    expect(
      sceneCacheIsFresh(meta, dryRunTerms({ imageHash: "sha256:new" })),
    ).toBe(false);
  });

  it("a null fragment hash is never fresh", () => {
    expect(sceneCacheIsFresh(legacy, dryRunTerms({ sceneHash: null }))).toBe(
      false,
    );
  });
});

describe("scene-cache sidecar read/write round trip", () => {
  it("writes and reads back the sidecar next to the scene mp4", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scene-sidecar-"));
    const file = sceneCacheFile(dir, 0, "scene-01");
    expect(path.basename(file)).toBe("00-scene-01.mp4");
    writeSceneCacheMeta(file, { ...legacy });
    expect(readSceneCacheMeta(file)).toEqual(legacy);
  });

  it("null meta (absent or corrupt sidecar) is never fresh", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scene-sidecar-"));
    const file = sceneCacheFile(dir, 2, "scene-03");
    expect(readSceneCacheMeta(file)).toBeNull();
    writeFileSync(`${file}.json`, "{not json", "utf8");
    expect(readSceneCacheMeta(file)).toBeNull();
    expect(sceneCacheIsFresh(readSceneCacheMeta(file), fullTerms())).toBe(
      false,
    );
  });
});

describe("overlay digest freshness (2026-10-24 — Pillow banner is a render input)", () => {
  it("a changed overlay PNG invalidates the scene", () => {
    const meta = { ...legacy, imageHash: "sha256:aaa", overlayHash: "sha256:old" };
    expect(
      sceneCacheIsFresh(meta as never, {
        sceneHash: "h",
        projectHash: "p",
        rendererRevision: "7",
        imageHash: "sha256:aaa",
        overlayHash: "sha256:new",
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(false);
  });

  it("an unchanged overlay keeps the scene fresh", () => {
    const meta = { ...legacy, imageHash: "sha256:aaa", overlayHash: "sha256:same" };
    expect(
      sceneCacheIsFresh(meta as never, {
        sceneHash: "h",
        projectHash: "p",
        rendererRevision: "7",
        imageHash: "sha256:aaa",
        overlayHash: "sha256:same",
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(true);
  });

  it("a scene without an overlay term stays fresh on a legacy sidecar", () => {
    expect(
      sceneCacheIsFresh(legacy as never, {
        sceneHash: "h",
        projectHash: "p",
        rendererRevision: "7",
        audio: { path: null, mtimeMs: 0 },
      }),
    ).toBe(true);
  });
});
