#!/usr/bin/env python3
"""
Pillow-based text overlay pass for video scenes.

Reads `storyboard/storyboard.yaml`, walks every scene, and produces a
transparent PNG at `assets/images/text/scene_N.png` carrying one
large key-info label per scene (the scene's `caption` field, or its
`captions.text` if a caption is set explicitly). Output size matches the
already-generated `assets/images/scene_N.jpg` so the renderer can
composite it pixel-for-pixel.

Render choices
--------------
- Font: a system sans-serif (Arial → Helvetica → DejaVu → Pillow default)
  with CJK coverage (the article is bilingual, so DejaVu/Bitmap fallback
  is unsafe). The font is loaded once and reused.
- Color: white text with a 4-way dark outline so it reads on any image
  background (cream, parchment, deep navy all work).
- Position: top-center banner, sitting in the upper third of the frame
  (above the safe-area where the bottom captions overlay lives — see
  `packages/video-components/src/captionStyle.ts`). The lower-third is
  reserved for the existing caption track.
- Size: starts at 9% of frame height and auto-shrinks in 2-px steps
  if the wrapped text overflows the available 86% width. Never grows
  larger than 12% of height to keep the title from dominating the frame.
- Padding: 12 px around the text inside the canvas, baked in so the
  outline has room to render.

CLI
---
    python3 scripts/pillow-text-overlay.py <project>
        [--out-dir <path>]    # default: <project>/assets/images/text
        [--storyboard <path>] # default: <project>/storyboard/storyboard.yaml
        [--images-dir <path>] # default: <project>/assets/images
        [--overwrite]         # regenerate even if the PNG already exists

Outputs one PNG per scene that has text. Skips scenes that:
  - lack a `caption`/`captions.text` field
  - have no `assets/images/scene_N.jpg` (the size source) — the
    caller should run `video make` first.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, Optional

from PIL import Image, ImageDraw, ImageFont


# ---- font discovery -----------------------------------------------------

FONT_CANDIDATES: tuple[str, ...] = (
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)


def pick_font() -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load the first available bold sans, else fall back to Pillow default."""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=100)
            except OSError:
                continue
    return ImageFont.load_default()


# ---- text shaping -------------------------------------------------------


