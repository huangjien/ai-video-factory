import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildContactSheet, resolvePythonDir } from "./contact-sheet.js";

/** Write a fake `uv` stand-in: the runner shells out to
 *  `pythonBin run python contact_sheet.py ...`, so the fake only has to
 *  behave like a process that prints and exits. */
async function fakePython(body: string): Promise<{ bin: string; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "contact-sheet-bin-"));
  const bin = path.join(dir, "fake-uv");
  await writeFile(bin, body, "utf8");
  await chmod(bin, 0o755);
  return { bin, dir };
}

describe("resolvePythonDir", () => {
  it("points at the package's python directory", () => {
    expect(resolvePythonDir().endsWith("python")).toBe(true);
  });
});

describe("buildContactSheet", () => {
  it("fails fast when the images directory does not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "contact-sheet-"));
    const res = await buildContactSheet({
      imagesDir: path.join(dir, "missing"),
      outPath: path.join(dir, "out.png"),
      captions: {},
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no images dir/);
  });

  it("reports success when the helper exits 0", async () => {
    const { bin } = await fakePython(
      '#!/bin/sh\necho "building sheet"\necho "warning: noisy" >&2\nexit 0\n',
    );
    const dir = await mkdtemp(path.join(tmpdir(), "contact-sheet-"));
    const images = path.join(dir, "images");
    await mkdir(images, { recursive: true });
    const out = path.join(dir, "nested", "sheet.png");
    const res = await buildContactSheet({
      imagesDir: images,
      outPath: out,
      captions: { scene_1: "first" },
      cols: 3,
      pythonBin: bin,
    });
    expect(res.ok).toBe(true);
    expect(res.outPath).toBe(out);
    expect(res.error).toBeUndefined();
  });

  it("reports the exit code when the helper fails", async () => {
    const { bin } = await fakePython("#!/bin/sh\nexit 3\n");
    const dir = await mkdtemp(path.join(tmpdir(), "contact-sheet-"));
    const images = path.join(dir, "images");
    await mkdir(images, { recursive: true });
    const res = await buildContactSheet({
      imagesDir: images,
      outPath: path.join(dir, "sheet.png"),
      captions: {},
      pythonBin: bin,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exited 3/);
  });

  it("reports the spawn failure when the helper cannot be started", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "contact-sheet-"));
    const images = path.join(dir, "images");
    await mkdir(images, { recursive: true });
    const res = await buildContactSheet({
      imagesDir: images,
      outPath: path.join(dir, "sheet.png"),
      captions: {},
      pythonBin: path.join(dir, "not-a-real-binary"),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
