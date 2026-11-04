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

const buildTitle: VisualPropsBuilder = (scene, _input) => {
  const props: Record<string, unknown> = {
    text: scene.caption,
  };
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
// FlowChart — process / network / pipeline diagrams.
// ---------------------------------------------------------------------------
const buildFlowChart: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const nodes = extractNodes(scene, input);
  const direction =
    /纵向|->.*-?>|top[- ]?down|垂直/.test(scene.visual ?? "") ||
    /纵向|->.*-?>|top[- ]?down|垂直/.test(input.section?.body ?? "")
      ? "top-down"
      : "left-to-right";
  return {
    text: scene.caption,
    visual: scene.visual,
    nodes,
    direction,
  };
};

/** Pull node names from caption + first sentence of narration + the
 *  section body. Splits on the most common list separators used by the
 *  LLM (commas, full-stops, Chinese enumeration punctuation). */
function extractNodes(scene: ArticleScene, input: BuildInput): string[] {
  const language = input.language;
  const caption = scene.caption ?? "";
  const narration = (scene.narration ?? "").trim();
  const sectionBody = input.section?.body ?? "";

  // 1) Numbered / bulleted list inside the section body (most reliable).
  const listItems: string[] = [];
  for (const line of sectionBody.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.、)）\.])\s*(.{4,})$/);
    if (m && m[1]) listItems.push(m[1].trim());
  }
  if (listItems.length >= 2) {
    return dedup(listItems).slice(0, 8);
  }

  // 2) Sequence markers in the narration: "步骤 1 ... 步骤 2 ..."
  const seqHits = narration.match(/(?:步骤|阶段|step|stage|phase)\s*\d+/gi);
  if (seqHits && seqHits.length >= 2) {
    // Pair each marker with a following 2-10 word phrase.
    const out: string[] = [];
    const re =
      /(步骤|阶段|step|stage|phase)\s*\d+\s*[:：\-—、]\s*([^\n。.!?！？]{2,30})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(narration)) !== null && out.length < 8) {
      const label = `${m[1]!.toLowerCase()} ${out.length + 1}: ${m[2]!.trim()}`;
      out.push(label);
    }
    if (out.length >= 2) return out;
  }

  // 3) Split the caption on list separators.
  const capParts = caption
    .split(/[、，,；;]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (capParts.length >= 2) return dedup(capParts).slice(0, 8);

  // 4) Fallback: 3 generic step nodes from the caption.
  if (caption.length > 0) {
    return [
      caption,
      loc(language, "中间处理", "Processing"),
      loc(language, "结果", "Result"),
    ];
  }
  // 5) Last resort — empty caption: synthesise placeholder nodes from
  // the section heading so the FlowChart isn't empty.
  if (input.section?.heading) {
    return [
      input.section.heading,
      loc(language, "细节展开", "Detail"),
      loc(language, "结果", "Result"),
    ];
  }
  return [
    loc(language, "开始", "Start"),
    loc(language, "过程", "In progress"),
    loc(language, "结果", "Result"),
  ];
}

// ---------------------------------------------------------------------------
// Terminal — code / command listings.
// ---------------------------------------------------------------------------
const buildTerminal: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const lines = extractTerminalLines(scene, input);
  const title =
    (scene.caption ?? "").trim().slice(0, 30) ||
    input.section?.heading ||
    undefined;
  return {
    text: scene.caption,
    visual: scene.visual,
    lines,
    ...(title ? { title } : {}),
    prompt: "$",
  };
};

/** Build a short code-like listing. We don't try to be a real syntax
 *  highlighter; the renderer just typewriter-renders the strings. */
