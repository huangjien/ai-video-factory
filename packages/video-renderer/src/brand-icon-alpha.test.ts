import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The brand icon is the corner watermark on EVERY scene
 * (`brand.yaml` → `assets/brand/icon.png`). It shipped as an RGB PNG —
 * no alpha channel — so the watermark rendered as an opaque teal square
 * in the bottom-right corner of every frame.
 *
 * This test is the guard: the icon must carry a real alpha channel and
 * its background must actually be transparent, so a regenerated icon
 * cannot silently bring the opaque square back.
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const ICON = path.join(repoRoot, "assets", "brand", "icon.png");

interface DecodedPng {
  width: number;
  height: number;
  colorType: number;
  /** RGBA bytes. */
  pixels: Uint8Array;
}

/** Decode an 8-bit RGBA PNG: IHDR, inflated IDAT, per-scanline
 *  unfiltering. Enough to read a pixel's alpha without an image
 *  library. */
function decodePng(file: string): DecodedPng {
  const data = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks: Buffer[] = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") {
      width = data.readUInt32BE(pos + 8);
      height = data.readUInt32BE(pos + 12);
      colorType = data[pos + 8 + 9] ?? 0;
    } else if (type === "IDAT") {
      chunks.push(data.subarray(pos + 8, pos + 8 + length));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src] ?? 0;
    src += 1;
    const line = raw.subarray(src, src + stride);
    src += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const byte = line[x] ?? 0;
      const a = x >= bpp ? (cur[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      let value = byte;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = value & 0xff;
    }
    pixels.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, colorType, pixels };
}

describe("the brand icon", () => {
  it("carries an alpha channel (PNG color type 6 = RGBA)", () => {
    expect(decodePng(ICON).colorType).toBe(6);
  });

  it("has a transparent background — the corners are background", () => {
    const { width, height, pixels } = decodePng(ICON);
    const alphaAt = (x: number, y: number): number =>
      pixels[y * width * 4 + x * 4 + 3] ?? 255;
    const corners = [
      alphaAt(0, 0),
      alphaAt(width - 1, 0),
      alphaAt(0, height - 1),
      alphaAt(width - 1, height - 1),
    ];
    for (const alpha of corners) {
      expect(alpha).toBeLessThanOrEqual(16);
    }
  });

  it("keeps the artwork opaque — the avatar is not a ghost", () => {
    const { width, height, pixels } = decodePng(ICON);
    // The forehead sits in the middle of the head.
    const alphaAt = (x: number, y: number): number =>
      pixels[y * width * 4 + x * 4 + 3] ?? 0;
    expect(alphaAt(Math.round(width / 2), Math.round(height * 0.2))).toBe(255);
  });
});
