import { useEffect, useState } from "react";
import type { FC } from "react";
import { AbsoluteFill, useDelayRender } from "remotion";
import { entrance, fadeOut } from "../animations.js";
import { captionHalo } from "../captionStyle.js";
import { darkTechTheme, type Theme } from "../theme.js";
import { TITLE_FONTS, isTitleStyle, type TitleStyle } from "../titleFonts.js";
import {
  isLightInk,
  titleFontSize,
  titleInk,
  wantsVerticalTitle,
} from "../titleStyle.js";
import { SceneBackground } from "./SceneBackground.js";

export interface TitleProps {
  theme?: Theme;
  text: string;
  subtext?: string | undefined;
  /** Bullet items under the title — shown only when the scene's
   *  content really enumerates (three or more parallel items). They
   *  replace the old single-line subtext, which read as a redundant
   *  echo of the caption. Rendered as one centered "a · b · c" line. */
  bullets?: string[] | undefined;
  /** Optional small kicker (e.g. "Chapter One", "Tutorial 03") rendered
   *  above the main title in uppercase tracking. */
  kicker?: string;
  /** Optional accent color override — a hex string used for the
   *  underline accent rule. Defaults to the theme's accent. */
  accent?: string;
  /** Which artistic treatment the card uses:
   *  - "kai"   — the title set horizontally in a brush 楷 face;
   *  - "brush" — the title set as a vertical column in a running brush.
   *  Defaults to "kai". */
  style?: TitleStyle;
  /** The scene art behind the card — a data URL resolved by the renderer
   *  (the bundler serves the entry over HTTP, so a file path never
   *  resolves in the browser). Without it the card falls back to the
   *  theme surface. */
  artSrc?: string | undefined;
  /** The font file for `style`, as a data URL resolved by the renderer
   *  from the workspace's `assets/fonts/`. Without it the theme's own
   *  type family is used. */
  fontSrc?: string | undefined;
  /** Frame width, used to size the type. Defaults to the 1080p target. */
  width?: number | undefined;
  /** Frame height, used to size the type. The renderer passes the real
   *  composition height. */
  height?: number | undefined;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** The band of the art the type actually covers, as fractions of the
 *  frame. The horizontal title sits across the middle; the vertical
 *  column sits in a strip down the right edge. */
const CENTER_BAND = { x0: 0.12, y0: 0.28, x1: 0.88, y1: 0.72 };
const RIGHT_STRIP = { x0: 0.74, y0: 0.08, x1: 0.95, y1: 0.92 };

/**
 * Mean luma of the part of the art the type covers. The picture is
 * decoded into a small canvas and sampled; a data URL never taints the
 * canvas, so the pixels stay readable.
 */
async function measureArtLuma(
  src: string,
  region: { x0: number; y0: number; x1: number; y1: number },
): Promise<number | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let count = 0;
    for (let y = 0; y < canvas.height; y++) {
      const fy = (y + 0.5) / canvas.height;
      if (fy < region.y0 || fy > region.y1) continue;
      for (let x = 0; x < canvas.width; x++) {
        const fx = (x + 0.5) / canvas.width;
        if (fx < region.x0 || fx > region.x1) continue;
        const i = (y * canvas.width + x) * 4;
        sum +=
          0.2126 * (data[i] ?? 0) +
          0.7152 * (data[i + 1] ?? 0) +
          0.0722 * (data[i + 2] ?? 0);
        count++;
      }
    }
    return count === 0 ? null : sum / count;
  } catch {
    return null;
  }
}

/** Register the artistic face with the browser. */
async function loadFace(family: string, src: string): Promise<void> {
  if (typeof document === "undefined") return;
  const face = new FontFace(family, src);
  await face.load();
  document.fonts.add(face);
}

function letterOffset(
  i: number,
  total: number,
  enterT: number,
): { x: number; y: number; rot: number } {
  const stagger = i / Math.max(1, total - 1) - 0.5;
  const x = stagger * 80 * (1 - enterT);
  const y = -50 * (1 - enterT);
  const rot = stagger * 12 * (1 - enterT);
  return { x, y, rot };
}

/**
 * The opening title card.
 *
 * The card is an image with type on it, not a flat panel: the scene's
 * own art fills the frame and the title is written over it in an
 * artistic face. The ink is picked against the art's brightness (see
 * `titleInk`), so the type stays legible on a bright picture and on a
 * dark one without a plate behind it.
 */
