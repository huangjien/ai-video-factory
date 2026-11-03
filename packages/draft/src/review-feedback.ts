import type { ReviewPackage } from "@video/review";
import type { RawArticle } from "./agent.js";
import type { ReviseFinding } from "./revise.js";

/**
 * Review → revision bridge.
 *
 * `video review` produces a ReviewPackage: per-field verdicts and
 * structured findings about the FILM (storyboard + script + claims).
 * The surgical reviser edits a PASSAGE of article.md. This module
 * turns the first into the second.
 *
 * Two rules keep the bridge honest:
 *
 *  1. A finding is actionable only when it resolves to a passage that
 *     exists in article.md — a LABELLED excerpt ("scene-09 narration: …")
 *     or a verbatim span the finding quotes. The reviser's contract is
 *     "edit only the quoted passage", so a finding without a target is
 *     SKIPPED with a reason, never guessed at.
 *  2. Technical findings (resolution, fps, audio, subtitle, missing
 *     assets, render errors) describe the RENDER. Editing the article
 *     cannot fix them, so they are skipped with a reason instead of
 *     being fed to the reviser.
 *
 * The mapping is deterministic — no LLM call decides what a finding
 * targets. A mis-resolved finding is a skipped finding, never a wrong
 * edit.
 */

export interface SkippedReviewFinding {
  /** Where the finding came from, e.g. `content.contradictions[2]`. */
  source: string;
  id: string;
  reason: string;
}

export interface ReviewRevisionPlan {
  /** Findings the surgical reviser can act on — each with a quote. */
  findings: ReviseFinding[];
  /** Findings that cannot become a targeted edit, with the reason. */
  skipped: SkippedReviewFinding[];
}

/** Review severity → the draft loop's severity scale. */
const SEVERITY: Record<string, string> = {
  critical: "Critical",
  major: "Major",
  moderate: "Moderate",
  minor: "Minor",
};

/** A scalar field's status → a severity. `ok` is not a finding. */
function severityForStatus(status: string): string | null {
  if (status === "fail") return "Major";
  if (status === "warn") return "Moderate";
  return null;
}

/** One passage of the article a finding can target. */
interface Unit {
  kind: "scene" | "section";
  /** 1-based index within its kind. */
  index: number;
  id: string;
  /** A quote must be contained in this text for the unit to match. */
  text: string;
  /** The passage used when a finding names the unit but quotes nothing. */
  passage: string;
  /** The scene's fields — a finding that names one of them edits that one. */
  fields?: { narration: string; caption: string; visual: string };
}

/** The units of an article: one per scene, one per numbered section. */
function buildUnits(article: RawArticle): Unit[] {
  const units: Unit[] = [];
  (article.sections ?? []).forEach((s, i) => {
    const heading = s.heading ?? "";
    const body = s.body ?? "";
    units.push({
      kind: "section",
      index: i + 1,
      id: `section-${i + 1}`,
      text: `${heading}\n${body}`,
      passage: body.trim(),
    });
  });
  (article.scenes ?? []).forEach((s, i) => {
    const narration = s.narration ?? "";
    const caption = s.caption ?? "";
    const visual = s.visual ?? "";
    units.push({
      kind: "scene",
      index: i + 1,
      id: s.id ?? `scene-${String(i + 1).padStart(2, "0")}`,
      text: [caption, visual, narration].join("\n"),
      passage: (narration || caption || visual).trim(),
      fields: { narration, caption, visual },
    });
  });
  return units;
}

/** "scene-03" / "第 3 幕" / "第三场" → scene 3. */
const SCENE_REF = [
  /scene[-_\s]?(\d{1,3})/i,
  /第\s*([一二三四五六七八九十百两\d]+)\s*[幕场景场]/,
  /(\d{1,3})\s*(?:st|nd|rd|th)?\s*(?:scene|shot)\b/i,
];

/** "section 2" / "第 2 节" / "第三节" → section 2. */
const SECTION_REF = [
  /sections?\s*(\d{1,3})/i,
  /第\s*([一二三四五六七八九十百两\d]+)\s*[节段]/,
];

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** "十" → 10, "十二" → 12, "二十" → 20. A zh-CN article names its
 *  scenes "第三场" as often as "scene-03". */
