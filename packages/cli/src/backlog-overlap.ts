import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Overlap preflight (design §CLI): before an idea enters the backlog,
 * its keywords are scanned against each project's article.md so a video
 * that is already covered warns instead of silently re-shipping.
 * A warning is a soft gate — `--force` overrules it everywhere.
 */

export interface OverlapHit {
  keyword: string;
  projects: string[];
}

export interface OverlapInput {
  topic: string;
  note?: string;
  anchors?: string[];
  content?: string;
}

const MAX_KEYWORDS = 40;

/** CJK runs → overlapping bigrams (capped per run); latin words ≥3 chars. */
function keywordsFromText(text: string, cap: number): string[] {
  const out: string[] = [];
  const cjkRuns = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 2 <= run.length && out.length < cap; i++) {
      out.push(run.slice(i, i + 2));
    }
  }
  if (out.length < cap) {
    const latin = (text.match(/[a-zA-Z][a-zA-Z0-9-]{2,}/g) ?? []).map((w) =>
      w.toLowerCase(),
    );
    for (const w of latin) {
      if (out.length >= cap) break;
      out.push(w);
    }
  }
  return out;
}

/** Priority order: anchors (verbatim) > topic > note > content. The
 *  content dump contributes last and capped — it is reference material,
 *  not the idea itself. Dedupes; total capped at MAX_KEYWORDS. */
export function extractOverlapKeywords(input: OverlapInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (kw: string | undefined) => {
    const k = kw?.trim();
    if (k === undefined || k.length < 2) return;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const a of input.anchors ?? []) push(a);
  for (const kw of keywordsFromText(input.topic, 12)) push(kw);
  if (input.note !== undefined) {
    for (const kw of keywordsFromText(input.note, 10)) push(kw);
  }
  if (input.content !== undefined) {
    for (const kw of keywordsFromText(input.content, 10)) push(kw);
  }
  return out.slice(0, MAX_KEYWORDS);
}

/** Scan the keywords across every project article. Returns only hits. */
export function scanOverlap(repoRoot: string, keywords: string[]): OverlapHit[] {
  const projectsDir = path.join(repoRoot, "projects");
  if (!existsSync(projectsDir)) return [];
  const articles: { name: string; text: string }[] = [];
  for (const name of readdirSync(projectsDir).sort()) {
    const article = path.join(projectsDir, name, "article.md");
    if (existsSync(article)) {
      articles.push({ name, text: readFileSync(article, "utf8") });
    }
  }
  const hits: OverlapHit[] = [];
  for (const keyword of keywords) {
    const matched = articles
      .filter((a) => a.text.includes(keyword))
      .map((a) => a.name);
    if (matched.length > 0) hits.push({ keyword, projects: matched });
  }
  return hits;
}
