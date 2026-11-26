import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Overlap preflight (design §CLI): before an idea enters the backlog,
 * its keywords are scanned against each project's article.md so a video
 * that is already covered warns instead of silently re-shipping.
 * A warning is a soft gate — `--force` overrules it on `add`; on
 * `harvest` the warning lands in the proposed entry's note instead of
 * skipping, because the signal is advisory (2026-11-19 dry-run: naive
 * keyword skips discarded 5 fresh topics on shingle noise).
 */

export interface OverlapHit {
  /** The project whose article matched. */
  project: string;
  /** The keywords that matched IN THIS ARTICLE. */
  keywords: string[];
}

export interface OverlapInput {
  topic: string;
  note?: string;
  anchors?: string[];
  content?: string;
}

const MAX_KEYWORDS = 40;

/** Function words that match half a catalog and mean nothing: dropped
 *  before scanning (2026-11-19 dry-run: "the"/"why"/"为什" flagged 20+
 *  unrelated projects per idea). */
const LATIN_STOPWORDS: Record<string, true> = {
  the: true,
  and: true,
  for: true,
  not: true,
  but: true,
  why: true,
  how: true,
  what: true,
  when: true,
  where: true,
  which: true,
  who: true,
  whose: true,
  with: true,
  without: true,
  into: true,
  from: true,
  that: true,
  this: true,
  these: true,
  those: true,
  there: true,
  their: true,
  them: true,
  they: true,
  than: true,
  then: true,
  are: true,
  was: true,
  were: true,
  been: true,
  being: true,
  have: true,
  has: true,
  had: true,
  its: true,
  it: true,
  is: true,
  one: true,
  two: true,
  same: true,
  other: true,
  another: true,
  such: true,
  only: true,
  also: true,
  just: true,
  like: true,
  over: true,
  under: true,
  about: true,
  after: true,
  before: true,
  between: true,
  during: true,
  each: true,
  some: true,
  any: true,
  all: true,
  more: true,
  most: true,
  less: true,
  least: true,
  very: true,
  much: true,
  many: true,
  can: true,
  could: true,
  should: true,
  would: true,
  may: true,
  might: true,
  must: true,
  will: true,
  shall: true,
  does: true,
  did: true,
  done: true,
  doing: true,
  get: true,
  gets: true,
  got: true,
  make: true,
  makes: true,
  made: true,
  use: true,
  uses: true,
  used: true,
  using: true,
  new: true,
  old: true,
  own: true,
  still: true,
  yet: true,
  way: true,
  ways: true,
  thing: true,
  things: true,
};

/** CJK function characters; a shingle touching one is dropped. Kept
 *  conservative — 中/上/下/大/小 stay eligible (中国, 上海, 大肠 …).
 *  2026-11-19 harvest: 一次/一个/下一 flags were pure noise, so 一,
 *  次 and 个 joined. */
const CJK_FUNCTION_CHARS =
  "一的了是在有和与就都也这那为什怎如何么呢吗吧哪被把让向往从到对给跟比很太更只才或因所但于过还又及其等之次个";

/** Contiguous CJK shingles (2-4 chars) that never touch a function
 *  character, plus latin words/phrases ≥3 chars minus stopwords. */
function keywordsFromText(text: string, cap: number): string[] {
  const out: string[] = [];
  const cjkRuns = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= run.length; i++) {
        if (out.length >= cap) break;
        const shingle = run.slice(i, i + len);
        let clean = true;
        for (const ch of shingle) {
          if (CJK_FUNCTION_CHARS.includes(ch)) {
            clean = false;
            break;
          }
        }
        if (clean) out.push(shingle);
      }
      if (out.length >= cap) break;
    }
  }
  if (out.length < cap) {
    // Hyphens split before matching: "Shadow-mode" must yield shadow+mode
    // or it never meets its non-hyphened twin (2026-11-19 near-dup miss).
    const latin = (
      text.replace(/-/g, " ").match(/[a-zA-Z][a-zA-Z0-9]{2,}/g) ?? []
    ).map((w) => w.toLowerCase());
    for (const w of latin) {
      if (out.length >= cap) break;
      if (LATIN_STOPWORDS[w] !== true) out.push(w);
    }
  }
  return out;
}

/** A keyword that can carry a verdict ALONE: curated anchors, or
 *  distinctive tokens (CJK ≥4 chars, latin ≥6). Short shingles need a
 *  second witness in the same article before they count. */
function isStrong(keyword: string, anchors: Set<string>): boolean {
  if (anchors.has(keyword)) return true;
  const cjk = keyword.match(/^[\u4e00-\u9fff]+$/);
  return cjk ? keyword.length >= 4 : keyword.length >= 6;
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
  for (const kw of keywordsFromText(input.topic, 14)) push(kw);
  if (input.note !== undefined) {
    for (const kw of keywordsFromText(input.note, 10)) push(kw);
  }
  if (input.content !== undefined) {
    for (const kw of keywordsFromText(input.content, 10)) push(kw);
  }
  return out.slice(0, MAX_KEYWORDS);
}

/** Scan across every project article; report PER ARTICLE with the
 *  keywords that matched there. Verdict: ≥2 matched keywords in one
 *  article, or a single STRONG keyword (anchor / long token) — one
 *  generic shingle alone is never a verdict. */
export function scanOverlap(
  repoRoot: string,
  input: OverlapInput,
): OverlapHit[] {
  const keywords = extractOverlapKeywords(input);
  const anchors = new Set((input.anchors ?? []).map((a) => a.trim()));
  const projectsDir = path.join(repoRoot, "projects");
  if (!existsSync(projectsDir)) return [];
  const hits: OverlapHit[] = [];
  for (const name of readdirSync(projectsDir).sort()) {
    const article = path.join(projectsDir, name, "article.md");
    if (!existsSync(article)) continue;
    const text = readFileSync(article, "utf8");
    const matched = keywords.filter((kw) => text.includes(kw));
    const strong = matched.some((kw) => isStrong(kw, anchors));
    if (matched.length >= 2 || (matched.length === 1 && strong)) {
      hits.push({ project: name, keywords: matched });
    }
  }
  return hits;
}

/** Shingle-set of a short topic string: CJK 2-4 grams (no function
 *  chars) + lowercase latin words. Powers near-duplicate detection. */
export function topicShingles(topic: string): Set<string> {
  return new Set(keywordsFromText(topic, 60));
}

/** Jaccard vs containment: twins share the topic HEAD (玄武门之变…,
 *  shadow-mode…) but paraphrase the tail, so |∩|/min(|A|,|B|) — how much
 *  of the smaller title the bigger one covers — separates them far better
 *  than global Jaccard. Lexical only: cross-language paraphrases stay the
 *  human's call (the judge's produced-list covers the produced ones). */
export function topicSimilarity(a: string, b: string): number {
  const sa = topicShingles(a);
  const sb = topicShingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / Math.min(sa.size, sb.size);
}

export const NEAR_DUP_THRESHOLD = 0.4;

/** The existing backlog topic (any status) this candidate retells, if
 *  any — reworded twins share most shingles even when slugs differ
 *  (measured: 玄武门之变 twins, three "retire by numbers" variants). */
export function nearDuplicateOf(
  topic: string,
  existingTopics: string[],
): string | null {
  let best: { topic: string; sim: number } | null = null;
  for (const existing of existingTopics) {
    const sim = topicSimilarity(topic, existing);
    if (sim >= NEAR_DUP_THRESHOLD && (best === null || sim > best.sim)) {
      best = { topic: existing, sim };
    }
  }
  return best === null ? null : best.topic;
}
