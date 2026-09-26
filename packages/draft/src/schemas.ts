import { z } from "zod";
import { parse as parseYaml } from "yaml";

/**
 * Draft output schema — markdown-first by design. The LLM produces the
 * article.md verbatim; we only validate that the structural pieces parse
 * (frontmatter + Scenes YAML block). Heavy shape validation belongs in
 * `vf make`, where it matters; here, the LLM is creative with markdown
 * and the human editor refines it.
 */

export const ArticleFrontmatterSchema = z
  .object({
    project: z.string().min(1),
    language: z.enum(["zh-CN", "en-US"]),
    duration_target_sec: z.number().int().positive(),
    voice: z.string().min(1),
  })
  .passthrough();
export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatterSchema>;

export const SceneBlockSchema = z
  .object({
    scenes: z
      .array(
        z.object({
          id: z.string().min(1),
          duration: z.number().int().positive(),
          caption: z.string().min(1),
          visual: z.string().min(1),
          narration: z.string().min(1),
        }).passthrough(),
      )
      .min(1),
  })
  .passthrough();
export type SceneBlock = z.infer<typeof SceneBlockSchema>;
export type Scene = SceneBlock["scenes"][number];

export interface ParsedArticle {
  frontmatter: ArticleFrontmatter;
  proseBody: string;
  scenes: SceneBlock["scenes"];
  /** Original markdown, preserved verbatim for round-trip editing. */
  markdown: string;
}

/** Convert a parsed article into the renderer's VDSL storyboard YAML.
 * Keeps `vf make`'s video length in sync with `article.md` scenes —
 * without this, the default `storyboard.yaml` from `vf new` (1 scene)
 * would render only 8s of video while `vf make` synthesizes all N scenes.
 * First scene → `Title`; rest → `Paragraph`. The article's prose-y
 * `visual` field maps to `Title.subtext` for the opening scene only. */
export function articleToStoryboardYaml(article: ParsedArticle): string {
  const f = article.frontmatter;
  const lines: string[] = [
    `schema_version: "0.1"`,
    ``,
    `project:`,
    `  id: ${f.project}`,
    `  language: ${f.language}`,
    `  fps: 30`,
    `  width: 1920`,
    `  height: 1080`,
    ``,
    `style:`,
    `  theme: dark-tech`,
    ``,
    `scenes:`,
  ];
  article.scenes.forEach((s, i) => {
    const id = `scene-${String(i + 1).padStart(2, "0")}`;
    const isFirst = i === 0;
    const component = isFirst ? "Title" : "AnimatedIllustration";
    const props = isFirst
      ? s.visual && s.visual.length > 0
        ? `    visual:\n      component: ${component}\n      props:\n        text: ${yamlStr(s.caption ?? "")}\n        subtext: ${yamlStr(truncateForSubtext(s.visual))}`
        : `    visual:\n      component: ${component}\n      props:\n        text: ${yamlStr(s.caption ?? "")}`
      : `    visual:\n      component: ${component}\n      props:\n        text: ${yamlStr(s.caption ?? "")}\n        visual: ${yamlStr(s.visual ?? "")}`;
    lines.push(`  - id: ${id}`);
    lines.push(`    duration: ${s.duration ?? 0}`);
    lines.push(`    narration:`);
    lines.push(`      text: ${yamlStr(s.narration ?? "")}`);
    lines.push(props);
  });
  return lines.join("\n") + "\n";
}

function yamlStr(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Title.subtext is rendered as one <p> at 36px on the title card — long
 *  descriptions overflow and become unreadable. Trim to one short clause. */
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

/** Parse the article.md shape: frontmatter (YAML), prose body, and a
 * `## Scenes` section containing a fenced YAML block. Tolerates extra
 * structure (sections, hooks, etc.) — keeps them in `proseBody`. */
export function parseArticle(md: string): ParsedArticle {
  const { frontmatter, body } = splitFrontmatter(md);
  const fm = ArticleFrontmatterSchema.parse(frontmatter);
  const { proseBody, scenesYaml } = splitScenesBlock(body);
  const parsedScenes = parseYaml(scenesYaml) as unknown;
  const sb = SceneBlockSchema.parse(parsedScenes);
  return {
    frontmatter: fm,
    proseBody,
    scenes: sb.scenes,
    markdown: md,
  };
}

export function parseArticleLenient(md: string): ParsedArticle {
  const { frontmatter, body } = splitFrontmatter(md);
  const fm = ArticleFrontmatterSchema.parse(frontmatter);
  const { proseBody, scenesYaml } = splitScenesBlock(body);
  const parsedScenes = parseYaml(scenesYaml) as unknown;
  const sb = SceneBlockLenientSchema.parse(parsedScenes);
  return {
    frontmatter: fm,
    proseBody,
    scenes: sb.scenes,
    markdown: md,
  };
}

export interface ArticleWithRecovery {
  article: ParsedArticle;
  recoveredCount: number;
}

/** Strict parse first; on the empty-narration failure mode, fall back to
 *  lenient + section-body recovery. All article.md consumers (make,
 *  audio-plan, draft storyboard-sync, youtube) should go through this so
 *  a malformed LLM draft degrades uniformly instead of crashing one verb
 *  but not another. Other parse errors still throw. */
export function parseArticleWithRecovery(md: string): ArticleWithRecovery {
  try {
    return { article: parseArticle(md), recoveredCount: 0 };
  } catch (err) {
    if (!isEmptyNarrationZodError(err)) throw err;
    const loose = parseArticleLenient(md);
    const { article, recoveredCount } = recoverEmptyNarrations(loose);
    if (recoveredCount === 0) throw err;
    return { article, recoveredCount };
  }
}

function isEmptyNarrationZodError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("too_small") &&
    msg.includes("scenes") &&
    msg.includes("narration")
  );
}

