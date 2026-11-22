import type { Scene as ArticleScene } from "./schemas.js";

/**
 * v0.4.1 — per-component visual prop builders.
 *
 * The storyboard mapper previously emitted only `{text, visual}` for
 * every non-Title scene, so the renderer's `FlowChart`, `Terminal`,
 * `Timeline`, and `Callout` components all rendered with
 * empty/default props. This module builds the structured props each
 * component needs from the scene's caption + narration + matched prose
 * section.
 *
 * Builders are deterministic (no LLM call), idempotent, and run at
 * YAML-build time. They emit the smallest valid prop set that lets the
 * renderer produce something meaningful; richer prop shapes can be
 * added later without breaking the human-edit invariant.
 */

export interface BuildInput {
  /** The article's matched prose section for this scene (1:1 by
   *  section index when the article has fewer sections than scenes).
   *  Null when the article has no numbered sections. */
  section: { heading: string; body: string } | null;
  /** The article's declared language (e.g. "zh-CN" / "en-US"). Used only to
   *  localize the builders' fallback labels. */
  language?: string | undefined;
  /** CS-12: the article's H1 — the film's title. It is the only
   *  human-readable title text available to the title card. */
  title?: string | undefined;
  /** The title card's artistic treatment, from the article frontmatter
   *  (`title_style`): "kai" for a horizontal brush 楷 face, "brush" for a
   *  vertical running-brush column. Unknown values fall back to "kai". */
  titleStyle?: string | undefined;
}

/** Localize a fallback label. The builders were otherwise language-blind: an
 *  en-US article that gave a component no explicit stage names still got
 *  Chinese ones ("中间处理", "左"/"右"), which then burned onto the screen. */
function loc(language: string | undefined, zh: string, en: string): string {
  return (language ?? "zh-CN").toLowerCase().startsWith("en") ? en : zh;
}

/** Each builder returns the per-component `props` block as a plain
 *  object so the YAML emitter can write key: value lines directly.
 *  Strings are written verbatim (no extra escaping) — callers serialize
 *  via the same `yamlStr` helper used elsewhere. */
export type VisualPropsBuilder = (
  scene: ArticleScene,
  input: BuildInput,
) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Title — opening card. Always first scene.
// ---------------------------------------------------------------------------
/**
 * The enumeration a passage actually contains, as bullet-worthy items.
 *
 *  The title card's small line used to be the film's title — under the
 *  big caption it read as a redundant second thought (2026-11 user note:
 *  "小字部分没有太多意义"). The small line is now either BULLETS — when
 *  the scene's narration really enumerates (three or more parallel
 *  segments, averaging at most 9 characters) — or nothing. A
 *  single-sentence subline is not accepted: it duplicates the burned-in
 *  caption track at the bottom of the frame.
 *
 *  Deterministic on purpose: the same scan runs in the Pillow overlay
 *  pass (scripts/pillow-text-overlay.py) for the content frames, and
 *  the two surfaces must agree on what counts as a list.
 */

/** Segment openers that mark a TAIL clause ("方向、环境、运气，都会影响
 *  结果" — the tail is the claim, not a fourth item). Dropped outright. */
const ENUM_DROP_START = [
  "都会",
  "也会",
  "才是",
  "却是",
  "其实",
  "并不",
  "不过是",
  // concessive openers — the clause concedes, it is not an item
  "即使",
  "哪怕",
  "即便",
  // the known cleft lead-in ("最重要的，是…") — the list follows it
  "最重要的",
];

/** A segment carrying the negated CONCLUSION ("任劳任怨，并不等于真正的
 *  努力") is the claim, not an item — dropped outright, as are
 *  pronoun-possessive predicates ("你的职责是平整土地": a maxim, not a
 *  list item). */
const ENUM_DROP_CONTAIN = ["不等于", "不是", "你的", "我的", "他的"];

/** Leading connectives that are the sentence's glue ("先分清…" → the
 *  bullet is the item, not "先"). */
const ENUM_STRIP_START = [
  "先",
  "再",
  "然后",
  "最后",
  "接着",
  "以及",
  "和",
  "与",
  "或",
  "比如",
  "例如",
  "就是",
  "也就是",
  "还有",
  "又",
  "还是",
  "就",
  "都",
  "而是",
  "而非",
  "也",
];

/** Trailing conditional/spoken markers ("影响日常功能时" → the
 *  condition, not the item) and cleft lead-ins ("最重要的是"). */
const ENUM_DROP_SUFFIX = ["时", "的话", "而言", "来说", "之后", "以后"];

/** Cleft lead-ins ("最重要的是" → the list follows it) — the segment is
 *  glue, so it is DROPPED, not stripped to a fragment ("最怕的是" →
 *  "最怕" is not a bullet). */
const ENUM_DROP_CLEFT = ["的是", "要的是", "重要的是"];

