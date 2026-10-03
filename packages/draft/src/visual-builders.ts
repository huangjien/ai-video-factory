import type { Scene as ArticleScene } from "./schemas.js";

/**
 * v0.4.1 — per-component visual prop builders.
 *
 * The storyboard mapper previously emitted only `{text, visual}` for
 * every non-Title scene, so the renderer's `FlowChart`, `Terminal`,
 * `Comparison`, `Timeline`, and `Callout` components all rendered with
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
const buildTitle: VisualPropsBuilder = (scene) => {
  const props: Record<string, unknown> = {
    text: scene.caption,
  };
  if (scene.visual && scene.visual.length > 0) {
    props.subtext = truncateForSubtext(scene.visual);
  }
  return props;
};

// ---------------------------------------------------------------------------
// FlowChart — process / network / pipeline diagrams.
// ---------------------------------------------------------------------------
const buildFlowChart: VisualPropsBuilder = (scene, input) => {
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
    const re = /(步骤|阶段|step|stage|phase)\s*\d+\s*[:：\-—、]\s*([^\n。.!?！？]{2,30})/gi;
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
    return [caption, "中间处理", "结果"];
  }
  // 5) Last resort — empty caption: synthesise placeholder nodes from
  // the section heading so the FlowChart isn't empty.
  if (input.section?.heading) {
    return [input.section.heading, "细节展开", "结果"];
  }
  return ["开始", "过程", "结果"];
}

// ---------------------------------------------------------------------------
// Terminal — code / command listings.
// ---------------------------------------------------------------------------
const buildTerminal: VisualPropsBuilder = (scene, input) => {
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
const buildCallout: VisualPropsBuilder = (scene) => {
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
// Comparison — left/right paired cards.
// ---------------------------------------------------------------------------
const buildComparison: VisualPropsBuilder = (scene, input) => {
  const sectionBody = input.section?.body ?? "";
  const narration = (scene.narration ?? "").trim();
  const blob = `${scene.caption ?? ""}\n${narration}\n${sectionBody}`;
  const split = splitLeftRight(blob);
  return {
    text: scene.caption,
    visual: scene.visual,
    left: split.left,
    right: split.right,
  };
};

/** Split the narration / section into two buckets by the most common
 *  contrast tokens (对/比/左/右/vs/versus/while/instead). Falls back to
 *  sentence halves. */