export function recoverEmptyNarrations(article: ParsedArticle): {
  article: ParsedArticle;
  recoveredCount: number;
} {
  const sections = parseProseSections(article.proseBody);
  if (sections.length === 0) {
    return { article, recoveredCount: 0 };
  }
  const perSection = Math.max(
    1,
    Math.ceil(article.scenes.length / sections.length),
  );
  const scenes = article.scenes.map((s) => ({ ...s }));
  let recoveredCount = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    if (scene.narration && scene.narration.trim().length > 0) continue;
    const sectionIdx = Math.min(
      Math.floor(i / perSection),
      sections.length - 1,
    );
    const section = sections[sectionIdx]!;
    const slice = sliceSectionForScene(section.body, i % perSection, perSection);
    if (slice.length > 0) {
      scene.narration = slice;
      recoveredCount++;
    }
  }

  return {
    article: { ...article, scenes },
    recoveredCount,
  };
}

interface ProseSection {
  heading: string;
  body: string;
}

function parseProseSections(proseBody: string): ProseSection[] {
  const sections: ProseSection[] = [];
  const lines = proseBody.split("\n");
  let current: ProseSection | null = null;
  for (const line of lines) {
    const isNumberedSection = /^##\s+\d+\.\s+/.test(line);
    if (isNumberedSection) {
      if (current) sections.push(current);
      current = {
        heading: line.replace(/^##\s+/, "").trim(),
        body: "",
      };
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.trim() }))
    .filter((s) => s.heading.length > 0);
}

function sliceSectionForScene(
  body: string,
  slot: number,
  totalSlots: number,
): string {
  if (body.length === 0) return "";
  const sentenceEnds: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "。" || ch === "！" || ch === "？" || ch === "." || ch === "!" || ch === "?") {
      sentenceEnds.push(i);
    }
  }
  if (sentenceEnds.length >= totalSlots) {
    const perSlot = sentenceEnds.length / totalSlots;
    const startIdx = Math.floor(slot * perSlot);
    const endIdx = Math.min(
      sentenceEnds.length - 1,
      Math.floor((slot + 1) * perSlot) - 1,
    );
    const start = startIdx === 0 ? 0 : sentenceEnds[startIdx - 1]! + 1;
    const end = sentenceEnds[endIdx]! + 1;
    return body.slice(start, end).trim();
  }
  const idealStart = Math.floor((slot * body.length) / totalSlots);
  const idealEnd = Math.floor(((slot + 1) * body.length) / totalSlots);
  return body.slice(idealStart, idealEnd).trim();
}

const SceneBlockLenientSchema = z
  .object({
    scenes: z
      .array(
        z.object({
          id: z.string().min(1),
          duration: z.number().int().positive(),
          caption: z.string(),
          visual: z.string(),
          narration: z.string(),
        }).passthrough(),
      )
      .min(1),
  })
  .passthrough();

function splitFrontmatter(md: string): {
  frontmatter: unknown;
  body: string;
} {
  const re = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = md.match(re);
  if (!m) {
    throw new Error("article.md is missing YAML frontmatter (--- ... --- at top)");
  }
  const fmRaw = m[1] ?? "";
  const body = md.slice(m[0].length);
  let fm: unknown;
  try {
    fm = parseYaml(fmRaw);
  } catch (err) {
    throw new Error(`frontmatter YAML parse failed: ${(err as Error).message}`);
  }
  return { frontmatter: fm, body };
}

function splitScenesBlock(body: string): {
  proseBody: string;
  scenesYaml: string;
} {
  const headingRe = /^#{1,6}\s*Scenes[^\n]*$/im;
  const headingMatch = body.match(headingRe);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error("article.md has no `## Scenes` heading");
  }
  const proseBody = body.slice(0, headingMatch.index);
  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length);
  const fenceRe = /```(?:yaml)?\s*\n([\s\S]*?)\n```/;
  const fenceMatch = afterHeading.match(fenceRe);
  if (!fenceMatch || fenceMatch[1] === undefined) {
    throw new Error("`## Scenes` heading is not followed by a YAML code block");
  }
  return { proseBody, scenesYaml: fenceMatch[1] };
}
