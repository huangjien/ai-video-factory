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