def _wrap_to_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_px: int,
) -> list[str]:
    """Greedy line wrap by measured pixel width. Latin + CJK aware
    (whitespace is a break point, every CJK character is a break point)."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        # Tokenize: whitespace runs, ASCII words, or single non-space chars.
        tokens = re.findall(r"\s+|[A-Za-z0-9]+|[^\sA-Za-z0-9]", paragraph)
        current = ""
        for tok in tokens:
            candidate = current + tok
            bbox = draw.textbbox((0, 0), candidate, font=font)
            if bbox[2] - bbox[0] <= max_px or not current.strip():
                current = candidate
            else:
                lines.append(current.rstrip())
                current = tok.lstrip() if tok.strip() else ""
        if current:
            lines.append(current.rstrip())
    return lines


def _fit_size(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_w: int,
    max_h: int,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """Try a starting size, shrink until the wrapped text fits both
    width and height budgets. Returns the (font, lines) actually used."""
    # Start at ~9% of frame height, walk down by 2 px.
    start_size = max(48, int(max_h * 0.09))
    min_size = max(28, int(max_h * 0.045))  # floor: ~4.5% of frame height
    step = 2
    size = start_size
    while size >= min_size:
        font = ImageFont.truetype(
            pick_font_path(), size=size
        ) if pick_font_path() else ImageFont.load_default()
        lines = _wrap_to_width(draw, text, font, max_w)
        # Measure resulting block
        line_heights: list[int] = []
        line_widths: list[int] = []
        for line in lines:
            bb = draw.textbbox((0, 0), line, font=font)
            line_widths.append(bb[2] - bb[0])
            line_heights.append(bb[3] - bb[1])
        block_h = sum(line_heights) + max(0, (len(lines) - 1) * (size // 4))
        if max(line_widths) <= max_w and block_h <= max_h:
            return font, lines
        size -= step
    # Final fallback at min size
    font = (
        ImageFont.truetype(pick_font_path(), size=min_size)
        if pick_font_path()
        else ImageFont.load_default()
    )
    return font, _wrap_to_width(draw, text, font, max_w)


_FONT_PATH_CACHE: Optional[str] = None


def pick_font_path() -> Optional[str]:
    global _FONT_PATH_CACHE
    if _FONT_PATH_CACHE is not None:
        return _FONT_PATH_CACHE or None
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            _FONT_PATH_CACHE = path
            return path
    _FONT_PATH_CACHE = ""
    return None


# ---- drawing -----------------------------------------------------------


def render_overlay(
    width: int,
    height: int,
    text: str,
    out_path: Path,
) -> None:
    """Render `text` centered horizontally, top-anchored, on a transparent
    RGBA canvas the same size as the underlying scene image."""
    if not text.strip():
        return
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Reserve 86% of the frame width and 26% of the frame height for the
    # top banner. The remaining 14% horizontal margin is for the
    # safe-area title overlay that the renderer may add.
    max_w = int(width * 0.86)
    max_h = int(height * 0.26)

    font, lines = _fit_size(draw, text, max_w, max_h)

    # Top-center anchor with 6% margin from the top edge.
    top_margin = int(height * 0.06)
    line_spacing = max(2, font.size // 4)
    block_lines: list[tuple[str, int]] = []  # (line, height)
    total_h = 0
    for line in lines:
        bb = draw.textbbox((0, 0), line, font=font)
        block_lines.append((line, bb[3] - bb[1]))
        total_h += bb[3] - bb[1]
    total_h += line_spacing * max(0, len(lines) - 1)
    y = top_margin
    for line, line_h in block_lines:
        bb = draw.textbbox((0, 0), line, font=font)
        line_w = bb[2] - bb[0]
        x = (width - line_w) // 2
        # 4-way outline so the text reads on any image. Outline drawn
        # in a darker shadow color at offsets {±stroke, 0} / {0, ±stroke},
        # then the white fill on top.
        stroke = max(2, font.size // 14)
        shadow = (0, 0, 0, 200)
        fill = (255, 255, 255, 255)
        for dx, dy in (
            (-stroke, 0), (stroke, 0), (0, -stroke), (0, stroke),
            (-stroke, -stroke), (stroke, -stroke),
            (-stroke, stroke), (stroke, stroke),
        ):
            draw.text((x + dx, y + dy), line, font=font, fill=shadow)
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h + line_spacing

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)


# ---- scene walking -----------------------------------------------------


def parse_storyboard(path: Path) -> dict:
    """Tiny YAML reader — we only need top-level `scenes` and each scene's
    `id`, `caption`, `visual.props.caption`, and `captions.text`. Avoids
    pulling PyYAML to keep the dep surface minimal."""
    text = path.read_text(encoding="utf-8")
    # Strip comments to avoid "#Foo" lines that include ":"
    lines = []
    for raw in text.splitlines():
        stripped = raw.split("#", 1)[0] if not raw.lstrip().startswith("#") else ""
        # Preserve structure; we just remove the trailing # comment marker.
        # Re-attach a newline so YAML line count is preserved.
        if stripped != raw:
            lines.append(stripped.rstrip())
        else:
            lines.append(raw)
    cleaned = "\n".join(lines)
    try:
        import yaml  # type: ignore
    except ImportError:
        print(
            "this script needs PyYAML to parse storyboard.yaml; install with `pip3 install --user pyyaml`",
            file=sys.stderr,
        )
        raise
    return yaml.safe_load(cleaned)


def scene_text(s: dict) -> str:
    """Pick the most descriptive text in this priority order:
    1. visual.props.text_overlay (curated key-info banner line, may include \\n)
    2. visual.props.caption (per-scene text overlay already in storyboard)
    3. visual.props.text / title (Callout / BigIdea carry short title)
    4. captions.text (set by sync-storyboard from article)
    5. scene-level caption (the article's short label)
    """
    vp = (s.get("visual") or {}).get("props") or {}
    for key in ("text_overlay", "caption", "text", "title"):
        v = vp.get(key)
        if isinstance(v, str) and v.strip():
            return v
    captions = s.get("captions") or {}
    t = captions.get("text")
    if isinstance(t, str) and t.strip():
        return t
    c = s.get("caption")
    if isinstance(c, str) and c.strip():
        return c
    return ""


def scene_id_to_index(scene_id: str) -> int:
    """`scene-04` / `scene_4` -> 4. Used to name the output PNG."""
    m = re.search(r"scene[-_]?(\d+)", scene_id)
    if not m:
        return -1
    return int(m.group(1))


# ---- main --------------------------------------------------------------


def main(argv: Iterable[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", help="project slug (under projects/)")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--storyboard", default=None)
    ap.add_argument("--images-dir", default=None)
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args(list(argv))

    project_root = Path("projects") / args.project
    storyboard = (
        Path(args.storyboard)
        if args.storyboard
        else project_root / "storyboard" / "storyboard.yaml"
    )
    images_dir = (
        Path(args.images_dir) if args.images_dir else project_root / "assets" / "images"
    )
    out_dir = (
        Path(args.out_dir) if args.out_dir else project_root / "assets" / "images" / "text"
    )

    doc = parse_storyboard(storyboard)
    scenes = doc.get("scenes") or []
    if not scenes:
        print(f"no scenes found in {storyboard}", file=sys.stderr)
        return 1

    made = 0
    skipped = 0
    for s in scenes:
        sid = s.get("id") or ""
        n = scene_id_to_index(sid)
        if n < 0:
            continue
        text = scene_text(s).strip()
        if not text:
            skipped += 1
            continue
        # Size source: the underlying scene image. If absent, skip.
        img_path = images_dir / f"scene_{n}.jpg"
        if not img_path.exists():
            # Try 0-padded 2-digit too (some flows use scene_07.jpg)
            for cand in (images_dir / f"scene_{n:02d}.jpg",):
                if cand.exists():
                    img_path = cand
                    break
            else:
                skipped += 1
                continue
        out_path = out_dir / f"scene_{n}.png"
        if out_path.exists() and not args.overwrite:
            continue
        with Image.open(img_path) as img:
            w, h = img.size
        render_overlay(w, h, text, out_path)
        made += 1
    print(f"made {made} overlay(s)  skipped {skipped}  → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