function parseRefNumber(raw: string): number {
  const s = raw.trim();
  if (/^\d{1,3}$/.test(s)) return Number.parseInt(s, 10);
  if (s === "十") return 10;
  const m = s.match(/^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$/);
  if (m) {
    const head = m[1] ?? "";
    const tail = m[2] ?? "";
    const tens = head === "" ? 1 : (CN_DIGITS[head] ?? 1);
    const ones = tail === "" ? 0 : (CN_DIGITS[tail] ?? 0);
    return tens * 10 + ones;
  }
  if (s.length === 1) return CN_DIGITS[s] ?? -1;
  return -1;
}

/** The words that mark a finding as being about a unit's CONTENT — the
 *  text the reviser is allowed to edit.
 *
 *  A finding that names a scene can still be about something else: the
 *  scene-ID convention, the total runtime, the rendered frames. Pointing
 *  the reviser at that scene's narration would ask it to "fix" a
 *  narration that was never the problem — and a model that tries hard
 *  enough will comply. So a scene reference only counts when the
 *  sentence naming it also says WHICH part of the scene it means. */
const CONTENT_WORDS: [string, "narration" | "caption" | "visual"][] = [
  ["narration", "narration"],
  ["caption", "caption"],
  ["visual", "visual"],
  ["旁白", "narration"],
  ["字幕", "caption"],
  ["画面", "visual"],
];

/** Split a finding's text into sentences. A unit reference and the field
 *  it talks about must land in the SAME sentence — "scene-04 deviates
 *  from the plan (largest: …); narration density is comfortable" is two
 *  unrelated statements, and the second one is not about scene 4. */
function sentences(text: string): string[] {
  return text
    .split(/[.;;。；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The first unit reference in a sentence, with its position. */
function firstUnitRef(
  sentence: string,
): { kind: "scene" | "section"; n: number; at: number } | null {
  let best: { kind: "scene" | "section"; n: number; at: number } | null = null;
  const consider = (kind: "scene" | "section", patterns: RegExp[]): void => {
    for (const pattern of patterns) {
      const m = sentence.match(pattern);
      if (!m?.[1]) continue;
      const n = parseRefNumber(m[1]);
      if (n < 0) continue;
      const at = m.index ?? 0;
      if (best !== null && at >= best.at) continue;
      best = { kind, n, at };
    }
  };
  consider("scene", SCENE_REF);
  consider("section", SECTION_REF);
  return best;
}

/** The field a unit reference points at — the content word closest to
 *  it, and close enough to belong to it. */
function fieldNear(
  sentence: string,
  at: number,
): "narration" | "caption" | "visual" | null {
  const lower = sentence.toLowerCase();
  let best: { at: number; field: "narration" | "caption" | "visual" } | null =
    null;
  for (const [word, field] of CONTENT_WORDS) {
    const pos = lower.indexOf(word);
    if (pos < 0) continue;
    // The word must sit next to the reference, not at the far end of a
    // sentence that happens to mention both.
    if (Math.abs(pos - at) > 30) continue;
    if (best === null || Math.abs(pos - at) < Math.abs(best.at - at)) {
      best = { at: pos, field };
    }
  }
  return best?.field ?? null;
}

/** True when the finding names a unit at all (scene or section). */
function namesAnyUnit(texts: string[]): boolean {
  return texts.some(
    (t) =>
      SCENE_REF.some((p) => p.test(t)) || SECTION_REF.some((p) => p.test(t)),
  );
}

/**
 * Resolve a LABELLED target: a unit the finding names together with the
 * field it is talking about ("scene-09 narration: …", "第 2 节的旁白").
 *
 * A bare unit mention ("scene-04 deviates from the plan") is NOT a
 * target: the finding may be about the ID convention, the runtime or the
 * rendered frames, none of which the article's text can fix. Pointing
 * the reviser at that scene's narration anyway produces an edit to a
 * passage that was never broken.
 */
function resolveLabelledTarget(
  candidate: Candidate,
  units: Unit[],
): { unit: Unit; passage: string } | null {
  // The explicit field + the unit the reference names.
  if (candidate.field !== undefined) {
    const kind = candidate.field === "section" ? "section" : "scene";
    for (const pattern of kind === "scene" ? SCENE_REF : SECTION_REF) {
      for (const text of candidate.texts) {
        const m = text.match(pattern);
        if (!m?.[1]) continue;
        const n = parseRefNumber(m[1]);
        if (n < 0) continue;
        const unit = units.find((u) => u.kind === kind && u.index === n);
        if (!unit) continue;
        const passage =
          kind === "section"
            ? unit.passage
            : (
                unit.fields?.[
                  candidate.field as "narration" | "caption" | "visual"
                ] ?? unit.passage
              ).trim() || unit.passage;
        if (passage === "") continue;
        return { unit, passage };
      }
    }
  }
  // The sentence-based path: the finding names the unit and the field
  // in the same sentence.
  for (const text of candidate.texts) {
    for (const sentence of sentences(text)) {
      const ref = firstUnitRef(sentence);
      if (ref === null) continue;
      const unit = units.find((u) => u.kind === ref.kind && u.index === ref.n);
      if (!unit) continue;
      const field = fieldNear(sentence, ref.at);
      if (ref.kind === "scene") {
        // A scene has three fields — the finding must say which one.
        if (field === null) continue;
        const named = (unit.fields?.[field] ?? "").trim();
        const passage = named !== "" ? named : unit.passage;
        if (passage === "") continue;
        return { unit, passage };
      }
      // A section IS the passage.
      if (unit.passage === "") continue;
      return { unit, passage: unit.passage };
    }
  }
  return null;
}

/** Quoted spans inside a finding's text — “x”, 「x」, 《x》, "x". */
const QUOTED_SPAN = /[“"「『《]([^“”"「」『』《》]{4,})[”"」』》]/g;

/** Passages worth trying to locate in the article, most precise first. */
function passageCandidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTED_SPAN)) {
    const span = (m[1] ?? "").trim();
    if (span.length >= 4) out.push(span);
  }
  const whole = text.trim();
  if (whole.length >= 6) out.push(whole);
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.length >= 10) out.push(t);
  }
  return out;
}

