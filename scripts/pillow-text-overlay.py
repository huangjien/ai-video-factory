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

# Latin-only faces (nice for the en videos) — chosen when the banner
# text holds no CJK.
FONT_CANDIDATES_LATIN: tuple[str, ...] = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)

# Faces with CJK coverage — REQUIRED for Chinese banners. Arial on macOS
# has no CJK glyphs, and a missing glyph renders as a tofu box (2026-10-24:
# every Chinese banner in the zh video shipped as empty squares). The
# picker verifies coverage instead of trusting the file name.
FONT_CANDIDATES_CJK: tuple[str, ...] = (
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
)

# Kept for backwards compatibility with anything importing the old name.
FONT_CANDIDATES: tuple[str, ...] = FONT_CANDIDATES_LATIN + FONT_CANDIDATES_CJK


def has_cjk(text: str) -> bool:
    """True when the text contains CJK ideographs or fullwidth forms."""
    return any(
        "\u2e80" <= ch <= "\u9fff" or "\uff00" <= ch <= "\uffef" or "\u3000" <= ch <= "\u303f"
        for ch in text
    )


def font_covers_cjk(font: ImageFont.FreeTypeFont) -> bool:
    """True when the font has a real glyph for a CJK character.

    A missing glyph renders as the .notdef box, which is bit-identical to
    a private-use codepoint in a font that has no PUA glyphs. Comparing the
    two masks tells tofu from a real glyph without extra dependencies
    (fontTools is not assumed to be installed)."""
    try:
        cjk = bytes(font.getmask("验"))
        pua = bytes(font.getmask("\ue000"))
    except Exception:
        return False
    if not cjk:
        return False
    return cjk != pua


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
        font_path = pick_font_path(text)
        font = (
            ImageFont.truetype(font_path, size=size)
            if font_path
            else ImageFont.load_default()
        )
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
    font_path = pick_font_path(text)
    font = (
        ImageFont.truetype(font_path, size=min_size)
        if font_path
        else ImageFont.load_default()
    )
    return font, _wrap_to_width(draw, text, font, max_w)


_FONT_PATH_CACHE: Optional[dict] = None


def pick_font_path(text: str = "") -> Optional[str]:
    """Path of a font that can actually RENDER `text`.

    CJK text picks a CJK-capable face (verified by glyph comparison);
    Latin text keeps the previous bold-sans preference. Returns None when
    nothing suitable exists, and the caller falls back to Pillow's default
    bitmap font.
    """
    global _FONT_PATH_CACHE
    cache_key = "cjk" if has_cjk(text) else "latin"
    if (
        _FONT_PATH_CACHE is not None
        and getattr(_FONT_PATH_CACHE, "key", None) == cache_key
    ):
        return _FONT_PATH_CACHE["path"] or None
    candidates = (
        FONT_CANDIDATES_CJK + FONT_CANDIDATES_LATIN
        if has_cjk(text)
        else FONT_CANDIDATES_LATIN + FONT_CANDIDATES_CJK
    )
    chosen = ""
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            probe = ImageFont.truetype(path, size=64)
        except OSError:
            continue
        if has_cjk(text) and not font_covers_cjk(probe):
            # This face would render tofu for the CJK text — keep looking.
            continue
        chosen = path
        break
    _FONT_PATH_CACHE = {"key": cache_key, "path": chosen}
    return chosen or None


# ---- drawing -----------------------------------------------------------