function extractTerminalLines(
  scene: ArticleScene,
  input: BuildInput,
): string[] {
  const narration = (scene.narration ?? "").trim();
  const sectionBody = input.section?.body ?? "";
  const out: string[] = [];

  // 1) Code fences inside the section body.
  const fenced = sectionBody.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    out.push(
      ...fenced[1]
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0)
        .slice(0, 10),
    );
  }

  // 2) Bullet items that look like commands (start with $, #, >, or
  // contain an "=" assignment).
  if (out.length === 0) {
    for (const line of sectionBody.split("\n")) {
      const m = line.match(/^\s*(?:[-*•]\s*)?(.+)$/);
      if (!m || !m[1]) continue;
      const t = m[1].trim();
      if (/^[$#>]/.test(t) || /^[a-zA-Z_][\w.]*\s*=/.test(t)) {
        out.push(t);
        if (out.length >= 8) break;
      }
    }
  }

  // 3) Fallback: split into short narration lines that read well
  // typewriter-style.
  if (out.length === 0 && narration.length > 0) {
    out.push(
      ...narration
        .split(/[。.!?！？\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 4 && s.length <= 80)
        .slice(0, 6),
    );
  }

  if (out.length === 0) out.push("// code sample");
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Callout — info / warning / success / data / formula / quote cards.
// ---------------------------------------------------------------------------
type CalloutKind = "info" | "warning" | "success";
const buildCallout: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const kind = deriveCalloutKind(scene);
  const narration = (scene.narration ?? "").trim();
  const firstSentence = narration.split(/[。.!?！？\n]/)[0]?.trim() ?? "";
  // Callout reads `text` for the body — use the first sentence of the
  // narration (real substance) and fall back to the caption.
  const text = firstSentence || (scene.caption ?? "");
  return {
    kind,
    title: scene.caption || text,
    text,
  };
};

function deriveCalloutKind(scene: ArticleScene): CalloutKind {
  const blob = `${scene.visual ?? ""} ${scene.caption ?? ""}`.toLowerCase();
  if (/(警告|小心|注意|warning|error|错误|失败|坑|陷阱)/i.test(blob))
    return "warning";
  if (/(成功|完成|恭喜|胜利|win|success|达成)/i.test(blob)) return "success";
  return "info";
}

// ---------------------------------------------------------------------------
// Timeline — events laid out left-to-right.
// ---------------------------------------------------------------------------
const buildTimeline: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const events = extractTimelineEvents(scene, input);
  return {
    text: scene.caption,
    visual: scene.visual,
    events,
  };
};

/** Pull year/era tokens (2020, 2020s, 二十世纪, ...年, 第N阶段) and
 *  pair each with a short description from the surrounding sentence. */
function extractTimelineEvents(
  scene: ArticleScene,
  input: BuildInput,
): { label: string; description?: string }[] {
  const language = input.language;
  const blob = `${scene.caption ?? ""}\n${scene.narration ?? ""}\n${input.section?.body ?? ""}`;
  const events: { label: string; description?: string }[] = [];

  // 1) Numeric years (1990..2099).
  const yearRe = /\b(19|20)\d{2}(?:s)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(blob)) !== null && events.length < 8) {
    const label = m[0];
    const desc = blob
      .slice(m.index + label.length, m.index + label.length + 60)
      .split(/[。.!?！？\n]/)[0]
      ?.trim();
    events.push({
      label,
      ...(desc && desc.length > 0 ? { description: truncate(desc, 60) } : {}),
    });
  }

  // 2) Chinese era markers (第N阶段, 第N步, 步骤N, 阶段N).
  if (events.length === 0) {
    const cnRe = /(第\s*\d+\s*(阶段|步|章|部分)|步骤\s*\d+|阶段\s*\d+)/g;
    while ((m = cnRe.exec(blob)) !== null && events.length < 8) {
      events.push({ label: m[0] });
    }
  }

  // 3) Fallback: 4-step generic timeline.
  if (events.length === 0) {
    return [
      { label: loc(language, "开始", "Start") },
      { label: loc(language, "发展", "Growth") },
      { label: loc(language, "转折", "Turn") },
      { label: loc(language, "现在", "Now") },
    ];
  }
  return events;
}

// ---------------------------------------------------------------------------
// AnimatedIllustration — generic animated shapes. Preserves the previous
// behaviour: caption + visual line for keyword-based shape picking.
// ---------------------------------------------------------------------------
const buildIllustration: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  return {
    text: scene.caption,
    visual: scene.visual,
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
const buildQuoteBlock: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const narration = (scene.narration ?? "").trim();
  const firstSentence = narration.split(/[。.!?！？\n]/)[0]?.trim() ?? "";
  const quote = firstSentence || (scene.caption ?? "") || "……";
  const blob = `${scene.visual ?? ""}\n${narration}\n${input.section?.body ?? ""}`;
  // Attribution follows a dash run: "——杨绛" / "— Einstein, 1950".
  const m = blob.match(/[—–]{1,2}\s*([^\n。.,，;；]{2,24})/);
  const author = m?.[1]?.trim();
  return { quote, ...(author ? { author } : {}) };
};

