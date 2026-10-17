import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bakeDigestFor,
  loadBakeManifest,
  loadBakeManifestSync,
  runBakeText,
} from "./bake-text.js";

const MANIFEST = {
  scenes: {
    "1": {
      style: "title" as const,
      text: "长安清晨，宫门马蹄",
      subtext: "公元626年7月2日",
    },
    "26": { style: "quote" as const, text: "当规则无法约束野心" },
  },
};

describe("loadBakeManifest", () => {
  it("returns null when no bake.json exists (the common case)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bake-none-"));
    expect(await loadBakeManifest(dir)).toBeNull();
    expect(loadBakeManifestSync(dir)).toBeNull();
  });

  it("parses a manifest with scenes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bake-ok-"));
    await writeFile(
      path.join(dir, "bake.json"),
      JSON.stringify(MANIFEST),
      "utf8",
    );
    const m = await loadBakeManifest(dir);
    expect(m?.scenes["1"]?.style).toBe("title");
    expect(m?.scenes["26"]?.text).toContain("野心");
  });

  it("a malformed manifest is null, not a crash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bake-bad-"));
    await writeFile(path.join(dir, "bake.json"), "{not json", "utf8");
    expect(await loadBakeManifest(dir)).toBeNull();
  });

  it("a manifest with no scenes key is null", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bake-empty-"));
    await writeFile(path.join(dir, "bake.json"), "{}", "utf8");
    expect(await loadBakeManifest(dir)).toBeNull();
  });
});

describe("bakeDigestFor", () => {
  it("is empty for scenes with no spec and for no manifest", () => {
    expect(bakeDigestFor(9, MANIFEST)).toBe("");
    expect(bakeDigestFor(1, null)).toBe("");
  });

  it("is stable for the same spec and moves when the text changes", () => {
    const a = bakeDigestFor(1, MANIFEST);
    expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(bakeDigestFor(1, MANIFEST)).toBe(a);
    const edited = {
      scenes: {
        ...MANIFEST.scenes,
        "1": { ...MANIFEST.scenes["1"]!, text: "另一个标题" },
      },
    };
    expect(bakeDigestFor(1, edited)).not.toBe(a);
    // A sibling scene's edit does not move this scene's digest.
    expect(bakeDigestFor(26, edited)).toBe(bakeDigestFor(26, MANIFEST));
  });
});

describe("runBakeText", () => {
  it("bakes a real image when uv is available, skips cleanly otherwise", async () => {
    const hasUv =
      spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
    if (!hasUv) {
      console.warn("uv not found — skipping the live Pillow bake test");
      return;
    }
    // Build a solid-colour stand-in image with Pillow itself, so the test
    // needs no image provider.
    const dir = await mkdtemp(path.join(tmpdir(), "bake-live-"));
    const mk = spawnSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        "from PIL import Image; Image.new('RGB',(1920,1080),(30,40,70)).save(r'" +
          path.join(dir, "scene_1.jpg") +
          "','JPEG',quality=92)",
      ],
      { cwd: path.resolve(import.meta.dirname, "../python"), encoding: "utf8" },
    );
    expect(mk.status, mk.stderr).toBe(0);
    expect(existsSync(path.join(dir, "scene_1.jpg"))).toBe(true);

    const before = spawnSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        "from PIL import Image; import sys; im=Image.open(r'" +
          path.join(dir, "scene_1.jpg") +
          "'); print(len(im.tobytes()))",
      ],
      { cwd: path.resolve(import.meta.dirname, "../python"), encoding: "utf8" },
    );

    const r = await runBakeText({ imagesDir: dir, manifest: MANIFEST });
    expect(r.ok).toBe(true);
    expect(r.baked).toEqual([1, 26]); // 26 has no image: reported bakeable, skipped by py
    // The pixels changed — text landed.
    const probe = spawnSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        [
          "from PIL import Image",
          "im = Image.open(r'" +
            path.join(dir, "scene_1.jpg") +
            "').convert('L')",
          "px = list(im.getdata())",
          "light = sum(1 for v in px if v > 200)",
          "print(light)",
        ].join("; "),
      ],
      { cwd: path.resolve(import.meta.dirname, "../python"), encoding: "utf8" },
    );
    expect(probe.status, probe.stderr).toBe(0);
    const light = Number(probe.stdout.trim());
    // Cream text on a dark navy stand-in: thousands of light pixels appear.
    expect(light).toBeGreaterThan(5000);
  }, 120_000);
});