function splitLeftRight(blob: string): {
  left: { title: string; items: string[] };
  right: { title: string; items: string[] };
} {
  // 1) Look for explicit "左 ... 右" or "A ... B" pattern.
  const sepRe =
    /(?:\s*(?:vs\.?|versus|对比|相比|instead|whereas|而|但是|但)\s*)/i;
  const parts = blob.split(sepRe);
  if (parts.length >= 2) {
    const a = parts[0]?.trim() ?? "";
    const b = parts.slice(1).join(" ").trim();
    const aSentences = a
      .split(/[。.!?！？\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 60);
    const bSentences = b
      .split(/[。.!?！？\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 60);
    if (aSentences.length >= 1 && bSentences.length >= 1) {
      return {
        left: { title: truncate(a, 18), items: aSentences.slice(0, 4) },
        right: { title: truncate(b, 18), items: bSentences.slice(0, 4) },
      };
    }
  }

  // 2) Look for a section with bullet points under two headings.
  const headings = (blob.match(/^\s*#{3,4}\s*(.+)$/gm) ?? []).map((s) =>
    s.replace(/^\s*#{3,4}\s*/, "").trim(),
  );
  if (headings.length >= 2) {
    return {
      left: { title: headings[0] ?? "左", items: extractBullets(blob, 0) },
      right: { title: headings[1] ?? "右", items: extractBullets(blob, 1) },
    };
  }

  // 3) Fallback: split the caption on the colon or em-dash.
  const cap = blob.split("\n")[0] ?? "";
  const colonSplit = cap.split(/[:：—\-]/);
  if (colonSplit.length === 2) {
    return {
      left: { title: truncate(colonSplit[0] ?? "左", 18), items: [] },
      right: { title: truncate(colonSplit[1] ?? "右", 18), items: [] },
    };
  }

  // 4) Last resort — split narration into two halves.
  const sentences = blob
    .split(/[。.!?！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
  const half = Math.max(1, Math.floor(sentences.length / 2));
  return {
    left: {
      title: "左",
      items: sentences.slice(0, half).slice(0, 4),
    },
    right: {
      title: "右",
      items: sentences.slice(half).slice(0, 4),
    },
  };
}

function extractBullets(blob: string, headingIdx: number): string[] {
  // Naive — group bullets between the Nth and (N+1)th H3.
  const h3Positions: number[] = [];
  const h3Re = /^\s*#{3,4}\s*.+$/gm;
  let m: RegExpExecArray | null;
  while ((m = h3Re.exec(blob)) !== null) {
    h3Positions.push(m.index);
  }
  const start = h3Positions[headingIdx];
  const end = h3Positions[headingIdx + 1] ?? blob.length;
  if (start === undefined) return [];
  const slice = blob.slice(start, end);
  return slice
    .split("\n")
    .map((l) => l.match(/^\s*[-*•]\s*(.+)$/)?.[1]?.trim() ?? "")
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Timeline — events laid out left-to-right.
// ---------------------------------------------------------------------------
const buildTimeline: VisualPropsBuilder = (scene, input) => {
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
      { label: "开始" },
      { label: "发展" },
      { label: "转折" },
      { label: "现在" },
    ];
  }
  return events;
}

// ---------------------------------------------------------------------------
// AnimatedIllustration — generic animated shapes. Preserves the previous
// behaviour: caption + visual line for keyword-based shape picking.
// ---------------------------------------------------------------------------
const buildIllustration: VisualPropsBuilder = (scene) => {
  return {
    text: scene.caption,
    visual: scene.visual,
  };
};

// ---------------------------------------------------------------------------
// SvgScene — whiteboard draw-on diagram (v0.2 renderer family, svg). Nodes
// come from the same extractor FlowChart used; layout is a deterministic
// left-to-right chain on the 1920×1080 canvas (demo-verified coordinates).
// ---------------------------------------------------------------------------
const CANVAS_W = 1920;
const CANVAS_H = 1080;

const buildSvgScene: VisualPropsBuilder = (scene, input) => {
  const labels = extractNodes(scene, input);
  const items = (labels.length > 0 ? labels : [scene.caption || scene.visual || "主题"])
    .slice(0, 5)
    .map((t) => t.replace(/[.。;；,，、]+$/, "").slice(0, 24));
  const margin = 140;
  const usable = CANVAS_W - margin * 2;
  const step = usable / items.length;
  const w = Math.min(420, Math.max(220, Math.round(step) - 90));
  const y = Math.round(CANVAS_H / 2) - 80;
  const nodes = items.map((text, i) => ({
    id: `node-${i}`,
    kind: "rect" as const,
    x: Math.round(margin + i * step + (step - w) / 2),
    y,
    w,
    h: 160,
    text,
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: `edge-${i}`,
    from: nodes[i]!.id,
    to: n.id,
  }));
  return { title: scene.caption, nodes, edges };
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

const buildDoodleScene: VisualPropsBuilder = (scene) => {
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
      stats: [{ value: "100%", label: scene.caption || input.section?.heading || "关键数据" }],
    };
  }
  return { stats };
};

// ---------------------------------------------------------------------------
// BarChart — labeled percentage pairs become horizontal bars.
// ---------------------------------------------------------------------------
const buildBarChart: VisualPropsBuilder = (scene, input) => {
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
    const labels = parts.length >= 2 ? parts : ["高", "中", "低"];
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
    const medal = ["冠军", "亚军", "季军"];
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
    return { items: [{ text: scene.caption || "确认要点" }] };
  }
  return { items };
};

// ---------------------------------------------------------------------------
// BigIdea — full-screen statement; kicker picks the scene's language.
// ---------------------------------------------------------------------------
const buildBigIdea: VisualPropsBuilder = (scene) => {
  const caption = (scene.caption ?? "").trim();
  const narration = (scene.narration ?? "").trim();
  const text =
    caption.length >= 6
      ? caption
      : narration.split(/[。.!?！？\n]/)[0]?.trim() || caption || "核心观点";
  const zh = /[\u4e00-\u9fa5]/.test(`${caption}${narration}`);
  return { text, kicker: zh ? "核心观点" : "KEY IDEA" };
};

// ---------------------------------------------------------------------------
// PyramidDiagram — bullet list becomes levels, top-first.
// ---------------------------------------------------------------------------
const buildPyramidDiagram: VisualPropsBuilder = (scene, input) => {
  const nodes = extractNodes(scene, input).slice(0, 5);
  if (nodes.length >= 2) {
    return { levels: nodes.map((t) => t.replace(/[.。;；,，、]+$/, "").slice(0, 16)) };
  }
  return { levels: ["顶层结论", "方法路径", "基础事实"] };
};

// ---------------------------------------------------------------------------
// VennDiagram — 2-3 set names from conjunction-split caption.
// ---------------------------------------------------------------------------
const buildVennDiagram: VisualPropsBuilder = (scene) => {
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
  return { sets: ["概念A", "概念B"] };
};

// ---------------------------------------------------------------------------
// CycleDiagram — loop stages reuse the FlowChart node extractor.
// ---------------------------------------------------------------------------
const buildCycleDiagram: VisualPropsBuilder = (scene, input) => {
  const nodes = extractNodes(scene, input).slice(0, 6);
  const stages =
    nodes.length >= 3
      ? nodes.map((t) => t.replace(/[.。;；,，、]+$/, "").slice(0, 8))
      : ["计划", "执行", "检查", "改进"].slice(0, Math.max(3, nodes.length));
  return { stages, title: (scene.caption ?? "").slice(0, 12) || undefined };
};

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------
export const VISUAL_BUILDERS: Record<string, VisualPropsBuilder> = {
  Title: buildTitle,
  FlowChart: buildFlowChart,
  Terminal: buildTerminal,
  Callout: buildCallout,
  Comparison: buildComparison,
  Timeline: buildTimeline,
  SvgScene: buildSvgScene,
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
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Title.subtext is rendered as one <p> at 36px on the title card —
 *  long descriptions overflow and become unreadable. Trim to one short
 *  clause. Matches the helper in `schemas.ts` so we don't double-import
 *  from there. */
function truncateForSubtext(s: string): string {
  const MAX = 50;
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const lastPunct = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf(","),
    cut.lastIndexOf("."),
    cut.lastIndexOf(" "),
  );
  const trimmed = lastPunct > 20 ? cut.slice(0, lastPunct) : cut;
  return `${trimmed}…`;
}