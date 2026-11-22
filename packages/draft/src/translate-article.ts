/**
 * Multi-language support: translate one project's article into a language
 * workdir that shares the canonical image set.
 *
 * Layout (Option A, l10n-workdir shape — decided 2026-10-26):
 *
 *   projects/<id>/
 *     article.md                 ← canonical language (source of truth)
 *     assets/images/             ← SHARED image store (G1 sidecars live here)
 *     l10n/<lang>/
 *       article.md               ← translated; `visual:` lines pinned
 *                                   byte-identical, so the image sidecar
 *                                   cache keys match the canonical ones and
 *                                   `video make` reuses every picture with
 *                                   zero image spend
 *       audio-config.yaml        ← per-language voice
 *       assets/images -> ../../assets/images   (symlink)
 *       state.yaml, storyboard/, assets/audio/, output/, ...
 *
 * The workdir is a full project root, so every existing verb
 * (make / preview / qa / youtube) works on it unchanged; the CLI only adds
 * an `l10n/<lang>` resolution hop (see cli/make-command.ts).
 *
 * Why pin `visual:` lines in code instead of trusting the LLM: the G1
 * sidecar key (`imageCacheKey`) hashes the article's `visual:` string.
 * A reworded line silently re-spends every scene image — the exact cost
 * this feature exists to avoid.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPrompt, fillPrompt } from "@video/prompts";
import {
  CAPTION_BLOCK_MAX_LINES,
  CAPTION_LINE_UNITS,
  captionBlockLineCount,
} from "@video/media";
import { stripReasoning, type Provider } from "@video/llm";
import { parseDocument, isSeq, isMap } from "yaml";
import {
  articleToStoryboardYaml,
  parseArticleLenient,
  type ParsedArticle,
} from "./schemas.js";

// Loaded at import time — the prompt-registry coverage test asserts every
// .md on disk is in the loader cache after imports (orphan guard).
const TRANSLATE_ARTICLE_PROMPT = loadPrompt("translate-article");
const CONDENSE_NARRATION_PROMPT = loadPrompt("translate-condense");

export interface TranslateArticleOptions {
  projectRoot: string;
  targetLang: string;
  provider: Provider;
  /** Voice id stamped into the translated audio-config (per language). */
  voice: string;
  /** One re-ask with the violation list when invariants fail (default 2). */
  maxAttempts?: number;
  /** Overwrite an existing translation. */
  force?: boolean;
}

export interface TranslateArticleResult {
  l10nRoot: string;
  articlePath: string;
  warnings: string[];
}

export class TranslateArticleError extends Error {
  readonly violations: string[];
  constructor(message: string, violations: string[] = []) {
    super(message);
    this.name = "TranslateArticleError";
    this.violations = violations;
  }
}

/** Frontmatter `language:` of the canonical article (best effort). */
export function canonicalLanguage(articleMd: string): string {
  const m = /^language:\s*(\S+)\s*$/m.exec(articleMd);
  return m?.[1] ?? "zh-CN";
}

function l10nRootFor(projectRoot: string, lang: string): string {
  return path.join(projectRoot, "l10n", lang);
}

export function l10nArticlePath(
  projectRoot: string,
  lang: string,
): string {
  return path.join(l10nRootFor(projectRoot, lang), "article.md");
}

/** Does a language workdir already exist for this project? */
export function hasL10n(projectRoot: string, lang: string): boolean {
  return existsSync(l10nArticlePath(projectRoot, lang));
}

/**
 * The caption source a translated article should use.
 *
 * Historically en-* articles were switched to the short `caption:`
 * label ("safe-area rule"): the English narration was long, the
 * safe-area check counted it against the SCENE rather than the cue,
 * and the render was refused.
 *
 * Both premises are gone. The safe-area check is per CUE, and the cue
 * builder splits a long narration into several two-line cues (it
 * stopped dropping their tails in 2026-11-15). And the label was
 * ALREADY on screen: the Pillow key-info banner bakes the same
 * `caption:` label into the top of the frame — so burning it again at
 * the bottom made the frame say the same thing twice and left the
 * viewer with no subtitle at all.
 *
 * So a translation burns the NARRATION, exactly like the source
 * language. Returns undefined for every language: the article's own
 * `captions_source` (if any) is preserved by the frontmatter rewrite.
 */