def render_overlay(
    width: int,
    height: int,
    text: str,
    out_path: Path,
    subline: str = "",
) -> None:
    """Render a two-tier banner on a transparent RGBA canvas the same size
    as the underlying scene image:

    tier 1 (big):   `text` — the scene's key-info headline
    tier 2 (small): `subline` — the narration's first sentence, ~45% of
                    the headline size, slightly translucent so the
                    hierarchy reads. Skipped when empty.

    Both centered horizontally, anchored at the top, 4-way dark outline
    so they read on any image background."""
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

    # Subline tier: ~45% of the headline size, its own width/height budget
    # (2 wrapped lines max via the same auto-shrink).
    sub_font = None
    sub_lines: list[str] = []
    if subline.strip():
        sub_start = max(28, int(font.size * 0.45))
        sub_min = max(20, int(font.size * 0.3))
        sub_size = sub_start
        while sub_size >= sub_min:
            fp = pick_font_path(subline)
            candidate = (
                ImageFont.truetype(fp, size=sub_size)
                if fp
                else ImageFont.load_default()
            )
            cand_lines = _wrap_to_width(draw, subline, candidate, max_w)
            widths = []
            heights = []
            for line in cand_lines:
                bb = draw.textbbox((0, 0), line, font=candidate)
                widths.append(bb[2] - bb[0])
                heights.append(bb[3] - bb[1])
            if max(widths) <= max_w and sum(heights) <= int(height * 0.09):
                sub_font, sub_lines = candidate, cand_lines
                break
            sub_size -= 2
        if sub_font is None:
            fp = pick_font_path(subline)
            sub_font = (
                ImageFont.truetype(fp, size=sub_min)
                if fp
                else ImageFont.load_default()
            )
            sub_lines = _wrap_to_width(draw, subline, sub_font, max_w)[:2]

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

    def draw_centered(
        line: str,
        fnt: ImageFont.FreeTypeFont | ImageFont.ImageFont,
        y: int,
        fill: tuple[int, int, int, int],
    ) -> int:
        """Draw one outlined centered line; returns the line's height."""
        bb = draw.textbbox((0, 0), line, font=fnt)
        line_w = bb[2] - bb[0]
        line_h = bb[3] - bb[1]
        x = (width - line_w) // 2
        stroke = max(2, getattr(fnt, "size", 24) // 14)
        shadow = (0, 0, 0, 200)
        for dx, dy in (
            (-stroke, 0), (stroke, 0), (0, -stroke), (0, stroke),
            (-stroke, -stroke), (stroke, -stroke),
            (-stroke, stroke), (stroke, stroke),
        ):
            draw.text((x + dx, y + dy), line, font=fnt, fill=shadow)
        draw.text((x, y), line, font=fnt, fill=fill)
        return line_h

    for line, _line_h in block_lines:
        y += draw_centered(line, font, y, (255, 255, 255, 255))
        y += line_spacing

    if sub_font is not None and sub_lines:
        y += int(font.size * 0.25)  # gap between tiers
        for line in sub_lines:
            y += draw_centered(line, sub_font, y, (255, 255, 255, 230))
            y += max(2, sub_font.size // 5)

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


def _first_sentence(narration: str) -> str:
    """First sentence of the narration, whitespace-normalized."""
    text = re.sub(r"\s+", " ", narration or "").strip()
    if not text:
        return ""
    m = re.match(r"^(.+?[。！？!?\.\u2026])(?=\s|$)", text)
    return (m.group(1) if m else text).strip()


def scene_texts(s: dict, headline_override: str = "") -> tuple[str, str]:
    """(headline, subline) for the two-tier banner.

    headline: `headline_override` (e.g. the article's caption in
    no_captions mode) or the scene_text() priority chain.
    subline: the narration's first sentence — the scene's key point —
    truncated so it never becomes a paragraph. Dropped when it would just
    repeat the headline.
    """
    headline = (headline_override or scene_text(s)).strip()
    if not headline:
        return "", ""
    narration = ""
    narr = s.get("narration") or {}
    if isinstance(narr, dict):
        narration = narr.get("text") or ""
    elif isinstance(narr, str):
        narration = narr
    subline = _first_sentence(narration)
    # Cap: one line's worth of info, not a paragraph (~64 units; CJK chars
    # count double next to Latin, mirroring the caption safe-area rule).
    max_units = 64
    units = 0
    kept: list[str] = []
    truncated = False
    for ch in subline:
        units += 2 if has_cjk(ch) else 1
        if units > max_units:
            truncated = True
            break
        kept.append(ch)
    subline = "".join(kept).rstrip()
    if truncated:
        # Never end mid-word: back off to the last word boundary, then mark
        # the elision. CJK has no spaces — the ellipsis alone is fine.
        sp = subline.rfind(" ")
        if sp > 0:
            subline = subline[:sp].rstrip()
        subline += "…"
    if not subline or subline == headline:
        return headline, ""
    return headline, subline


def parse_article_captions(path: Path) -> dict[int, str]:
    """Scene index -> caption from article.md (the `## Scenes` yaml block).

    With `no_captions: true` the storyboard carries no caption text at all
    (the bottom label is deliberately gone), so the key-info banner falls
    back to the ARTICLE's caption field — the durable source of truth that
    survives storyboard re-derivations and language workdirs."""
    try:
        import yaml  # type: ignore
    except ImportError:
        return {}
    text = path.read_text(encoding="utf-8")
    m = re.search(r"## Scenes\s*\n+```yaml\n([\s\S]*?)\n```", text)
    if not m:
        return {}
    try:
        doc = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}
    out: dict[int, str] = {}
    for i, s in enumerate(doc.get("scenes") or [], start=1):
        c = s.get("caption") if isinstance(s, dict) else None
        if isinstance(c, str) and c.strip():
            out[i] = c.strip()
    return out


def scene_id_to_index(scene_id: str) -> int:
    """`scene-04` / `scene_4` -> 4. Used to name the output PNG."""
    m = re.search(r"scene[-_]?(\d+)", scene_id)
    if not m:
        return -1
    return int(m.group(1))


# ---- main --------------------------------------------------------------


def main(argv: Iterable[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "project",
        help="project root PATH (preferred, works for nested workdirs like projects/<id>/l10n/<lang>) or a slug under projects/",
    )
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--storyboard", default=None)
    ap.add_argument("--images-dir", default=None)
    ap.add_argument(
        "--article",
        default=None,
        help="article.md path — caption fallback when the storyboard has no caption text (no_captions mode)",
    )
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args(list(argv))

    candidate = Path(args.project)
    # A real directory wins (absolute or cwd-relative) — this is how `video
    # make` invokes us for language workdirs (projects/<id>/l10n/<lang>/),
    # whose basename is the LANG, not a slug under projects/.
    if candidate.is_dir():
        project_root = candidate
    else:
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
    article_captions = (
        parse_article_captions(Path(args.article))
        if args.article
        else parse_article_captions(project_root / "article.md")
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
        headline, subline = scene_texts(s)
        if not headline:
            # no_captions storyboards carry no caption text — fall back to
            # the article's own caption for this scene index.
            headline = article_captions.get(n, "")
            if not headline:
                skipped += 1
                continue
            headline, subline = scene_texts(s, headline)
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
        render_overlay(w, h, headline, out_path, subline=subline)
        made += 1
    print(f"made {made} overlay(s)  skipped {skipped}  → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
