#!/usr/bin/env python3
"""Bake title / quote text onto generated scene images (Pillow).

Reads a JSON manifest next to the images:

    { "scenes": { "1":  { "style": "title", "text": "...", "subtext": "..." },
                  "26": { "style": "quote", "text": "..." } } }

and rewrites scene_N.jpg IN PLACE. Text is placed in the upper two-thirds and
kept out of the lower third, where the renderer's caption overlay lands. A
soft scrim behind the text block keeps it legible over any artwork.

No model runtime, no network: Pillow only, same dependency contract as
contact_sheet.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# First existing file wins. macOS first (dev machines), then common Linux
# Noto CJK locations (CI/containers). A missing font is a hard error: silent
# fallback to a bitmap font would render tofu boxes into a finished video.
FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    sys.exit(f"bake_text: no CJK font found (tried {len(FONT_CANDIDATES)} paths)")


def wrap_cjk(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Greedy wrap. CJK breaks anywhere; Latin runs break on spaces only."""
    lines: list[str] = []
    for raw_line in text.split("\n"):
        current = ""
        latin_run = ""
        for ch in raw_line:
            if ch.isascii() and not ch.isspace():
                latin_run += ch
                current += ch
                continue
            # breaking point candidate
            if latin_run and font.getlength(current) > max_width:
                # move the latin run down to the next line whole
                head = current[: -len(latin_run)]
                lines.append(head)
                current = latin_run
                latin_run = ""
            latin_run = ""
            current += ch
            if font.getlength(current) > max_width:
                lines.append(current[:-1])
                current = ch
        lines.append(current)
    return [l for l in lines if l != ""]


def scrim_block(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    alpha: int,
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(
        [x0, y0, x1, y1],
        radius=(y1 - y0) // 6,
        fill=(10, 14, 26, alpha),
    )


def bake_title(
    img: Image.Image,
    spec: dict,
    palette: dict,
) -> None:
    """Opening-title style: large text high on the frame, subtext beneath."""
    w, h = img.size
    title_size = int(h / 9.5)
    sub_size = int(h / 20)
    title_font = load_font(title_size)
    sub_font = load_font(sub_size)

    max_width = int(w * 0.78)
    title_lines = wrap_cjk(spec["text"], title_font, max_width)
    sub_lines = wrap_cjk(spec.get("subtext", ""), sub_font, max_width) if spec.get("subtext") else []

    line_gap = int(title_size * 0.28)
    title_h = len(title_lines) * (title_size + line_gap)
    sub_h = len(sub_lines) * (sub_size + int(sub_size * 0.35))
    accent_h = int(h * 0.006)

    block_h = title_h + accent_h * 3 + sub_h + int(h * 0.03)
    y0 = int(h * 0.16)
    x_margin = int(w * 0.08)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    scrim_block(odraw, (x_margin, y0, w - x_margin, y0 + block_h), int(palette.get("scrim", 120)))

    y = y0 + int(h * 0.015)
    for line in title_lines:
        tw = title_font.getlength(line)
        odraw.text(
            ((w - tw) / 2, y),
            line,
            font=title_font,
            fill=palette.get("color", (244, 241, 234, 255)),
        )
        y += title_size + line_gap
    # accent rule
    rule_w = int(w * 0.12)
    odraw.rectangle(
        [((w - rule_w) / 2), y + accent_h, ((w + rule_w) / 2), y + accent_h * 2],
        fill=palette.get("accent", (181, 83, 60, 255)),
    )
    y += accent_h * 3
    for line in sub_lines:
        tw = sub_font.getlength(line)
        odraw.text(
            ((w - tw) / 2, y),
            line,
            font=sub_font,
            fill=palette.get("subcolor", (244, 241, 234, 220)),
        )
        y += sub_size + int(sub_size * 0.35)

    img.paste(overlay, (0, 0), overlay)


def bake_quote(
    img: Image.Image,
    spec: dict,
    palette: dict,
) -> None:
    """Closing-quote style: a wrapped block centred in the upper half."""
    w, h = img.size
    quote_size = int(h / 15)
    font = load_font(quote_size)
    max_width = int(w * 0.70)

    lines = wrap_cjk(spec["text"], font, max_width)
    line_gap = int(quote_size * 0.5)
    block_h = len(lines) * (quote_size + line_gap)
    y0 = max(int(h * 0.14), int(h * 0.42) - block_h // 2)
    x_margin = int(w * 0.10)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    scrim_block(
        odraw,
        (x_margin, y0 - int(h * 0.02), w - x_margin, y0 + block_h + int(h * 0.02)),
        int(palette.get("scrim", 110)),
    )

    y = y0
    for line in lines:
        tw = font.getlength(line)
        odraw.text(
            ((w - tw) / 2, y),
            line,
            font=font,
            fill=palette.get("color", (244, 241, 234, 255)),
        )
        y += quote_size + line_gap

    if spec.get("attribution"):
        a_font = load_font(int(h / 26))
        aw = a_font.getlength(spec["attribution"])
        odraw.text(
            ((w - aw) / 2, y + int(h * 0.012)),
            spec["attribution"],
            font=a_font,
            fill=palette.get("subcolor", (244, 241, 234, 210)),
        )

    img.paste(overlay, (0, 0), overlay)


BAKERS = {"title": bake_title, "quote": bake_quote}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--manifest", required=True, help="path to bake.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    images_dir = Path(args.images_dir)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    # JSON gives lists; Pillow wants tuples for colours. Normalise once.
    palette = {
        k: tuple(v) if isinstance(v, list) else v
        for k, v in manifest.get("palette", {}).items()
    }

    baked: list[str] = []
    for scene, spec in sorted(manifest.get("scenes", {}).items(), key=lambda kv: int(kv[0])):
        style = spec.get("style", "title")
        baker = BAKERS.get(style)
        if baker is None:
            print(f"scene_{scene}: unknown style {style!r} — skipped", file=sys.stderr)
            continue
        image_path = images_dir / f"scene_{scene}.jpg"
        if not image_path.exists():
            print(f"scene_{scene}: no image yet — skipped", file=sys.stderr)
            continue
        img = Image.open(image_path).convert("RGBA")
        baker(img, spec, palette)
        if args.dry_run:
            out = images_dir / f"scene_{scene}.preview.jpg"
        else:
            out = image_path
        img.convert("RGB").save(out, "JPEG", quality=92)
        baked.append(f"scene_{scene}")
        print(f"baked {out}")

    print(f"bake_text: {len(baked)} scene(s) baked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