export function captionsSourceFor(_lang: string): "caption" | undefined {
  return undefined;
}

/** Rewrite frontmatter keys on the translated article text. When the voice
 *  is an Edge voice id (xx-XX-*Neural), stamp `tts_provider: edge` — the
 *  canonical article may carry `tts_provider: voicebox`, whose profiles are
 *  language-specific clones that cannot speak the target language. */
function rewriteFrontmatter(
  articleMd: string,
  lang: string,
  voice: string,
): string {
  let out = articleMd;
  const setKey = (key: string, value: string): void => {
    const re = new RegExp(`^${key}:\\s*.*$`, "m");
    if (re.test(out)) out = out.replace(re, `${key}: ${value}`);
    else out = out.replace(/^(language:.*$)/m, `$1\n${key}: ${value}`);
  };
  setKey("language", lang);
  setKey("voice", voice);
  if (/^[a-z]{2,3}-[A-Za-z]{2,4}-\w+Neural$/.test(voice)) {
    setKey("tts_provider", "edge");
  }
  const captions = captionsSourceFor(lang);
  if (captions) setKey("captions_source", captions);
  return out;
}

/** The first fenced YAML block after the `## Scenes` heading, with its
 *  offset in the markdown. */
function findScenesYamlBlock(
  md: string,
): { yaml: string; start: number } | null {
  const m = /##\s*Scenes[\s\S]*?```(?:yaml)?\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m || m.index === undefined || m[1] === undefined) return null;
  const rel = m[0].lastIndexOf(m[1]);
  return { yaml: m[1], start: m.index + rel };
}

/** Byte-pin every canonical `visual:` value into the translated text,
 *  matched by scene id so scene order cannot silently drift.
 *
 *  The value is replaced by YAML SOURCE RANGE, not by line: a long visual
 *  line comes back from the model as a wrapped multi-line plain scalar,
 *  and a line-based replace rewrites only the first physical line — the
 *  continuation lines survive, the pinned text parses back to a DIFFERENT
 *  visual, and the structure check rejects a perfectly good translation.
 *  A model that drops the `visual:` key outright is repaired the same way
 *  (the key is re-inserted after the scene's `id:` line). */
function pinVisualLines(
  translatedMd: string,
  canonical: ParsedArticle,
): { text: string; violations: string[] } {
  const violations: string[] = [];
  for (const scene of canonical.scenes) {
    if (scene.visual.includes("\n")) {
      violations.push(
        `scene ${scene.id}: canonical visual is multi-line — unsupported, translate manually`,
      );
    }
  }
  const block = findScenesYamlBlock(translatedMd);
  if (!block) {
    return {
      text: translatedMd,
      violations: [...violations, "translated article has no scenes YAML block"],
    };
  }
  const pinned = pinVisualsInYaml(block.yaml, canonical);
  const text =
    translatedMd.slice(0, block.start) +
    pinned.yaml +
    translatedMd.slice(block.start + block.yaml.length);
  return { text, violations: [...violations, ...pinned.violations] };
}

/** YAML-quote a pinned value. JSON double-quoted syntax is a subset of
 *  YAML's, and it round-trips the exact string the model must not change.
 *  A plain (unquoted) scalar is preferred — it keeps the l10n article
 *  shaped like the canonical one — but only when it parses back to the
 *  exact same string; anything YAML would mangle (a leading indicator
 *  char, ": ", " #", trailing space) falls back to the quoted form. */
function pinYamlValue(value: string): string {
  const probe = parseDocument(`visual: ${value}\n`);
  const node = probe.get("visual", true) as { value?: unknown } | undefined;
  if (node && node.value === value) return value;
  return JSON.stringify(value);
}

/** Replace the `visual:` value of every scene in a scenes-YAML block with
 *  the canonical one, by source range. Returns the patched YAML. */
