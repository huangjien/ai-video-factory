/**
 * The text-format owner for article.md — THE source-of-truth file.
 *
 * article.md is hand-edited markdown: YAML frontmatter, prose, then a
 * `## Scenes` heading with one fenced YAML block. Three consumers used to
 * re-implement this format with near-identical regexes (schemas.ts,
 * article-patch.ts, draft-command's frontmatter readers) — a format bug
 * (quoting, fence variants, CRLF) had no locality.
 *
 * Every function here is a non-throwing FORMAT primitive: it returns null
 * when the structure is absent. Error POLICY belongs to the semantic
 * layers (schemas.ts throws with its own messages; the CLI stamping
 * helpers return undefined).
 *
 * The regexes are preserved verbatim from their previous homes — format
 * behavior is pinned by the existing test corpus.
 */

/** The frontmatter block (delimiters included), its raw YAML text, and
 *  the body after it. Null when the file has no frontmatter block. */
export interface FrontmatterParts {
  /** Including the leading `---\n` and trailing `\n---\n`. */
  block: string;
  /** The YAML text between the delimiters (unparsed). */
  frontmatterRaw: string;
  body: string;
}

export function splitFrontmatterParts(md: string): FrontmatterParts | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  return {
    block: m[0],
    frontmatterRaw: m[1] ?? "",
    body: md.slice(m[0].length),
  };
}

/** True when the frontmatter already declares `key` (battle-tested
 *  indexOf form — tolerant of CRLF the same way as before). */
export function frontmatterHasKey(md: string, key: string): boolean {
  if (!md.startsWith("---")) return false;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return false;
  return new RegExp(`^${key}:.*$`, "m").test(md.slice(0, end));
}

/** The frontmatter value for `key`, or undefined. Same guard semantics
 *  as the previous draft-command helper, including the trailing quote
 *  strip (a quoted scalar loses its surrounding quotes). */
export function readFrontmatterKey(
  md: string,
  key: string,
): string | undefined {
  if (!md.startsWith("---")) return undefined;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(md.slice(0, end));
  if (m?.[1] === undefined) return undefined;
  return m[1].trim().replace(/^"'|^'|"$|'$/g, "");
}

/** The `## Scenes` heading (any level), the prose before it, and
 *  everything after it. Null when the body has no Scenes heading. */
export interface ScenesHeading {
  heading: string;
  headingIndex: number;
  proseBody: string;
  afterHeading: string;
}

const SCENES_HEADING_RE = /^#{1,6}\s*Scenes[^\n]*$/im;

export function findScenesHeading(body: string): ScenesHeading | null {
  const m = body.match(SCENES_HEADING_RE);
  if (!m || m.index === undefined) return null;
  return {
    heading: m[0],
    headingIndex: m.index,
    proseBody: body.slice(0, m.index),
    afterHeading: body.slice(m.index + m[0].length),
  };
}

/** The first fenced code block in `text`, and the text around it.
 *  Null when no fence exists. */
export interface YamlFence {
  yaml: string;
  before: string;
  after: string;
}

const FENCE_RE = /```(?:yaml)?\s*\n([\s\S]*?)\n```/;

export function findYamlFence(text: string): YamlFence | null {
  const m = text.match(FENCE_RE);
  if (!m || m.index === undefined || m[1] === undefined) return null;
  return {
    yaml: m[1],
    before: text.slice(0, m.index),
    after: text.slice(m.index + m[0].length),
  };
}
