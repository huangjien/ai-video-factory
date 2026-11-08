import { stringify as stringifyYaml } from "yaml";
import type { RawArticle } from "./agent.js";
import {
  findScenesHeading,
  findYamlFence,
  splitFrontmatterParts,
} from "./article-md.js";

/**
 * Surgical markdown patcher.
 *
 * The reviser returns a structured article; the film lives in a markdown
 * file a human also edits. Re-rendering the whole file would drop
 * everything the renderer does not model — the `characters:` block, the
 * `hold_after_sec` / `lead_in_sec` timing, the `map:` geometry, hand-
 * written prose between sections, frontmatter keys nobody declared.
 *
 * So the revision is applied to the TEXT: only the passages the reviser
 * changed are replaced; every other byte of article.md survives. The
 * one exception is the scenes block, which is YAML — it is re-serialized
 * (same data, possibly different indentation) because patching YAML by
 * hand is guesswork.
 */

export interface ArticlePatchResult {
  markdown: string;
  /** Labels of the passages that changed, e.g. `section 2`, `scene 3`. */
  changed: string[];
}

interface MarkdownParts {
  /** The frontmatter block, verbatim, including its trailing newlines. */
  frontmatter: string;
  /** Everything between the frontmatter and the `## Scenes` heading. */
  prose: string;
  scenesHeading: string;
  /** Whatever sat between the heading and the code fence. */
  between: string;
  /** The fenced YAML content. */
  scenesYaml: string;
  /** Whatever followed the code fence. */
  tail: string;
}

/** Split article.md into the parts the patcher replaces independently.
 *  The format primitives live in article-md.ts (single owner). */
export function splitArticleMarkdown(md: string): MarkdownParts {
  const fm = splitFrontmatterParts(md) ?? {
    block: "",
    frontmatterRaw: "",
    body: md,
  };
  const heading = findScenesHeading(fm.body);
  if (!heading) {
    throw new Error("article.md has no `## Scenes` heading");
  }
  const fence = findYamlFence(heading.afterHeading);
  if (!fence) {
    throw new Error("`## Scenes` heading is not followed by a YAML code block");
  }
  return {
    frontmatter: fm.block,
    prose: heading.proseBody,
    scenesHeading: heading.heading,
    between: fence.before,
    scenesYaml: fence.yaml,
    tail: fence.after,
  };
}

/** The heading text without the "N. " the markdown carries in front of it.
 *  `parseProseSections` keeps the number ("1. 第一节"), the renderer adds
 *  its own ("## 1. 第一节") — keeping both would double it. */
function stripSectionNumber(heading: string): string {
  return heading.replace(/^\d+\.\s*/, "");
}