function pinVisualsInYaml(
  yamlText: string,
  canonical: ParsedArticle,
): { yaml: string; violations: string[] } {
  const violations: string[] = [];
  const doc = parseDocument(yamlText);
  const scenes = doc.get("scenes");
  const items = isSeq(scenes) ? scenes.items : [];
  interface Edit {
    start: number;
    end: number;
    text: string;
  }
  const edits: Edit[] = [];
  canonical.scenes.forEach((scene, i) => {
    const item = items[i];
    if (!item || !isMap(item)) {
      violations.push(`scene ${scene.id}: missing from translation`);
      return;
    }
    const node = item.get("visual", true) as
      | { range?: [number, number, number] }
      | undefined;
    if (node?.range) {
      const [start, valueEnd] = node.range;
      edits.push({ start, end: valueEnd, text: pinYamlValue(scene.visual) });
      return;
    }
    // The model dropped the key — re-insert it after the scene's `id:` line.
    const idNode = item.get("id", true) as
      | { range?: [number, number, number] }
      | undefined;
    if (!idNode?.range) {
      violations.push(`scene ${scene.id}: no id line found in translation`);
      return;
    }
    const idEnd = idNode.range[1];
    const lineEnd = yamlText.indexOf("\n", idEnd);
    const at = lineEnd === -1 ? yamlText.length : lineEnd + 1;
    edits.push({
      start: at,
      end: at,
      text: `    visual: ${pinYamlValue(scene.visual)}\n`,
    });
  });
  // Apply back-to-front so earlier offsets stay valid.
  let out = yamlText;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { yaml: out, violations };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeRegExpReplacement(s: string): string {
  return s.replace(/\$/g, "$$$$");
}

/** Does every violation ask for a shorter narration (caption safe
 *  area)? Those are the only ones a targeted condensation can fix —
 *  anything structural (id drift, a dropped scene) needs a full
 *  rewrite. */
function overflowOnly(violations: string[]): boolean {
  return (
    violations.length > 0 &&
    violations.every((v) =>
      /^scene \S+: narration wraps to \d+ caption lines/.test(v),
    )
  );
}

/** Last-resort trim for a narration the model refuses to shorten.
 *  Cuts at a sentence, then a clause, then a word boundary so the
 *  result still reads as English and fits the caption block. The
 *  caller reports every trimmed scene — a content loss that is never
 *  silent. */
function trimToCaptionBudget(text: string): string {
  const fits = (s: string) => captionBlockLineCount(s) <= CAPTION_BLOCK_MAX_LINES;
  const sentences = text.match(/[^.!?]*[.!?]+/g) ?? [text];
  for (let i = sentences.length - 1; i > 0; i--) {
    const candidate = sentences.slice(0, i).join("").trim();
    if (candidate.length > 0 && fits(candidate)) return candidate;
  }
  const clauses = text.split(/(?<=[,;:])\s+/);
  for (let i = clauses.length - 1; i > 0; i--) {
    const candidate = clauses.slice(0, i).join(" ").trim().replace(/[,;:]$/, "");
    if (candidate.length > 0 && fits(candidate)) return candidate;
  }
  const words = text.split(/\s+/);
  for (let i = words.length - 1; i > 0; i--) {
    const candidate = words.slice(0, i).join(" ").trim().replace(/[,;:]$/, "");
    if (candidate.length > 0 && fits(candidate)) return candidate;
  }
  return text;
}

interface OverflowScene {
  id: string;
  narration: string;
}

/** Split the over-budget scenes into fixed-size batches. One model call
 *  per batch: the condensation ask is small enough that the model
 *  answers it instead of reasoning until the response is truncated. */function chunkScenes(
  scenes: OverflowScene[],
  size: number,
): OverflowScene[][] {
  const out: OverflowScene[][] = [];
  for (let i = 0; i < scenes.length; i += size) {
    out.push(scenes.slice(i, i + size));
  }
  return out;
}

function buildCondenseMessages(
  over: OverflowScene[],
  lang: string,
  note?: string,
) {
  const payload = over
    .map((o) => `${o.id}: ${o.narration}`)
    .join("\n");
  const system = (
    CONDENSE_NARRATION_PROMPT.split("## Input")[0] ?? ""
  ).replaceAll("{{TARGET_LANG}}", lang);
  const user = fillPrompt(CONDENSE_NARRATION_PROMPT, {
    TARGET_LANG: lang,
    SCENES_JSON: payload,
  });
  return [
    {
      role: "system" as const,
      content: note ? `${system}\n\n${note}` : system,
    },
    { role: "user" as const, content: user },
  ];
}

/** Re-emit one narration as a YAML block literal with the article's
 *  6-space indent, as one line. The cue builder re-wraps for display,
 *  so the article never needs pretty wrapping — a single line keeps
 *  the splice and the range arithmetic trivial. */
function yamlNarrationScalar(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return `|\n      ${oneLine}\n`;
}

/** Parse a condensation response into id → shortened narration.
 *
 *  Primary contract is LINE-based (`scene_N: text on one line`). Lines
 *  are matched tolerantly: the model has been observed wrapping ids in
 *  quotes, numbering the list, or answering JSON-style with quoted
 *  keys — all accepted. A narration wrapped inside a JSON string value
 *  is invalid JSON (the real 15-scene payload failed exactly that way,
 *  2026-11-15), so bare JSON.parse alone is not enough, but a clean
 *  JSON object is still accepted. Ids normalize to alphanumerics so
 *  `scene-1` matches `scene_1`. */
function parseCondensations(
  raw: string,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lineRe =
    /^[\s`"'\]]*(?:\d+[.)]\s*)?[`"'\]]*(scene[_-]?\w+)[`"'\]]*\s*[:：=]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(raw)) !== null) {
    const id = m[1]!.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const value = m[2]!.trim().replace(/^"/, "").replace(/",?$/, "");
    if (value) out[id] = value;
  }
  if (Object.keys(out).length > 0) return out;
  const json = /\{[\s\S]*\}/.exec(raw);
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") {
          out[k.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()] = v.trim();
        }
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      // fall through to the failure below
    }
  }
  return null;
}