// ---------------------------------------------------------------------------
// StatGrid — 2-4 big numbers with labels. Numbers are pulled with their
// unit (% / 倍 / 亿 / x) and a short preceding label token.
// ---------------------------------------------------------------------------
const buildStatGrid: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const blob = `${scene.narration ?? ""}\n${input.section?.body ?? ""}\n${scene.caption ?? ""}`;
  const stats: { value: string; label: string }[] = [];
  const re =
    /([\u4e00-\u9fa5A-Za-z]{2,8})?[：:]?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|％|倍|x|×|万亿|亿|万|k|K)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null && stats.length < 4) {
    const value = `${m[2]}${m[3]}`;
    const label = (m[1] ?? "").trim();
    if (stats.some((s) => s.value === value)) continue;
    stats.push({ value, label });
  }
  if (stats.length === 0) {
    return {
      stats: [
        {
          value: "100%",
          label:
            scene.caption ||
            input.section?.heading ||
            loc(language, "关键数据", "Key metric"),
        },
      ],
    };
  }
  return { stats };
};

// ---------------------------------------------------------------------------
// BarChart — labeled percentage pairs become horizontal bars.
// ---------------------------------------------------------------------------
const buildBarChart: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const blob = `${scene.caption ?? ""}\n${scene.narration ?? ""}\n${input.section?.body ?? ""}`;
  const bars: { label: string; value: number; display: string }[] = [];
  const re =
    /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9 ]{0,10})[：:=为是]?\s*(\d[\d,]*(?:\.\d+)?)\s*[%％]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null && bars.length < 6) {
    const label = (m[1] ?? "").trim() || `项 ${bars.length + 1}`;
    const value = parseFloat((m[2] ?? "0").replace(/,/g, "")) || 0;
    if (bars.some((b) => b.label === label)) continue;
    bars.push({ label, value, display: `${m[2]}%` });
  }
  if (bars.length < 2) {
    // Illustrative placeholder bars from the caption — labels real,
    // values a fixed descending ramp so the shape reads as a chart.
    const parts = (scene.caption ?? "")
      .split(/[、，,；;:：\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 4);
    const ramp = [90, 70, 50, 30];
    const labels =
      parts.length >= 2
        ? parts
        : [
            loc(language, "高", "High"),
            loc(language, "中", "Mid"),
            loc(language, "低", "Low"),
          ];
    return {
      bars: labels.map((label, i) => ({
        label,
        value: ramp[i % ramp.length]!,
        display: `${ramp[i % ramp.length]}%`,
      })),
    };
  }
  return { bars };
};

// ---------------------------------------------------------------------------
// Leaderboard — ranked entries from numbered list lines.
// ---------------------------------------------------------------------------
const buildLeaderboard: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const blob = `${input.section?.body ?? ""}\n${scene.narration ?? ""}`;
  const entries: { name: string; score?: string }[] = [];
  const lineRe =
    /^\s*(?:[-*•]\s*)?(?:第\s*([一二三四五六七八九十\d]{1,3})\s*名|(\d{1,2})\s*[.、)）])\s*(.{2,30})$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(blob)) !== null && entries.length < 6) {
    const name = (m[3] ?? "").trim();
    if (name.length === 0) continue;
    entries.push({ name });
  }
  if (entries.length < 2) {
    const medal = [
      loc(language, "冠军", "1st"),
      loc(language, "亚军", "2nd"),
      loc(language, "季军", "3rd"),
    ];
    return {
      entries: medal.slice(0, 3).map((name) => ({ name })),
    };
  }
  return { entries };
};

// ---------------------------------------------------------------------------
// Checklist — bullets become check rows.
// ---------------------------------------------------------------------------
const buildChecklist: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const sectionBody = input.section?.body ?? "";
  const items: { text: string }[] = [];
  for (const line of sectionBody.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.、)）])\s*(.{2,40})$/);
    if (m && m[1]) {
      items.push({ text: m[1].trim() });
      if (items.length >= 6) break;
    }
  }
  if (items.length < 2) {
    const narration = (scene.narration ?? "").trim();
    const sentences = narration
      .split(/[。.!?！？\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
    for (const s of sentences) {
      items.push({ text: s });
      if (items.length >= 4) break;
    }
  }
  if (items.length === 0) {
    return {
      items: [{ text: scene.caption || loc(language, "确认要点", "Confirm") }],
    };
  }
  return { items };
};

// ---------------------------------------------------------------------------
// BigIdea — full-screen statement; kicker picks the scene's language.
// ---------------------------------------------------------------------------
const buildBigIdea: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const caption = (scene.caption ?? "").trim();
  const narration = (scene.narration ?? "").trim();
  const text =
    caption.length >= 6
      ? caption
      : narration.split(/[。.!?！？\n]/)[0]?.trim() ||
        caption ||
        loc(language, "核心观点", "KEY IDEA");
  const zh = /[\u4e00-\u9fa5]/.test(`${caption}${narration}`);
  return {
    text,
    kicker: zh ? loc(language, "核心观点", "KEY IDEA") : "KEY IDEA",
  };
};