/** Replace the H1 title when the reviser changed it. */
function patchTitle(
  prose: string,
  base: RawArticle,
  fixed: RawArticle,
  changed: string[],
): string {
  if (base.title === undefined || fixed.title === undefined) return prose;
  if (base.title === fixed.title) return prose;
  const m = prose.match(/^#\s+(.+)$/m);
  if (!m || m.index === undefined) return prose;
  changed.push("title");
  return `${prose.slice(0, m.index)}# ${fixed.title}${prose.slice(m.index + m[0].length)}`;
}

/** Replace the hook line when the reviser changed it. */
function patchHook(
  prose: string,
  base: RawArticle,
  fixed: RawArticle,
  changed: string[],
): string {
  if (base.hook === undefined || fixed.hook === undefined) return prose;
  if (base.hook === fixed.hook) return prose;
  const re = /^(>\s*\*\*Hook\*\*[^\n]*?[:：])([ \t]*)(.*)$/m;
  const m = prose.match(re);
  if (!m || m.index === undefined) return prose;
  changed.push("hook");
  const line = `${m[1]}${m[2]}${fixed.hook}`;
  return `${prose.slice(0, m.index)}${line}${prose.slice(m.index + m[0].length)}`;
}

/** Replace the numbered sections the reviser changed. */
function patchSections(
  prose: string,
  base: RawArticle,
  fixed: RawArticle,
): { prose: string; changed: string[] } {
  const baseSections = base.sections ?? [];
  const fixedSections = fixed.sections ?? [];
  const changed: string[] = [];
  if (
    baseSections.length === 0 ||
    fixedSections.length !== baseSections.length
  ) {
    return { prose, changed };
  }
  const headings = [...prose.matchAll(/^##\s+\d+\.\s+.*$/gm)];
  let out = prose;
  // Patch from the last section backwards so earlier offsets stay valid.
  for (let i = baseSections.length - 1; i >= 0; i--) {
    const b = baseSections[i];
    const f = fixedSections[i];
    if (!b || !f) continue;
    const heading = stripSectionNumber(f.heading ?? b.heading ?? "");
    const body = f.body ?? b.body ?? "";
    if (
      stripSectionNumber(b.heading ?? "") === heading &&
      (b.body ?? "") === body
    ) {
      continue;
    }
    const match = headings[i];
    if (!match || match.index === undefined) continue;
    const start = match.index;
    const end = headings[i + 1]?.index ?? out.length;
    const span = out.slice(start, end);
    const trailing = span.slice(span.trimEnd().length);
    out = `${out.slice(0, start)}## ${i + 1}. ${heading}\n\n${body}${trailing}${out.slice(end)}`;
    changed.unshift(`section ${i + 1}`);
  }
  return { prose: out, changed };
}

/** Render one YAML field at a given indent — `key: value` or a block
 *  scalar, produced by the `yaml` library so quoting and escaping stay
 *  correct.
 *
 *  `forceBlock` keeps a field that WAS a block scalar a block scalar:
 *  `video draft` writes narrations that way, and turning one into an
 *  inline scalar re-flows the whole scenes block for no reason. */
function renderField(
  indent: string,
  key: string,
  value: string,
  forceBlock = false,
): string[] {
  if (forceBlock) {
    const lines = value.split("\n");
    const unsafe = lines.some(
      (l) => l !== l.trimEnd() || l.startsWith(" ") || l.startsWith("\t"),
    );
    if (!unsafe) {
      const chomp = value.endsWith("\n") ? "|" : "|-";
      const body = value.endsWith("\n") ? lines.slice(0, -1) : lines;
      return [
        `${indent}${key}: ${chomp}`,
        ...body.map((l) => `${indent}  ${l}`),
      ];
    }
  }
  const dumped = stringifyYaml({ [key]: value });
  const raw = dumped.split("\n");
  const head = raw[0] ?? `${key}:`;
  const out = [indent + head];
  for (const line of raw.slice(1)) {
    if (line.trim() === "") continue;
    // The library indents block content by 2; re-indent it under our key.
    const body = line.startsWith("  ") ? line.slice(2) : line;
    out.push(indent + "  " + body);
  }
  return out;
}

/** Replace one field's value inside a scene's YAML entry. The original
 *  style is kept: a block scalar stays a block scalar. */
function patchField(lines: string[], key: string, value: string): string[] {
  const idx = lines.findIndex((l) => new RegExp(`^(\\s+)${key}:`).test(l));
  if (idx === -1) return lines;
  const line = lines[idx]!;
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const after = line.slice(indent.length + key.length + 1);
  const wasBlock = /^[|>][-+]?\d*$/.test(after.trim());
  const rendered = renderField(indent, key, value, wasBlock);
  if (!wasBlock) {
    return [...lines.slice(0, idx), ...rendered, ...lines.slice(idx + 1)];
  }
  // A block scalar owns the lines that follow it (everything indented
  // deeper than the key) — they go with it.
  let end = idx + 1;
  while (end < lines.length && lines[end]!.startsWith(`${indent} `)) end++;
  return [...lines.slice(0, idx), ...rendered, ...lines.slice(end)];
}

/** Replace the scene fields the reviser changed; keep every other key —
 *  and the file's own YAML style. The block is patched as TEXT, not
 *  re-serialized: a round-trip through the YAML writer re-folds every
 *  long line and turns block scalars into plain ones, turning a
 *  one-line fix into a whole-file diff. */
function patchScenes(
  scenesYaml: string,
  base: RawArticle,
  fixed: RawArticle,
  changed: string[],
): string {
  const lines = scenesYaml.split("\n");
  const starts: number[] = [];
  let entryIndent: string | null = null;
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)-\s+id:/);
    if (!m) return;
    const indent = m[1] ?? "";
    // The first `- id:` sets the scene list's indent; a deeper one is a
    // NESTED list (a scene's `characters:`), not another scene.
    if (entryIndent === null) entryIndent = indent;
    if (indent !== entryIndent) return;
    starts.push(i);
  });
  const baseScenes = base.scenes ?? [];
  const fixedScenes = fixed.scenes ?? [];
  // Patch the last scene first so earlier line offsets stay valid.
  for (let i = Math.min(fixedScenes.length, starts.length) - 1; i >= 0; i--) {
    const b = baseScenes[i];
    const f = fixedScenes[i];
    if (!b || !f) continue;
    const fields = (["caption", "visual", "narration"] as const).filter(
      (key) => (b[key] ?? "").trim() !== (f[key] ?? "").trim(),
    );
    if (fields.length === 0) continue;
    const start = starts[i]!;
    const end = starts[i + 1] ?? lines.length;
    let entry = lines.slice(start, end);
    for (const key of fields) {
      entry = patchField(entry, key, f[key] ?? "");
    }
    lines.splice(start, end - start, ...entry);
    changed.push(`scene ${i + 1}`);
  }
  return lines.join("\n");
}

/**
 * Apply a surgical revision to article.md.
 *
 * `base` is the structured article the revision started from, `fixed` the
 * verified result. Only the passages that differ are written back.
 */
export function applyRevisionToMarkdown(
  baseMarkdown: string,
  base: RawArticle,
  fixed: RawArticle,
): ArticlePatchResult {
  const parts = splitArticleMarkdown(baseMarkdown);
  const changed: string[] = [];

  let prose = patchTitle(parts.prose, base, fixed, changed);
  prose = patchHook(prose, base, fixed, changed);
  const sections = patchSections(prose, base, fixed);
  prose = sections.prose;
  changed.push(...sections.changed);

  const scenesYaml = patchScenes(parts.scenesYaml, base, fixed, changed);

  const markdown = [
    parts.frontmatter,
    prose,
    parts.scenesHeading,
    parts.between,
    "```yaml\n",
    scenesYaml,
    "\n```",
    parts.tail,
  ].join("");

  return { markdown, changed };
}