/** Targeted condensation: re-ask ONLY for the narrations that overflow
 *  the caption safe area and splice them back by YAML source range —
 *  the same range mechanism that pins visual lines.
 *
 *  Why not another full-article rewrite: a Latin script faithfully
 *  translated runs ~1.6× the source characters, so the model cannot
 *  fit the budget by translating well — measured 2026-11-15, both
 *  full attempts came back 5-7 lines on 15 of 22 scenes. Narrowing
 *  the ask to "shorten these specific narrations" is a task the
 *  model can actually satisfy.
 *
 *  Why batches: one call asking for all 49 shortened narrations made
 *  the model reason for 250k chars without ever closing its <think>
 *  block — `stripReasoning` then returns "" and the answer reads as
 *  empty. The reasoning budget has to be spent per batch, not per
 *  film. And even an 8-scene ask can outrun the budget on a long
 *  film, so a batch that comes back empty (or still over budget) is
 *  re-asked in a SMALLER batch — down to one scene, where the ask is
 *  small enough that the model always answers. */
const CONDENSE_BATCH_SIZES = [8, 4, 1];
async function condenseOverflowNarrations(
  translatedMd: string,
  canonical: ParsedArticle,
  lang: string,
  provider: Provider,
): Promise<{ text: string; violations: string[]; trimmed: string[] }> {
  const block = findScenesYamlBlock(translatedMd);
  if (!block) {
    return {
      text: translatedMd,
      violations: ["translated article has no scenes YAML block"],
      trimmed: [],
    };
  }
  const parsed = parseArticleLenient(translatedMd);
  const over: OverflowScene[] = parsed.scenes
    .filter(
      (s) => captionBlockLineCount(s.narration) > CAPTION_BLOCK_MAX_LINES,
    )
    .map((s) => ({ id: s.id, narration: s.narration }));
  if (over.length === 0) return { text: translatedMd, violations: [], trimmed: [] };

  const condensations: Record<string, string> = {};
  /** Scenes the model refused to shorten and the trimmer cut instead —
   *  reported to the caller so a silent content loss is never silent. */
  const trimmedScenes: string[] = [];
  /** What the last answer for a scene looked like — a scene that never
   *  reached the budget must say WHY: the model never answered, or it
   *  answered with a narration that still wraps too far. The text is
   *  kept so a retry can show the model its own previous answer. */
  const attempts = new Map<
    string,
    { lines: number; unparsable: boolean; raw: string; text: string }
  >();
  let pending = over;
  for (const [round, size] of CONDENSE_BATCH_SIZES.entries()) {
    if (pending.length === 0) break;
    const stillPending: OverflowScene[] = [];
    // A retry shows the model what it answered last time and how long
    // it was — without that, a re-ask reproduces the same length.
    const retryNote =
      round === 0
        ? undefined
        : `The narrations below are your PREVIOUS answers. Each one is still too long for the caption block: cut every one down to at most ${CAPTION_BLOCK_MAX_LINES * CAPTION_LINE_UNITS * 2} characters (aim for ${Math.floor((CAPTION_BLOCK_MAX_LINES * CAPTION_LINE_UNITS * 2) * 0.85)}). Count the characters of your new answer before you send it. The length limit WINS: if a narration cannot fit without keeping every detail, drop the least load-bearing detail — a restated example, a repeated attribution, a minor qualifier — rather than stay over the limit.`;
    for (const batch of chunkScenes(pending, size)) {
      const ask = batch.map((o) => {
        const attempt = attempts.get(o.id);
        return attempt && attempt.text ? { ...o, narration: attempt.text } : o;
      });
      const res = await provider.chat({
        messages: buildCondenseMessages(ask, lang, retryNote),
        temperature: 0.3,
      });
      const raw = stripFence(stripReasoning(res.content).trim());
      const parsed = parseCondensations(raw);
      if (!parsed) {
        for (const o of batch) {
          attempts.set(o.id, { lines: 0, unparsable: true, raw, text: "" });
          stillPending.push(o);
        }
        continue;
      }
      for (const o of batch) {
        const key = o.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const next = typeof parsed[key] === "string" ? parsed[key]!.trim() : "";
        if (!next) {
          stillPending.push(o);
          continue;
        }
        const lines = captionBlockLineCount(next);
        attempts.set(o.id, { lines, unparsable: false, raw, text: next });
        if (lines > CAPTION_BLOCK_MAX_LINES) {
          // Still over budget → re-ask in a smaller batch. If it is the
          // last batch size and the model still will not cut, trim it
          // here: one stubborn scene must not fail the whole film.
          if (size === CONDENSE_BATCH_SIZES[CONDENSE_BATCH_SIZES.length - 1]) {
            const trimmed = trimToCaptionBudget(next);
            if (captionBlockLineCount(trimmed) <= CAPTION_BLOCK_MAX_LINES) {
              condensations[key] = trimmed;
              trimmedScenes.push(o.id);
              continue;
            }
          }
          stillPending.push(o);
          continue;
        }
        condensations[key] = next;
      }
    }
    pending = stillPending;
  }

  const doc = parseDocument(block.yaml);
  const scenes = doc.get("scenes");
  const items = isSeq(scenes) ? scenes.items : [];
  const canonicalById = new Map(canonical.scenes.map((s) => [s.id, s]));
  interface Edit {
    start: number;
    end: number;
    text: string;
  }
  const edits: Edit[] = [];
  const violations: string[] = [];
  for (const o of over) {
    const idx = parsed.scenes.findIndex((s) => s.id === o.id);
    const item = items[idx];
    const node =
      item && isMap(item)
        ? (item.get("narration", true) as
            | { range?: [number, number, number] }
            | undefined)
        : undefined;
    const nextRaw = condensations[o.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()];
    const next = typeof nextRaw === "string" ? nextRaw.trim() : "";
    if (!node?.range) {
      violations.push(`scene ${o.id}: no narration line found in translation`);
      continue;
    }
    if (!next) {
      // Say why it is missing: the model never answered, or it
      // answered with a narration that still wraps past the safe area.
      const attempt = attempts.get(o.id);
      if (attempt?.unparsable) {
        violations.push(
          `scene ${o.id}: condensation response was not parsable (expected \`scene_id: shortened narration\` lines; got: ${attempt.raw.slice(0, 200).replace(/\s+/g, " ")})`,
        );
      } else if (attempt) {
        violations.push(
          `scene ${o.id}: condensed narration still wraps to ${attempt.lines} caption lines — the safe area holds ${CAPTION_BLOCK_MAX_LINES} lines of ${CAPTION_LINE_UNITS} units (about ${CAPTION_BLOCK_MAX_LINES * CAPTION_LINE_UNITS * 2} Latin characters)`,
        );
      } else {
        violations.push(`scene ${o.id}: condensed narration missing`);
      }
      continue;
    }
    if (canonicalById.get(o.id)?.narration.trim() === next) {
      violations.push(
        `scene ${o.id}: condensed narration equals the source text`,
      );
      continue;
    }
    const [start, valueEnd] = node.range;
    edits.push({ start, end: valueEnd, text: yamlNarrationScalar(next) });
  }
  let yamlOut = block.yaml;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    yamlOut = yamlOut.slice(0, edit.start) + edit.text + yamlOut.slice(edit.end);
  }
  const text =
    translatedMd.slice(0, block.start) +
    yamlOut +
    translatedMd.slice(block.start + block.yaml.length);
  return { text, violations, trimmed: trimmedScenes };
}