// ---------------------------------------------------------------------------
// PyramidDiagram — bullet list becomes levels, top-first.
// ---------------------------------------------------------------------------
const buildPyramidDiagram: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const nodes = extractNodes(scene, input).slice(0, 5);
  if (nodes.length >= 2) {
    return {
      levels: nodes.map((t) => t.replace(/[.。;；,，、]+$/, "").slice(0, 16)),
    };
  }
  return {
    levels: [
      loc(language, "顶层结论", "Top line"),
      loc(language, "方法路径", "Method"),
      loc(language, "基础事实", "Grounds"),
    ],
  };
};

// ---------------------------------------------------------------------------
// VennDiagram — 2-3 set names from conjunction-split caption.
// ---------------------------------------------------------------------------
const buildVennDiagram: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const cap = (scene.caption ?? "").trim();
  const parts = cap
    .split(/[、，,；;与和及]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12);
  const unique = dedup(parts).slice(0, 3);
  if (unique.length >= 2) return { sets: unique };
  const narration = (scene.narration ?? "").trim();
  const nParts = dedup(
    narration
      .split(/[、，,；;与和及]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 12),
  ).slice(0, 3);
  if (nParts.length >= 2) return { sets: nParts };
  return {
    sets: [
      loc(language, "概念A", "Concept A"),
      loc(language, "概念B", "Concept B"),
    ],
  };
};

// ---------------------------------------------------------------------------
// CycleDiagram — loop stages reuse the FlowChart node extractor.
// ---------------------------------------------------------------------------
const buildCycleDiagram: VisualPropsBuilder = (scene, input) => {
  const language = input.language;
  const nodes = extractNodes(scene, input).slice(0, 6);
  const stages =
    nodes.length >= 3
      ? nodes.map((t) => t.replace(/[.。;；,，、]+$/, "").slice(0, 8))
      : [
          loc(language, "计划", "Plan"),
          loc(language, "执行", "Execute"),
          loc(language, "检查", "Check"),
          loc(language, "改进", "Improve"),
        ].slice(0, Math.max(3, nodes.length));
  return { stages, title: (scene.caption ?? "").slice(0, 12) || undefined };
};

// MapInsert — the geometry comes from the ARTICLE, never from the
// narration. CS-14's risk table names it: "生成式地图地理关系不可靠 →
// 战役路线误导观众", and the mitigation is "使用可审核的矢量路径/标记
// 数据；先核来源再进入渲染". A builder that derived rivers and march
// routes from the narration would reintroduce exactly the failure the
// plan mitigates — the picture would look authoritative and be invented.
// A scene with no authored map therefore renders an empty sheet, which
// is the honest state: the map needs reviewed coordinates first.
const buildMapInsert: VisualPropsBuilder = (scene) => {
  const map = scene.map;
  if (map === undefined) return {};
  return {
    ...(map.landforms !== undefined ? { landforms: map.landforms } : {}),
    ...(map.routes !== undefined ? { routes: map.routes } : {}),
    ...(map.markers !== undefined ? { markers: map.markers } : {}),
  };
};

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------
export const VISUAL_BUILDERS: Record<string, VisualPropsBuilder> = {
  Title: buildTitle,
  FlowChart: buildFlowChart,
  Terminal: buildTerminal,
  Callout: buildCallout,
  Timeline: buildTimeline,
  DoodleScene: buildDoodleScene,
  AnimatedIllustration: buildIllustration,
  QuoteBlock: buildQuoteBlock,
  StatGrid: buildStatGrid,
  BarChart: buildBarChart,
  Leaderboard: buildLeaderboard,
  Checklist: buildChecklist,
  BigIdea: buildBigIdea,
  PyramidDiagram: buildPyramidDiagram,
  VennDiagram: buildVennDiagram,
  CycleDiagram: buildCycleDiagram,
  MapInsert: buildMapInsert,
};

// ---------------------------------------------------------------------------
// helpers
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