export function extractEnumeration(text: string, max = 4): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const sentence of sentences) {
    // A list often follows a colon ("换成可执行的节奏：每周练一项技能，…")
    // — the lead-in is not a bullet.
    const colon = sentence.indexOf("：");
    const body =
      colon > 0 && sentence.slice(colon + 1).trim().length >= 8
        ? sentence.slice(colon + 1)
        : sentence;
    const segments = body
      .split(/[，、；;,]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const cleaned: string[] = [];
    for (let seg of segments) {
      if (ENUM_DROP_START.some((p) => seg.startsWith(p))) continue;
      if (ENUM_DROP_CONTAIN.some((m) => seg.includes(m))) continue;
      if (ENUM_DROP_CLEFT.some((c) => seg.endsWith(c))) continue;
      for (const p of ENUM_STRIP_START) {
        if (seg.startsWith(p) && seg.length > p.length + 1) {
          seg = seg.slice(p.length).trim();
          break;
        }
      }
      for (const suffix of ENUM_DROP_SUFFIX) {
        if (seg.endsWith(suffix) && seg.length > suffix.length + 1) {
          seg = seg.slice(0, -suffix.length).trim();
          break;
        }
      }
      if (seg.length >= 2 && seg.length <= 14 && !cleaned.includes(seg)) {
        cleaned.push(seg);
      }
    }
    if (cleaned.length >= 3) {
      // Parallel beats share a GRANULARITY. "舰桥、机舱" (2-char places)
      // mixed with "军舰在夜里航行" (a 7-char clause) is a scene
      // description chopped up, not a list — require the longest segment
      // to stay within 3× the shortest.
      const shortest = Math.min(...cleaned.map((s) => s.length));
      if (Math.max(...cleaned.map((s) => s.length)) > shortest * 3) continue;
      const total = cleaned.reduce((n, s) => n + s.length, 0);
      if (total / cleaned.length <= 8.5) return cleaned.slice(0, max);
    }
  }
  return [];
}

const buildTitle: VisualPropsBuilder = (scene, input) => {
  const props: Record<string, unknown> = {
    text: scene.caption,
  };
  // The title card is set in an artistic face. The article picks the
  // treatment; an unknown value falls back to the horizontal one.
  if (input.titleStyle === "brush" || input.titleStyle === "kai") {
    props.style = input.titleStyle;
  }
  // The small line under the big caption is BULLETS or NOTHING. The
  // film's title used to sit there and read as a redundant echo of the
  // caption; an art-direction line must never be viewer-facing copy.
  // (`visual:` is written for the image model.)
  const bullets = extractEnumeration(scene.narration ?? "");
  if (bullets.length >= 3) {
    props.bullets = bullets;
  }
  return props;
};

// ---------------------------------------------------------------------------
const buildImageBackground: VisualPropsBuilder = (scene) => {
  const sceneNumber = Number(scene.id.match(/scene[-_]?([0-9]+)/i)?.[1]);
  return {
    src: `assets/images/scene_${sceneNumber}.jpg`,
    fit: "cover",
  };
};

// ---------------------------------------------------------------------------
// DoodleScene — hand-drawn canvas (v0.2 renderer family). Shapes are picked
// deterministically from the scene text (seeded — no Math.random), spread
// across the canvas; colors/background stay unset so the theme drives ink.
// ---------------------------------------------------------------------------
const DOODLE_SHAPES = ["circle", "star", "zigzag", "spiral"] as const;

function seedOf(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const buildDoodleScene: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const seed = seedOf(`${scene.caption ?? ""}|${scene.visual ?? ""}`);
  const strokes = [0, 1, 2, 3].map((i) => ({
    id: `doodle-${i}`,
    shape: DOODLE_SHAPES[(seed + i * 7) % DOODLE_SHAPES.length]!,
    x: 380 + i * 380 + ((seed >> (i * 3)) % 120),
    y: 280 + ((seed >> (i * 5)) % 460),
    size: 130 + ((seed >> (i * 7)) % 90),
  }));
  return { strokes };
};

// ---------------------------------------------------------------------------
// QuoteBlock — quote card with attribution.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// StatGrid — 2-4 big numbers with labels. Numbers are pulled with their
// unit (% / 倍 / 亿 / x) and a short preceding label token.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// BarChart — labeled percentage pairs become horizontal bars.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Leaderboard — ranked entries from numbered list lines.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
function dedup<T>(xs: T[]): T[] {
  const seen: Record<string, true> = {};
  const out: T[] = [];
  for (const x of xs) {
    const k = String(x);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(x);
  }
  return out;
}

function truncate(s: string, max: number): string {
  // Collapse whitespace first. Narrations reach the builders as YAML block
  // scalars, so a raw newline otherwise gets sliced into the middle of a card
  // title and renders as a literal "\n" on screen.
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

/**
 * v0.12: the structured builders (FlowChart, Terminal, Timeline, Callout,
 * QuoteBlock, StatGrid, BarChart, Leaderboard, Checklist, BigIdea,
 * PyramidDiagram, VennDiagram, CycleDiagram, MapInsert) are removed —
 * see packages/draft/src/visual-classifier.ts for the measurement.
 * The image path is the default for every scene; the title card and
 * canvas DoodleScene remain available for intentional use.
 */
export const VISUAL_BUILDERS: Record<string, VisualPropsBuilder> = {
  Title: buildTitle,
  DoodleScene: buildDoodleScene,
  ImageBackground: buildImageBackground,
};