/** Structural invariants the LLM must not break. */
function validateStructure(
  translatedMd: string,
  canonical: ParsedArticle,
  lang: string,
): string[] {
  const violations: string[] = [];
  let parsed: ParsedArticle;
  try {
    parsed = parseArticleLenient(translatedMd);
  } catch (err) {
    return [`translation does not parse: ${(err as Error).message}`];
  }
  if (parsed.scenes.length !== canonical.scenes.length) {
    violations.push(
      `scene count ${parsed.scenes.length} != canonical ${canonical.scenes.length}`,
    );
    return violations;
  }
  // Frontmatter `language:` is NOT checked here — rewriteFrontmatter()
  // sets it deterministically after validation, so pre-rewrite text
  // legitimately still carries the canonical language.
  parsed.scenes.forEach((scene, i) => {
    const want = canonical.scenes[i];
    if (!want) return;
    if (scene.id !== want.id) {
      violations.push(
        `scene ${i + 1}: id ${scene.id} != canonical ${want.id}`,
      );
    }
    if (scene.visual.trim() !== want.visual.trim()) {
      violations.push(`scene ${scene.id}: visual line changed`);
    }
    if (scene.narration.trim().length === 0) {
      violations.push(`scene ${scene.id}: narration is empty`);
    }
    if (scene.caption.trim().length === 0) {
      violations.push(`scene ${scene.id}: caption is empty`);
    }
    // The caption safe area (§62.4) caps one scene's caption block at
    // four 24-unit lines. Chinese narration fits it by construction;
    // a Latin script needs ~1.6x the characters for the same content,
    // so a faithful translation overflows and the render is REJECTED
    // downstream ("Captions wrap to N lines"). Reported as a violation
    // so the retry loop hands the model the exact scene and budget
    // instead of the make step failing after a paid translation.
    const lineCount = captionBlockLineCount(scene.narration);
    if (lineCount > CAPTION_BLOCK_MAX_LINES) {
      violations.push(
        `scene ${scene.id}: narration wraps to ${lineCount} caption lines — the safe area holds ${CAPTION_BLOCK_MAX_LINES} lines of ${CAPTION_LINE_UNITS} units (about ${CAPTION_BLOCK_MAX_LINES * CAPTION_LINE_UNITS * 2} Latin characters). Shorten the narration to fit, keeping every fact.`,
      );
    }
  });
  return violations;
}