/** Find the unit a passage belongs to (a quote is contained in exactly one). */
function findUnitForPassage(passage: string, units: Unit[]): Unit | null {
  const needle = passage.trim();
  if (needle.length < 4) return null;
  return units.find((u) => u.text.includes(needle)) ?? null;
}

/** The minimum shared length (in units) for two passages to count as the
 *  SAME claim. A unit is one CJK character or one Latin word. */
const DUPLICATE_MIN_UNITS = 8;

/** The longest sibling target — a whole prose sentence is the natural
 *  unit for a prose fix; past this the target is a paragraph, not a
 *  passage. */
const DUPLICATE_MAX_TARGET = 240;

/** The sentence of `text` that contains `index`.
 *
 *  Only the STRONG breaks end a sentence: a semicolon joins two clauses
 *  of the same statement, and the claim often sits in the first clause
 *  while the shared overlap lands in the second ("多数人后悔一阵子；…而
 *  怕失败就一直停在原地" — the longest overlap is the tail, but the
 *  claim is the head). */
function sentenceAround(text: string, index: number): string {
  const isBreak = (ch: string): boolean => "。！？!?\n".includes(ch);
  let start = index;
  while (start > 0 && !isBreak(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !isBreak(text[end]!)) end++;
  if (end < text.length) end += 1;
  let out = text.slice(start, end).trim();
  if (out.length > DUPLICATE_MAX_TARGET) {
    // Too long to be a passage — keep the neighbourhood of the overlap.
    const centre = index - start;
    const half = Math.floor(DUPLICATE_MAX_TARGET / 2);
    const from = Math.max(0, centre - half);
    out = out.slice(from, from + DUPLICATE_MAX_TARGET).trim();
  }
  return out;
}

/** Count units: CJK characters one each, Latin words one each. */
function unitCount(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
  return cjk + latin;
}

interface Shared {
  text: string;
  /** Where the shared text starts in each input. */
  atA: number;
  atB: number;
}

/** The longest substring two texts share. */
function longestShared(a: string, b: string): Shared | null {
  if (a === "" || b === "") return null;
  let best = { len: 0, atA: 0, atB: 0 };
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      cur[j] = (prev[j - 1] ?? 0) + 1;
      const len = cur[j] ?? 0;
      if (len > best.len) best = { len, atA: i, atB: j };
    }
    prev = cur;
  }
  if (best.len === 0) return null;
  return {
    text: a.slice(best.atA - best.len, best.atA),
    atA: best.atA - best.len,
    atB: best.atB - best.len,
  };
}

