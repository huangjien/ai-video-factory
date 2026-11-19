#!/usr/bin/env python3
"""Normalize a borrowed picture into a scene-sized JPEG.

A retrieved archive picture is whatever the archive had: a PNG scan, a
WebP thumbnail, a 6000px TIFF. The video pipeline wants one thing — a
JPEG it can name `scene_N.jpg`, no wider than the frame it fills, with
its orientation already applied.

Pure Pillow — no model runtime, no network.

Usage:
  python normalize_image.py --in <file> --out <file> [--max-edge 1920]
                            [--quality 92]
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageOps


def flatten(im: Image.Image) -> Image.Image:
    """Put transparency on white — a PNG cut-out on black is not a picture."""
    has_alpha = im.mode in ("RGBA", "LA") or (
        im.mode == "P" and "transparency" in im.info
    )
    if not has_alpha:
        return im.convert("RGB")
    rgba = im.convert("RGBA")
    bg = Image.new("RGB", rgba.size, (255, 255, 255))
    bg.paste(rgba, mask=rgba.split()[-1])
    return bg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--max-edge", type=int, default=1920)
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        im = flatten(im)
        w, h = im.size
        longest = max(w, h)
        if longest > args.max_edge:
            scale = args.max_edge / float(longest)
            im = im.resize(
                (max(1, round(w * scale)), max(1, round(h * scale))),
                Image.Resampling.LANCZOS,
            )
        im.save(dst, "JPEG", quality=args.quality, optimize=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the caller reads stderr
        print(f"normalize_image: {exc}", file=sys.stderr)
        sys.exit(1)