function buildMessages(articleMd: string, lang: string, extra: string) {
  const template = TRANSLATE_ARTICLE_PROMPT;
  // system = the rules only (everything before the payload section);
  // user = the full filled template (rules + article + task).
  const system = (
    template.split("## Input article")[0] ?? ""
  ).replaceAll("{{TARGET_LANG}}", lang);
  const user = fillPrompt(template, {
    TARGET_LANG: lang,
    ARTICLE: articleMd,
    EXTRA_RULES: extra,
  });
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** Translate the canonical article into a language workdir. */
export async function translateArticle(
  opts: TranslateArticleOptions,
): Promise<TranslateArticleResult> {
  const { projectRoot, targetLang, provider, voice } = opts;
  const canonicalPath = path.join(projectRoot, "article.md");
  if (!existsSync(canonicalPath)) {
    throw new TranslateArticleError(
      `article.md not found at ${canonicalPath}`,
    );
  }
  const canonicalMd = await readFile(canonicalPath, "utf8");
  const canonical = parseArticleLenient(canonicalMd);
  if (canonicalLanguage(canonicalMd) === targetLang) {
    throw new TranslateArticleError(
      `project is already ${targetLang} — pick a different target language`,
    );
  }
  const l10nRoot = l10nRootFor(projectRoot, targetLang);
  if (hasL10n(projectRoot, targetLang) && opts.force !== true) {
    throw new TranslateArticleError(
      `translation exists at ${l10nArticlePath(projectRoot, targetLang)} — pass --force to overwrite`,
    );
  }

  const maxAttempts = opts.maxAttempts ?? 2;
  let translatedMd = "";
  let violations: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const extra =
      attempt === 1
        ? ""
        : `Your previous attempt violated these rules — fix ALL of them:\n${violations.map((v) => `- ${v}`).join("\n")}`;
    const res = await provider.chat({
      messages: buildMessages(canonicalMd, targetLang, extra),
      temperature: 0.3,
    });
    // A reasoning model answers with a leading `<think>…</think>` block.
    // Left in place, the frontmatter check fails ("missing YAML
    // frontmatter") and every scene looks missing — the translation is
    // thrown away for a wrapper the provider added, not for a bad
    // translation. Strip it before parsing.
    translatedMd = stripFence(stripReasoning(res.content).trim());
    // An EMPTY answer is not a malformed article: a reasoning model
    // that spent its whole output budget thinking returns no visible
    // content at all. Reporting that as "missing YAML frontmatter"
    // sends the reader hunting for a template problem that isn't
    // there — name the real cause instead.
    if (translatedMd === "") {
      throw new TranslateArticleError(
        `translation came back empty from ${provider.name} — the model spent its whole output budget on reasoning (usage: ${JSON.stringify(res.usage)})`,
      );
    }
    const pin = pinVisualLines(translatedMd, canonical);
    translatedMd = pin.text;
    violations = [...pin.violations, ...validateStructure(translatedMd, canonical, targetLang)];
    if (violations.length === 0) break;
    // When overflows are the ONLY problem, another full-article retry
    // cannot help — the model faithfully translates at ~1.6× the source
    // length and lands over budget again. Re-ask for just those
    // narrations instead, and splice the shorter ones back by range.
    if (overflowOnly(violations)) {
      const condensed = await condenseOverflowNarrations(
        translatedMd,
        canonical,
        targetLang,
        provider,
      );
      translatedMd = condensed.text;
      if (condensed.trimmed.length > 0) {
        // A trimmed scene lost its tail: the model would not shorten it.
        // Say so — a content loss that is never silent.
        console.warn(
          `  ! ${condensed.trimmed.length} narration(s) trimmed to fit the caption block: ${condensed.trimmed.join(", ")}`,
        );
      }
      violations =
        condensed.violations.length > 0
          ? condensed.violations
          : validateStructure(translatedMd, canonical, targetLang);
      if (violations.length === 0) break;
    }
  }
  if (violations.length > 0) {
    throw new TranslateArticleError(
      `translation broke structural invariants after ${maxAttempts} attempt(s): ` +
        violations.slice(0, 3).join("; ") +
        (violations.length > 3 ? ` (+${violations.length - 3} more)` : ""),
      violations,
    );
  }

  translatedMd = rewriteFrontmatter(translatedMd, targetLang, voice);

  // Materialize the language workdir.
  await mkdir(path.join(l10nRoot, "storyboard"), { recursive: true });
  await mkdir(path.join(l10nRoot, "assets", "audio"), { recursive: true });
  await mkdir(path.join(l10nRoot, "assets", "fonts"), { recursive: true });
  await mkdir(path.join(l10nRoot, "captions"), { recursive: true });
  await mkdir(path.join(l10nRoot, "checkpoints"), { recursive: true });
  await mkdir(path.join(l10nRoot, "runs"), { recursive: true });
  await mkdir(path.join(l10nRoot, "output"), { recursive: true });
  await writeFile(path.join(l10nRoot, "article.md"), translatedMd, "utf8");

  // Derive the storyboard immediately (same contract as draft): the
  // approve gate needs a file to approve, and `video make` re-derives on
  // every run anyway — article.md stays the source of truth.
  await writeFile(
    path.join(l10nRoot, "storyboard", "storyboard.yaml"),
    articleToStoryboardYaml(parseArticleLenient(translatedMd)),
    "utf8",
  );

  // Per-language audio-config: canonical shape, voice swapped. Regex
  // replace (not YAML round-trip) to preserve comments.
  const audioConfigPath = path.join(projectRoot, "audio-config.yaml");
  const warnings: string[] = [];
  if (existsSync(audioConfigPath)) {
    const cfg = await readFile(audioConfigPath, "utf8");
    const swapped = /^voice:.*$/m.test(cfg)
      ? cfg.replace(/^voice:.*$/m, `voice: ${voice}`)
      : `${cfg.replace(/\s*$/, "\n")}voice: ${voice}\n`;
    await writeFile(
      path.join(l10nRoot, "audio-config.yaml"),
      swapped,
      "utf8",
    );
  } else {
    warnings.push("canonical audio-config.yaml missing — write one before make");
  }

  // Share the canonical image store: relative symlink so the project tree
  // stays movable. The G1 sidecars live INSIDE the shared dir, so image
  // reuse works across languages by construction.
  const imagesLink = path.join(l10nRoot, "assets", "images");
  // Relative target is resolved from the LINK'S PARENT DIR
  // (l10n/<lang>/assets/), so it takes three ups to reach the project root.
  const imagesTarget = path.join("..", "..", "..", "assets", "images");
  if (!existsSync(imagesLink)) {
    if (!existsSync(path.join(projectRoot, "assets", "images"))) {
      warnings.push(
        "canonical assets/images missing — scenes without translated images use the theme background",
      );
    }
    await symlink(imagesTarget, imagesLink, "dir");
  }

  const projectId = path.basename(projectRoot);
  // Project-root marker (resolveProjectDir / make need one of state.yaml or
  // storyboard/storyboard.yaml). Mirrors @video/workflow initState's shape
  // without adding a cross-package dependency.
  await writeFile(
    path.join(l10nRoot, "state.yaml"),
    `status: DRAFT
current_stage: init
checkpoint:
  id: ${projectId}-l10n-${targetLang}-init-v1
  status: DRAFT
history_tail: []
`,
    "utf8",
  );

  return {
    l10nRoot,
    articlePath: path.join(l10nRoot, "article.md"),
    warnings,
  };
}

/** Strip a whole-document markdown fence the model may add despite rules.
 *  Anchored to the true string start/end (no /m): the article itself
 *  contains inner ```yaml fences that must not be mistaken for the
 *  document wrapper. */
function stripFence(text: string): string {
  const m = /^```[a-z]*\n([\s\S]*)\n```$/.exec(text);
  return m?.[1] ?? text;
}

/** Read helper kept for symmetry with the rest of the package. */
export function readCanonicalArticle(projectRoot: string): string {
  return readFileSync(path.join(projectRoot, "article.md"), "utf8");
}
