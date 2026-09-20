import { createHash } from "node:crypto";

/**
 * Image generation provider abstraction — doc §60 (Advanced Media).
 * v0.2 phase 8 ships only the MockImageProvider. Real providers
 * (MiniMax image, MiniMax image, etc.) are an obvious v0.3 hook
 * (the provider abstraction is the contract that holds).
 */
export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
}

export interface ImageResult {
  bytes: Uint8Array;
  contentType: "image/png";
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export class ImageGenerationError extends Error {
  constructor(message: string, public readonly providerName: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/**
 * Deterministic mock PNG generator — no network, no external deps.
 * Produces a syntactically valid minimal PNG file whose pixel data is
 * derived from a hash of the prompt so different prompts produce visibly
 * different outputs.
 */
export class MockImageProvider implements ImageProvider {
  readonly name = "mock";
  private readonly defaultWidth: number;
  private readonly defaultHeight: number;

  constructor(opts: { width?: number; height?: number } = {}) {
    this.defaultWidth = opts.width ?? 1280;
    this.defaultHeight = opts.height ?? 720;
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const width = req.width ?? this.defaultWidth;
    const height = req.height ?? this.defaultHeight;
    return {
      bytes: makePng(width, height, req.prompt),
      contentType: "image/png",
    };
  }
}

function makePng(width: number, height: number, prompt: string): Uint8Array {
  // Minimal 8-bit RGB PNG. We allocate a solid color derived from the
  // prompt hash, which is enough for tests (no actual rendering needed).
  const hash = createHash("sha256").update(prompt).digest();
  const r = hash[0] ?? 0;
  const g = hash[1] ?? 0;
  const b = hash[2] ?? 0;
  return encodePng(width, height, r, g, b);
}

/**
 * Encode a solid-color RGB PNG. Implements just enough of the PNG spec to
 * produce a structurally valid file with a single IDAT chunk (deflate of
 * raw scanlines).
 */
function encodePng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = chunk("IHDR", (() => {
    const buf = new Uint8Array(13);
    const view = new DataView(buf.buffer);
    view.setUint32(0, width, false);
    view.setUint32(4, height, false);
    buf[8] = 8; // bit depth
    buf[9] = 2; // color type RGB
    buf[10] = 0; // compression
    buf[11] = 0; // filter
    buf[12] = 0; // interlace
    return buf;
  })());

  // Raw scanlines: filter byte (0) + RGB triples
  const scanlineLen = 1 + width * 3;
  const raw = new Uint8Array(scanlineLen * height);
  for (let y = 0; y < height; y++) {
    const off = y * scanlineLen;
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const compressed = deflateStored(raw);
  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", new Uint8Array(0));

  const total =
    signature.length + ihdr.length + idat.length + iend.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(signature, p); p += signature.length;
  out.set(ihdr, p); p += ihdr.length;
  out.set(idat, p); p += idat.length;
  out.set(iend, p);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, data.length, false);
  const crc = crc32(Buffer.concat([typeBytes, data]));
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc, false);
  return Buffer.concat([lengthBytes, typeBytes, data, crcBytes]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal zlib "stored" (uncompressed) deflate stream. */
function deflateStored(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  out.push(0x78, 0x01); // zlib header, no compression
  let off = 0;
  while (off < input.length) {
    const block = Math.min(input.length - off, 65535);
    const last = off + block >= input.length ? 1 : 0;
    out.push(last); // BTYPE=00, BFINAL=last
    out.push(block & 0xff, (block >>> 8) & 0xff);
    out.push(~block & 0xff, (~block >>> 8) & 0xff);
    for (let i = 0; i < block; i++) out.push(input[off + i] ?? 0);
    off += block;
  }
  // Adler-32
  let a = 1;
  let b = 0;
  for (let i = 0; i < input.length; i++) {
    a = (a + (input[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(out);
}
