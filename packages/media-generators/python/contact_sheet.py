#!/usr/bin/env python3
"""Contact sheet for visual review (v0.8 visual-guardrails plan, G3).

Lays every assets/images/scene_*.jpg out on one labeled grid so a human
can review the whole image set at a glance (`video visuals` → approve or
reject per scene). Pure Pillow — no model runtime, no network.

Usage:
  python contact_sheet.py --images-dir <dir> --out <png> [--labels labels.json]
labels.json maps scene keys ("scene_1") to caption strings; scenes without
a label still render with their number badge.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

THUMB_W, THUMB_H = 480, 270
PAD = 16
LABEL_H = 48
BADGE_W = 40
DEFAULT_COLS = 4

# CJK-capable system fonts, first match wins (captions are usually zh).
FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

_font_cache = {}


def load_font(size: int) -> ImageFont.ImageFont:
    if size in _font_cache:
        return _font_cache[size]
    for cand in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(cand, size)
            _font_cache[size] = font
            return font
        except Exception:
            continue
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def scene_num(name: str) -> int:
    m = re.match(r"scene[-_]?(\d+)", name)
    return int(m.group(1)) if m else 0


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build(images_dir: Path, out: Path, labels: dict, cols: int) -> Path:
    jpgs = sorted(
        (p for p in images_dir.glob("scene*.jpg") if scene_num(p.name) > 0),
        key=lambda p: scene_num(p.name),
    )
    if not jpgs:
        raise SystemExit(f"contact_sheet: no scene_*.jpg in {images_dir}")

    n = len(jpgs)
    cols = max(1, min(cols, n))
    rows = (n + cols - 1) // cols
    cell_w, cell_h = THUMB_W + 2 * PAD, THUMB_H + LABEL_H + 2 * PAD
    sheet = Image.new(
        "RGB", (cols * cell_w, rows * cell_h), color=(250, 249, 246)
    )
    draw = ImageDraw.Draw(sheet)
    font_label = load_font(22)
    font_badge = load_font(24)

    for idx, jpg in enumerate(jpgs):
        col, row = idx % cols, idx // cols
        x0, y0 = col * cell_w + PAD, row * cell_h + PAD
        num = scene_num(jpg.name)
        try:
            thumb = Image.open(jpg).convert("RGB")
            thumb.thumbnail((THUMB_W, THUMB_H))
        except Exception as err:  # unreadable image → red placeholder cell
            draw.rectangle(
                [x0, y0, x0 + THUMB_W, y0 + THUMB_H], fill=(200, 80, 80)
            )
            draw.text(
                (x0 + 8, y0 + 8), f"unreadable: {err}", fill=(255, 255, 255),
                font=font_label,
            )
            thumb = None
        if thumb is not None:
            sheet.paste(thumb, (x0 + (THUMB_W - thumb.width) // 2, y0))
        # Number badge (top-left of the cell).
        draw.rectangle(
            [x0, y0, x0 + BADGE_W, y0 + BADGE_W], fill=(24, 24, 27)
        )
        draw.text(
            (x0 + 8, y0 + 6), str(num), fill=(250, 250, 250), font=font_badge
        )
        # Caption label under the thumb.
        caption = truncate(labels.get(f"scene_{num}", ""), 26)
        if caption:
            draw.text(
                (x0 + 4, y0 + THUMB_H + 12), caption, fill=(24, 24, 27),
                font=font_label,
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, "PNG")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--labels", help="optional JSON path {scene_N: caption}")
    ap.add_argument("--cols", type=int, default=DEFAULT_COLS)
    args = ap.parse_args()
    labels = {}
    if args.labels:
        labels = json.loads(Path(args.labels).read_text("utf-8"))
    out = build(Path(args.images_dir), Path(args.out), labels, args.cols)
    # Machine-readable last line (the TS runner parses stdout).
    print(json.dumps({"ok": True, "out": str(out)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