export const Title: FC<TitleProps> = ({
  theme = darkTechTheme,
  text,
  subtext,
  bullets,
  kicker,
  accent,
  style = "kai",
  artSrc,
  fontSrc,
  width = 1920,
  height = 1080,
  startFrame,
  durationInFrames,
  frame,
}) => {
  const { delayRender, continueRender } = useDelayRender();
  // The first frame must not paint a fallback face: the glyphs would be
  // swapped for the real ones a frame later, mid-fade.
  const [handle] = useState(() => delayRender("title card font"));
  const [artLuma, setArtLuma] = useState<number | null>(null);

  const vertical = style === "brush" && wantsVerticalTitle(text);
  // A hand-edited storyboard may carry a style the card does not know;
  // it falls back to the horizontal one instead of failing the render.
  const font = isTitleStyle(style) ? TITLE_FONTS[style] : TITLE_FONTS.kai;
  const family = `"${font.family}", ${theme.typography.title.fontFamily}`;

  useEffect(() => {
    let cancelled = false;
    if (artSrc !== undefined && artSrc.length > 0) {
      void measureArtLuma(
        artSrc,
        vertical ? RIGHT_STRIP : CENTER_BAND,
      ).then((value) => {
        if (!cancelled) setArtLuma(value);
      });
    }
    const fontJob =
      fontSrc !== undefined && fontSrc.length > 0
        ? loadFace(font.family, fontSrc).catch(() => undefined)
        : Promise.resolve();
    void fontJob.then(() => {
      if (!cancelled) continueRender(handle);
    });
    return () => {
      cancelled = true;
      continueRender(handle);
    };
  }, []);

  const enter = entrance(frame, 24, "up");
  const exit = fadeOut(frame, durationInFrames, 18);
  const opacity = enter.opacity * exit;
  const translateY = enter.translate;
  const scale = enter.scale;
  const underline = enter.scale;
  // A tiny continuous breath on the main title (1% scale oscillation)
  // makes the static "title card" feel alive without being distracting.
  const breath = 1 + Math.sin((frame / 96) * Math.PI * 2) * 0.01;
  const chars = [...text];
  const accentColor = accent ?? theme.colors.accent;
  const ink = titleInk(theme, artLuma);
  // Type that overflows its band is set smaller; the card never wraps a
  // headline onto a second line.
  const titleSize = titleFontSize(chars, width, height, vertical);

  const kickerNode =
    kicker !== undefined ? (
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: accentColor,
          fontFamily: theme.typography.subtitle.fontFamily,
          marginBottom: 24,
          opacity: Math.max(0, (enter.opacity - 0.2) / 0.8),
        }}
      >
        {kicker}
      </div>
    ) : null;

  const titleNode = (
    <h1
      style={{
        color: ink,
        fontFamily: family,
        fontWeight: 400,
        fontSize: titleSize,
        lineHeight: 1.12,
        margin: 0,
        textShadow: captionHalo(ink),
        display: vertical ? "block" : "flex",
        ...(vertical
          ? { writingMode: "vertical-rl", textOrientation: "upright" }
          : {}),
      }}
    >
      {chars.map((c, i) => {
        if (vertical) {
          const stagger = chars.length > 1 ? i / (chars.length - 1) : 0;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                whiteSpace: "pre",
                transform: `translateY(${(stagger - 0.5) * 60 * (1 - enter.opacity)}px)`,
                opacity: Math.max(0, (enter.opacity - stagger * 0.4) / 0.6),
              }}
            >
              {c}
            </span>
          );
        }
        const k = letterOffset(i, chars.length, enter.opacity);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              transform: `translate(${k.x}px, ${k.y}px) rotate(${k.rot}deg) scale(${breath})`,
            }}
          >
            {c}
          </span>
        );
      })}
    </h1>
  );

  // Accent underline — a small horizontal rule under the title that
  // scales in with the entrance.
  const ruleNode = (
    <div
      style={{
        marginTop: 32,
        width: 240,
        height: 6,
        background: accentColor,
        transform: `scaleX(${underline})`,
        transformOrigin: "center",
        boxShadow: `0 0 ${12 * enter.opacity}px ${accentColor}`,
        borderRadius: 3,
      }}
    />
  );

  // Subtext / bullets (optional) — the small line under the title.
  // Bullets ("a · b · c") win when present: they carry the scene's real
  // enumeration. A bare subtext still renders for older registered
  // storyboards.
  const smallLineNode =
    bullets !== undefined && bullets.length >= 2 ? (
      <div
        style={{
          marginTop: 36,
          fontSize: 30,
          color: ink,
          opacity: 0.85 * Math.max(0, (enter.opacity - 0.3) / 0.7),
          fontFamily: family,
          fontWeight: 400,
          letterSpacing: 2,
          textAlign: "center",
          maxWidth: 1400,
        }}
      >
        {bullets.join("　·　")}
      </div>
    ) : subtext !== undefined ? (
      <div
        style={{
          marginTop: 36,
          fontSize: 32,
          color: ink,
          opacity: 0.85 * Math.max(0, (enter.opacity - 0.3) / 0.7),
          fontFamily: family,
          fontWeight: 400,
          textAlign: "center",
          maxWidth: 1200,
        }}
      >
        {subtext}
      </div>
    ) : null;

  const art = artSrc !== undefined && artSrc.length > 0 ? (
    <SceneBackground
      src={artSrc}
      scrim={false}
      theme={theme}
      startFrame={startFrame}
      durationInFrames={durationInFrames}
      frame={frame}
    />
  ) : null;

  if (vertical) {
    // Poster layout: the title runs down the right edge, the small
    // lines sit opposite it. A dark edge keeps light ink readable on a
    // bright picture.
    const veil = isLightInk(ink)
      ? "linear-gradient(90deg, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)"
      : "linear-gradient(90deg, rgba(0,0,0,0) 52%, rgba(0,0,0,0.18) 100%)";
    return (
      <AbsoluteFill
        style={{
          backgroundColor: theme.colors.background,
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          opacity,
        }}
      >
        {art}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: veil,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 160,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            maxWidth: 640,
          }}
        >
          {kickerNode}
          {smallLineNode}
        </div>
        <div
          style={{
            position: "absolute",
            right: 180,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: 28,
            transform: `translateY(${translateY}px) scale(${scale * breath})`,
          }}
        >
          {titleNode}
          {/* Seal — the vermilion mark that closes a brush column. */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 8,
              background: accentColor,
              color: theme.colors.surface,
              fontFamily: family,
              fontSize: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: Math.max(0, (enter.opacity - 0.4) / 0.6),
            }}
          >
            题
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        opacity,
      }}
    >
      {art}
      <div
        style={{
          transform: `translateY(${translateY}px) scale(${scale * breath})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 1600,
        }}
      >
        {kickerNode}
        {titleNode}
        {ruleNode}
        {smallLineNode}
      </div>
    </AbsoluteFill>
  );
};
