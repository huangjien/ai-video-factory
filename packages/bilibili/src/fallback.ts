import {
  BILIBILI_DESCRIPTION_MAX,
  BILIBILI_TAG_MAX,
  BILIBILI_TAGS_MAX,
  BILIBILI_TITLE_MAX,
  type BilibiliPackage,
} from "./schemas.js";

/** Truncate on CHARACTER boundaries. `String.slice` splits surrogate pairs,
 * which turns one emoji into two lone halves at the cut — visible as tofu in
 * the Bilibili form. */
export function clampChars(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max).join("").trimEnd();
}

/** Vocabulary → the 标签 a Bilibili viewer actually browses. Ordered so the
 * more specific tags win the limited slots. */
const TAG_VOCABULARY: ReadonlyArray<readonly [string, string]> = [
  ["大模型", "大模型"],
  ["人工智能", "人工智能"],
  ["agent", "AI Agent"],
  ["Agent", "AI Agent"],
  ["LLM", "大模型"],
  ["prompt", "Prompt工程"],
  ["编程", "编程"],
  ["代码", "编程"],
  ["开发", "软件开发"],
  ["工程师", "工程师"],
  ["架构", "系统架构"],
  ["开源", "开源"],
  ["效率", "效率工具"],
  ["工具", "效率工具"],
  ["职场", "职场"],
  ["求职", "职场"],
  ["科普", "科普"],
  ["教程", "教程"],
  ["思维", "思维方式"],
  ["学习", "学习方法"],
];

/** 分类 hint from the same vocabulary. Deliberately conservative — an
 * unmatched article returns null and the checklist asks the uploader to
 * pick, which is always correct. A wrong guess is not. */
const CATEGORY_BY_TAG: ReadonlyArray<readonly [string, string]> = [
  ["AI Agent", "科技"],
  ["大模型", "科技"],
  ["人工智能", "科技"],
  ["Prompt工程", "科技"],
  ["编程", "计算机技术"],
  ["软件开发", "计算机技术"],
  ["系统架构", "计算机技术"],
  ["科普", "科学科普"],
  ["职场", "职场就业"],
];

export interface FallbackInput {
  /** Full `article.md` contents. */
  article: string;
  /** The video's `image_style`, when the article declares one. */
  imageStyle?: string | undefined;
  /** An existing YouTube package's `thumbnail_prompt`. Reused verbatim so the
   * Bilibili cover and the YouTube thumbnail show the same video — the two
   * platforms are often the same audience. */
  youtubeCoverPrompt?: string | undefined;
}

/** The `> **Hook**` block, minus its markdown scaffolding. */
function extractHook(article: string): string {
  const m = article.match(/^>\s*\*\*Hook\*\*[^\n]*\n+>\s*(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

/** Prose paragraphs only: drops frontmatter, the H1, headings, and the
 * trailing `## Scenes` YAML block. */
function extractProse(article: string): string[] {
  const body = article.split(/^##\s+Scenes/m)[0] ?? article;
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (p.length < 20) return false;
      if (p.startsWith("---")) return false;
      if (p.startsWith("#")) return false;
      if (p.startsWith(">")) return false;
      if (p.startsWith("```")) return false;
      return true;
    });
}

/** Pick tags by vocabulary hit over title + hook + opening prose, so the tags
 * describe what the video is actually about rather than the folder name. */
export function deriveTags(source: string): string[] {
  const lower = source.toLowerCase();
  const found: string[] = [];
  for (const [needle, tag] of TAG_VOCABULARY) {
    if (lower.includes(needle.toLowerCase())) {
      const safe = clampChars(tag, BILIBILI_TAG_MAX);
      if (!found.includes(safe)) found.push(safe);
    }
  }
  return found.slice(0, BILIBILI_TAGS_MAX);
}

export function deriveCategory(tags: string[]): string | null {
  for (const [tag, category] of CATEGORY_BY_TAG) {
    if (tags.includes(tag)) return category;
  }
  return null;
}

/**
 * Build a valid package with no LLM call at all.
 *
 * This is the floor, not the ceiling: it exists so a provider outage, a
 * content filter, or malformed YAML degrades the command to "usable but
 * plain" instead of failing it. Everything here is derived from the article,
 * so it cannot hallucinate.
 */
export function buildFallbackPackage(input: FallbackInput): BilibiliPackage {
  const h1 = input.article.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const hook = extractHook(input.article);
  const prose = extractProse(input.article);
  const topic = h1.length > 0 ? h1 : clampChars(input.article.trim(), 40);

  const descriptionParts: string[] = [];
  if (hook.length > 0) descriptionParts.push(hook);
  descriptionParts.push(prose.slice(0, 2).join("\n\n"));

  const description = clampChars(
    descriptionParts.join("\n\n").trim(),
    BILIBILI_DESCRIPTION_MAX,
  );

  const tags = deriveTags(`${topic}\n${hook}\n${prose.slice(0, 3).join(" ")}`);

  const cover_prompt =
    input.youtubeCoverPrompt?.trim() ||
    [
      `Cover image for a video about ${topic}`,
      input.imageStyle ? `Style preset: ${input.imageStyle}` : "",
      "A single vivid scene photographed in that style, subject clear and expressive.",
      "Leave one third of the frame quiet and unlit for the title, which is typeset afterwards.",
    ]
      .filter((s) => s.length > 0)
      .join(" · ");

  return {
    title: clampChars(topic, BILIBILI_TITLE_MAX) || "untitled",
    description: description || topic,
    tags,
    suggested_category: deriveCategory(tags),
    cover_prompt,
  };
}