/** The passages of a unit a duplicate claim could live in. */
function unitPassages(unit: Unit): string[] {
  if (unit.kind === "section") return unit.passage === "" ? [] : [unit.passage];
  const f = unit.fields;
  if (!f) return unit.passage === "" ? [] : [unit.passage];
  // The narration is where a claim usually lives; the caption and the
  // visual line are checked too (a caption can carry the claim).
  return [f.narration, f.caption, f.visual]
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * The SAME claim in the article's other copy.
 *
 *  An article states each claim twice: once in the prose section (what
 *  the human reads) and once in the scene narration (what the video
 *  says). 15 of the 20 narrations in `projects/努力` restate a phrase
 *  that also lives in the prose. Fixing only the copy the judge quoted
 *  leaves the other asserting the old claim — the article then says two
 *  different things, and the human reads a script that is not what the
 *  film says.
 *
 *  So a finding gets a second target: the passage in the other copy
 *  that says the same thing, widened past the shared overlap so the
 *  divergence (the wording that actually differs) is inside it.
 */
function siblingTargets(
  quote: string,
  unit: Unit,
  units: Unit[],
): { quote: string; unit: Unit }[] {
  const wantKind = unit.kind === "scene" ? "section" : "scene";
  const out: { quote: string; unit: Unit }[] = [];
  for (const other of units) {
    if (other.kind !== wantKind) continue;
    for (const passage of unitPassages(other)) {
      const shared = longestShared(quote, passage);
      if (!shared) continue;
      if (unitCount(shared.text) < DUPLICATE_MIN_UNITS) continue;
      // The sibling target is the SENTENCE that carries the shared
      // claim, not the shared fragment: the two copies word the claim
      // differently ("我见过一位同事" vs "有人三年不迟到"), and only the
      // full sentence shows the reviser whether the fix applies there.
      out.push({
        quote: sentenceAround(passage, shared.atB),
        unit: other,
      });
      break;
    }
  }
  return out;
}

interface Candidate {
  source: string;
  id: string;
  code: string;
  severity: string;
  description: string;
  recommendation: string;
  /** Texts searched for a target, most precise first. */
  texts: string[];
  /** The text the finding names explicitly (narration/caption/visual/section). */
  field?: "narration" | "caption" | "visual" | "section";
}

/** Every review finding that could become a targeted edit, in report order. */
function collectCandidates(review: ReviewPackage): Candidate[] {
  const out: Candidate[] = [];
  const c = review.content;

  const scalars: [
    string,
    {
      status: string;
      evidence?: string | null | undefined;
      recommendation?: string | null | undefined;
    },
  ][] = [
    ["content.accuracy", c.accuracy],
    ["content.logic", c.logic],
    ["visual.readability", review.visual.readability],
    ["visual.density", review.visual.density],
    ["visual.pacing", review.visual.pacing],
    ["visual.visual_hierarchy", review.visual.visual_hierarchy],
    ["visual.caption_length", review.visual.caption_length],
  ];
  for (const [source, field] of scalars) {
    const severity = severityForStatus(field.status);
    if (severity === null) continue;
    const evidence = field.evidence ?? "";
    out.push({
      source,
      id: source,
      code: `REVIEW_${source.replace(".", "_").toUpperCase()}`,
      severity,
      description:
        evidence === "" ? `${source} was judged ${field.status}` : evidence,
      recommendation: field.recommendation ?? evidence,
      texts: [evidence],
    });
  }

  const arrays: [
    string,
    {
      id: string;
      severity: string;
      observation: string;
      reference?: string | null | undefined;
      evidence?: string | null | undefined;
      recommendation?: string | null | undefined;
      field?: "narration" | "caption" | "visual" | "section" | null | undefined;
      quote?: string | null | undefined;
    }[],
  ][] = [
    ["content.unsupported_claims", c.unsupported_claims],
    ["content.contradictions", c.contradictions],
    ["content.repetition", c.repetition],
  ];
  for (const [source, list] of arrays) {
    list.forEach((f, i) => {
      const evidence = f.evidence ?? "";
      // The reference ("scene-02", "第 2 节") names the unit the finding
      // is about — it is the fallback target when nothing is quoted.
      const reference = f.reference ?? "";
      // The explicit quote + field are what make a finding repairable:
      // the quote is the passage to edit, the field is which text of
      // the scene it is.
      const explicitQuote = f.quote ?? "";
      const field = f.field ?? undefined;
      // An unsupported claim is a FACT finding: the research guard
      // verifies it before the reviser touches it (a reviser with no
      // verified notes will invent a citation instead).
      const code =
        source === "content.unsupported_claims"
          ? "FACT_UNSUPPORTED_CLAIM"
          : `REVIEW_${source.split(".")[1]!.toUpperCase()}`;
      out.push({
        source: `${source}[${i}]`,
        id: f.id === "" ? `${source}-${i}` : f.id,
        code,
        severity: SEVERITY[f.severity.toLowerCase()] ?? "Moderate",
        description: f.observation,
        recommendation: f.recommendation ?? f.observation,
        texts: [explicitQuote, evidence, f.observation, reference].filter(
          (t) => t.trim() !== "",
        ),
        ...(field !== undefined ? { field } : {}),
      });
    });
  }
  return out;
}

/**
 * Turn a review package into the findings the surgical reviser can act on.
 *
 * `article` is the structured article (see `articleMdToRawArticle`) — the
 * same shape the reviser receives as its base.
 */
export function planReviewRevision(
  review: ReviewPackage,
  article: RawArticle,
): ReviewRevisionPlan {
  const units = buildUnits(article);
  const findings: ReviseFinding[] = [];
  const skipped: SkippedReviewFinding[] = [];
  const seenQuotes = new Set<string>();

  // Technical findings are reported, never edited: they describe the
  // render, and article.md cannot change a missing asset or a bad fps.
  const t = review.technical;
  const technicalScalars: [string, { status: string }][] = [
    ["technical.resolution", t.resolution],
    ["technical.fps", t.fps],
    ["technical.audio", t.audio],
    ["technical.subtitle", t.subtitle],
  ];
  for (const [source, field] of technicalScalars) {
    if (field.status === "ok") continue;
    skipped.push({ source, id: source, reason: TECHNICAL_SKIP_REASON });
  }
  t.missing_assets.forEach((f, i) => {
    skipped.push({
      source: `technical.missing_assets[${i}]`,
      id: f.id === "" ? `technical.missing_assets-${i}` : f.id,
      reason: TECHNICAL_SKIP_REASON,
    });
  });
  t.render_errors.forEach((f, i) => {
    skipped.push({
      source: `technical.render_errors[${i}]`,
      id: f.id === "" ? `technical.render_errors-${i}` : f.id,
      reason: TECHNICAL_SKIP_REASON,
    });
  });

  for (const candidate of collectCandidates(review)) {
    let quote: string | null = null;
    let quoteUnit: Unit | null = null;

    // 1. A LABELLED target — the finding names the unit and the field
    //    ("scene-09 narration: …"). The passage is the article's own
    //    text for that field, verbatim.
    const labelled = resolveLabelledTarget(candidate, units);

    // 2. A verbatim passage the finding quotes.
    let verbatim: string | null = null;
    let verbatimUnit: Unit | null = null;
    for (const text of candidate.texts) {
      if (text.trim() === "") continue;
      for (const passage of passageCandidates(text)) {
        const unit = findUnitForPassage(passage, units);
        if (unit !== null) {
          verbatim = passage;
          verbatimUnit = unit;
          break;
        }
      }
      if (verbatim !== null) break;
    }

    // The precise quote wins when it belongs to the labelled target.
    // When it does not — the review quoted the caption while the fix is
    // in the narration — the labelled target is the better target.
    if (labelled !== null && verbatim !== null) {
      quote = labelled.passage.includes(verbatim) ? verbatim : labelled.passage;
      quoteUnit = labelled.passage.includes(verbatim)
        ? (verbatimUnit ?? labelled.unit)
        : labelled.unit;
    } else if (labelled !== null) {
      quote = labelled.passage;
      quoteUnit = labelled.unit;
    } else {
      quote = verbatim;
      quoteUnit = verbatimUnit;
    }

    if (quote === null) {
      skipped.push({
        source: candidate.source,
        id: candidate.id,
        reason: namesAnyUnit(candidate.texts)
          ? "names a unit but does not say which of its texts it means — no passage to edit"
          : "no verbatim passage in article.md and no labelled unit",
      });
      continue;
    }

    // Two findings on the same passage: keep the more severe one — the
    // reviser edits a passage, not a pile of overlapping edits.
    if (seenQuotes.has(quote)) {
      skipped.push({
        source: candidate.source,
        id: candidate.id,
        reason: "another finding already targets this passage",
      });
      continue;
    }
    seenQuotes.add(quote);

    const finding: ReviseFinding = {
      id: candidate.id,
      code: candidate.code,
      severity: candidate.severity,
      quote,
      description: candidate.description,
      recommendation: candidate.recommendation,
    };
    findings.push(finding);

    // The same claim also lives in the article's other copy (the prose
    // section behind a narration, or the narration behind a prose
    // passage). Fixing one copy leaves the other asserting the old
    // claim — so the fix gets a second target.
    if (quoteUnit === null) continue;
    const siblings = siblingTargets(quote, quoteUnit, units);
    siblings.forEach((sibling, i) => {
      if (seenQuotes.has(sibling.quote)) return;
      seenQuotes.add(sibling.quote);
      findings.push({
        ...finding,
        id: `${finding.id}@${
          sibling.unit.kind === "section" ? "prose" : "scene"
        }${siblings.length > 1 ? i + 1 : ""}`,
        quote: sibling.quote,
      });
    });
  }

  return { findings, skipped };
}

/** Technical findings never become edits — they describe the render. */
export const TECHNICAL_SKIP_REASON =
  "technical findings describe the render (resolution, fps, audio, assets), not the article";

/** The rule a claim needs when research found NO verified source.
 *
 *  Appending this AFTER the recommendation is not enough — the first
 *  real run had a recommendation that itself named the source ("add an
 *  attribution … 余世存's preface to 《时间之书》"), and the reviser
 *  followed the specific instruction over the appended rule. So the
 *  rule explicitly OVERRIDES the recommendation it rides on. */
export const NO_SOURCE_RULE =
  "[OVERRIDE — no verified source was found for this claim. If the recommendation above suggests adding an attribution, citation, book title, or author name, DISREGARD that part: soften or scope the claim instead. Nothing unverified may enter the article as a source.]";

/** Attach the no-source rule to a finding the research could not verify. */
export function guardUnverifiedFact(finding: ReviseFinding): ReviseFinding {
  return {
    ...finding,
    recommendation: `${finding.recommendation}\n\n${NO_SOURCE_RULE}`,
  };
}

/**
 * Give every finding a second target: the same claim in the article's
 * other copy.
 *
 *  An article states each claim twice — once in the prose section (what
 *  the human reads) and once in the scene narration (what the video
 *  says). A finding that quotes one copy and edits only that copy
 *  leaves the other asserting the old claim, and the article then
 *  contradicts itself. Measured on `projects/努力`: narration-only
 *  scored 76.6/100, both copies 88.4/100.
 *
 *  Shared by the review path and the draft loop's own revision stage —
 *  both edit the same article.
 */
export function withDuplicateCopies(
  findings: ReviseFinding[],
  article: RawArticle,
): ReviseFinding[] {
  if (findings.length === 0) return findings;
  const units = buildUnits(article);
  const out = [...findings];
  const seen = new Set(findings.map((f) => f.quote));
  for (const finding of findings) {
    const unit = findUnitForPassage(finding.quote, units);
    if (unit === null) continue;
    for (const sibling of siblingTargets(finding.quote, unit, units)) {
      if (seen.has(sibling.quote)) continue;
      seen.add(sibling.quote);
      out.push({
        ...finding,
        id: `${finding.id}@${
          sibling.unit.kind === "section" ? "prose" : "scene"
        }`,
        quote: sibling.quote,
      });
    }
  }
  return out;
}
