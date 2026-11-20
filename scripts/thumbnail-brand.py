#!/usr/bin/env python3
"""Brand a project's YouTube thumbnail (owner mandate 2026-11-19: thumbnails
need an obvious brand mark).

Usage:
  scripts/thumbnail-brand.py <youtube-dir>     # dir holding thumbnail.jpg|png

What it does (deterministic Pillow compositing, identical every run):
  1. canvas EXPANDS by brand.thumbnail.border_width on all sides — the
     base image loses no pixels — and the 朱红 border fills the new frame.
  2. the brand icon (brand.icon) is composited top-left as a circular
     mascot badge with a ring.
  3. writes thumbnail.jpg (quality 92); the unbranded original is kept
     once as thumbnail-raw.jpg.

Config: brand.yaml → brand.thumbnail (border_color/border_width/
icon_diameter/ring_color/ring_width/margin). Icon path: brand.icon.
Exit codes: 0 branded / 3 Pillow missing / 4 input missing.
"""
import os, sys, glob

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow not available — install into the active python (pip install pillow)")
    sys.exit(3)

import yaml


def repo_root_for(yt_dir):
    d = os.path.abspath(yt_dir)
    while True:
        if os.path.exists(os.path.join(d, "brand.yaml")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return os.path.dirname(os.path.abspath(__file__)) and os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            )
        d = parent


def find_base(yt_dir):
    for name in ("thumbnail.jpg", "thumbnail.png"):
        p = os.path.join(yt_dir, name)
        if os.path.exists(p):
            return p
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 4
    yt_dir = os.path.abspath(sys.argv[1])
    base_path = find_base(yt_dir)
    if not base_path:
        print(f"no thumbnail.jpg/png in {yt_dir}")
        return 4
    root = repo_root_for(yt_dir)

    brand = {}
    with open(os.path.join(root, "brand.yaml"), encoding="utf-8") as fh:
        brand = (yaml.safe_load(fh) or {}).get("brand") or {}
    t = brand.get("thumbnail") or {}
    border_w = int(t.get("border_width", 24))
    border_color = tuple(
        int(t.get("border_color", "#C8102E").strip("#")[i : i + 2], 16) for i in (0, 2, 4)
    )
    diameter = int(t.get("icon_diameter", 170))
    ring_color = tuple(
        int(t.get("ring_color", "#C8102E").strip("#")[i : i + 2], 16) for i in (0, 2, 4)
    ) + (255,)
    ring_w = int(t.get("ring_width", 10))
    margin = int(t.get("margin", 36))
    icon_path = os.path.join(root, brand.get("icon", "assets/brand/icon.png"))

    base = Image.open(base_path).convert("RGB")
    W, H = base.size

    # 1. expanded canvas — the base image keeps every pixel
    canvas = Image.new("RGB", (W + border_w * 2, H + border_w * 2), border_color)
    canvas.paste(base, (border_w, border_w))
    draw = ImageDraw.Draw(canvas)

    # 2. circular mascot badge, top-left inside the border
    icon = Image.open(icon_path).convert("RGBA")
    im = icon.resize((diameter, diameter), Image.LANCZOS)
    mask = Image.new("L", (diameter * 4, diameter * 4), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([0, 0, diameter * 4, diameter * 4], fill=255)
    mask = mask.resize((diameter, diameter), Image.LANCZOS)
    chip = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    chip.paste(im, (0, 0), mask)
    ring_size = diameter + ring_w * 2
    ring = Image.new("RGBA", (ring_size, ring_size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([0, 0, ring_size, ring_size], fill=ring_color)
    rmask = Image.new("L", (ring_size, ring_size), 0)
    ImageDraw.Draw(rmask).ellipse(
        [ring_w, ring_w, ring_size - ring_w, ring_size - ring_w], fill=0
    )
    ring.putalpha(rmask)
    canvas.paste(ring, (border_w + margin, border_w + margin), ring)
    canvas.paste(chip, (border_w + margin + ring_w, border_w + margin + ring_w), chip)

    out = os.path.join(yt_dir, "thumbnail.jpg")
    raw = os.path.join(yt_dir, "thumbnail-raw.jpg")
    if not os.path.exists(raw):
        import shutil

        if base_path != out:
            os.rename(base_path, raw)  # different names: keep original as-is
        else:
            shutil.copy(base_path, raw)  # same name: snapshot before overwrite
    canvas.save(out, quality=92)
    print(f"✓ branded thumbnail → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
