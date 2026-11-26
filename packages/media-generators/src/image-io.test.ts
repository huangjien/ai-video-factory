import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { detectImageExtension, normalizeToJpeg } from "./image-io.js";

/** The magic numbers the detector reads. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const bmp = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
const tiffLittle = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);
const tiffBig = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]);

describe("detectImageExtension", () => {
  it("recognises the formats the archives hand out", () => {
    expect(detectImageExtension(jpeg)).toBe(".jpg");
    expect(detectImageExtension(png)).toBe(".png");
    expect(detectImageExtension(webp)).toBe(".webp");
    expect(detectImageExtension(gif)).toBe(".gif");
    expect(detectImageExtension(bmp)).toBe(".bmp");
    expect(detectImageExtension(tiffLittle)).toBe(".tiff");
    expect(detectImageExtension(tiffBig)).toBe(".tiff");
  });

  it("returns nothing for bytes that are not a picture", () => {
    expect(detectImageExtension(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(
      "",
    );
    expect(detectImageExtension(new Uint8Array([1, 2]))).toBe("");
    expect(detectImageExtension(new Uint8Array(0))).toBe("");
  });

  it("does not read a truncated header as a picture", () => {
    // A two-byte prefix is not enough to claim a format.
    expect(detectImageExtension(new Uint8Array([0xff, 0xd8]))).toBe("");
    expect(detectImageExtension(new Uint8Array([0x89, 0x50, 0x4e]))).toBe("");
  });
});

describe("normalizeToJpeg", () => {
  it("returns JPEG bytes untouched — re-encoding costs a python start for nothing", async () => {
    const out = await normalizeToJpeg(jpeg);
    expect(out?.contentType).toBe("image/jpeg");
    expect(out?.bytes).toBe(jpeg);
  });

  it("returns nothing for bytes that are not a picture", async () => {
    expect(await normalizeToJpeg(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("returns nothing when the converter is unavailable", async () => {
    // A pythonBin that does not exist stands in for a missing helper.
    const out = await normalizeToJpeg(png, {
      pythonBin: "/nonexistent/python-binary",
    });
    expect(out).toBeNull();
  });

  it("returns the converted bytes when the helper succeeds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-image-io-"));
    // A fake `uv`: the runner shells out to `uv run python
    // normalize_image.py --in … --out …`, so the fake only has to write
    // the output file and exit 0.
    const bin = path.join(dir, "fake-uv");
    await writeFile(
      bin,
      `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--out" ]; then out="$2"; fi
  shift
done
printf 'JPEG' > "$out"
exit 0
`,
      "utf8",
    );
    await chmod(bin, 0o755);
    const out = await normalizeToJpeg(png, { pythonBin: bin });
    expect(out?.contentType).toBe("image/jpeg");
    expect(new TextDecoder().decode(out?.bytes)).toBe("JPEG");
  });

  it("returns nothing when the helper exits non-zero", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-image-io-"));
    const bin = path.join(dir, "fake-uv");
    await writeFile(bin, "#!/bin/sh\necho 'cannot read' >&2\nexit 3\n", "utf8");
    await chmod(bin, 0o755);
    expect(await normalizeToJpeg(png, { pythonBin: bin })).toBeNull();
  });
});
