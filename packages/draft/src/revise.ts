import type { ChatMessage, Provider } from "@video/llm";
import { callStructured, extractJsonObject } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { withChannelBlock } from "./channel-profile.js";
import {
  DraftError,
  renderArticleMd,
  type RawArticle,
} from "./agent.js";
import type { DraftInput } from "./prompt.js";

/**
 * Targeted article revision (2026-11 improvement #1).
 *
 * The historical loop fixed judge findings by REGENERATING the whole
 * article with a feedback block — every attempt rewrote everything, so
 * passing prose could regress while the findings got fixed (measured:
 * `努力` climbed 72 → 82 over 4 attempts and never converged on the 90
 * bar). This module is the opposite move: the reviser receives the
 * previous draft plus the findings and may edit ONLY the passages a
 * finding quotes. Un-targeted passages are verified byte-identical by
 * deterministic code (`verifySurgicalRevision`) — anything the model
 * "improved" on its own is reverted before the article is rendered.
 */

export interface ReviseFinding {
  id: string;
  code: string;
  severity: string;
  /** Verbatim passage from the draft the finding is about. */
  quote: string;
  description: string;
  recommendation: string;
}

/** Result of routing FACT_* findings through the research agent (#3). */
export interface ResearchNote {
  claim: string;
  verdict: "supported" | "unsupported" | "unclear";
  notes: string;
}

export interface ReviseInput {
  /** The rejected draft, as the drafter emitted it (structured form). */
  base: RawArticle;
  /** The rejected draft, as article.md (shown to the reviser). */
  baseMarkdown: string;
  findings: ReviseFinding[];
  researchNotes?: ResearchNote[];
  topic: string;
  audience: string;
  language: "zh-CN" | "en-US";
  duration: number;
  channelProfile?: string;
}

/** What the verifier did — surfaced for logging and tests. */
export interface ReviseAudit {
  /** False when the model changed section count/order or scene ids —
   * the whole revision is reverted and the caller should fall back to
   * full regeneration. */
  structurePreserved: boolean;
  revertedSections: number;
  revertedScenes: number;
  revertedTitle: boolean;
  revertedHook: boolean;
}

export interface CallReviseResult {
  markdown: string;
  raw: RawArticle;
  audit: ReviseAudit;
  usage: { input: number; output: number };
  providerName: string;
}

/** Body lives in `packages/prompts/prompts/draft-article-revise.md`. */
export const REVISE_SYSTEM_PROMPT = loadPrompt("draft-article-revise");

function sceneText(s: {
  caption?: string;
  visual?: string;
  narration?: string;
}): string {
  return [s.caption ?? "", s.visual ?? "", s.narration ?? ""].join("\n");
}

/** A finding targets a passage when its (trimmed) quote occurs in it. */
function targetedBy(text: string, findings: ReviseFinding[]): boolean {
  return findings.some(
    (f) => f.quote.trim().length >= 2 && text.includes(f.quote.trim()),
  );
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Enforce the surgical contract deterministically. Passages a finding
 * quotes may differ from the base; every other passage must be
 * byte-identical or it is reverted to the base version. Structure
 * changes (section count/order, scene ids) revert the WHOLE revision —
 * the caller treats that as "revision failed, regenerate instead".
 */
export function verifySurgicalRevision(
  base: RawArticle,
  next: RawArticle,
  findings: ReviseFinding[],
): { fixed: RawArticle; audit: ReviseAudit } {
  const baseScenes = base.scenes ?? [];
  const nextScenes = next.scenes ?? [];
  const structurePreserved =
    (base.sections ?? []).length === (next.sections ?? []).length &&
    baseScenes.length === nextScenes.length &&
    baseScenes.every((s, i) => nextScenes[i]?.id === s.id);

  if (!structurePreserved) {
    return {
      fixed: base,
      audit: {
        structurePreserved: false,
        revertedSections: (base.sections ?? []).length,
        revertedScenes: baseScenes.length,
        revertedTitle: false,
        revertedHook: false,
      },
    };
  }

  const audit: ReviseAudit = {
    structurePreserved: true,
    revertedSections: 0,
    revertedScenes: 0,
    revertedTitle: false,
    revertedHook: false,
  };

  const sections = (base.sections ?? []).map((b, i) => {
    const n = next.sections?.[i];
    const text = `${b.heading ?? ""}\n${b.body ?? ""}`;
    if (n !== undefined && (same(n, b) || targetedBy(text, findings))) return n;
    audit.revertedSections += 1;
    return b;
  });

  const scenes = baseScenes.map((b, i) => {
    const n = nextScenes[i];
    if (n !== undefined && (same(n, b) || targetedBy(sceneText(b), findings)))
      return n;
    audit.revertedScenes += 1;
    return b;
  });

  const fixed: RawArticle = { ...next, sections, scenes };
  if (next.title !== base.title && !targetedBy(base.title ?? "", findings)) {
    audit.revertedTitle = true;
    if (base.title === undefined) delete fixed.title;
    else fixed.title = base.title;
  }
  if (next.hook !== base.hook && !targetedBy(base.hook ?? "", findings)) {
    audit.revertedHook = true;
    if (base.hook === undefined) delete fixed.hook;
    else fixed.hook = base.hook;
  }

  return { fixed, audit };
}

export function buildReviseMessages(input: ReviseInput): ChatMessage[] {
  const userParts = [
    `Topic: ${input.topic}`,
    `Audience: ${input.audience}`,
    `Language: ${input.language}`,
    `Total duration target (seconds): ${input.duration}`,
    "\n## Current draft (rejected by the quality judge)",
    input.baseMarkdown,
    "\n## Findings to fix",
    ...input.findings.flatMap((f) => [
      `- [${f.id} | ${f.code} | ${f.severity}]`,
      `  Quote: ${JSON.stringify(f.quote)}`,
      `  Problem: ${f.description}`,
      `  Required fix: ${f.recommendation}`,
    ]),
  ];
  if (input.researchNotes && input.researchNotes.length > 0) {
    userParts.push(
      "\n## Fact-check research (verified — use these, cite nothing else)",
      ...input.researchNotes.flatMap((r) => [
        `- Claim: ${JSON.stringify(r.claim)}`,
        `  Verdict: ${r.verdict}`,
        `  Notes: ${r.notes}`,
      ]),
    );
  }
  userParts.push(
    "\nApply the surgical contract: fix ONLY the quoted passages, copy everything else through verbatim. Reply with ONLY the JSON object.",
  );
  return [
    {
      role: "system",
      content: withChannelBlock(
        REVISE_SYSTEM_PROMPT,
        input.channelProfile,
        "draft",
      ),
    },
    { role: "user", content: userParts.join("\n") },
  ];
}

export async function callRevise(
  input: ReviseInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallReviseResult> {
  const messages = buildReviseMessages(input);
  const r = await callStructured<RawArticle>({
    messages,
    provider,
    fallback: fallback ?? null,
    // Same tolerant parser discipline as the drafter (see callDraft).
    parse: (content) => {
      const body = extractJsonObject(content);
      if (body === null) throw new Error("no JSON object in response");
      try {
        return JSON.parse(body) as RawArticle;
      } catch (err) {
        throw new Error((err as Error).message, { cause: err });
      }
    },
    attempts: 2,
    nextAttempt: () => ({
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Your previous response was not valid JSON. Reply with ONLY a single JSON object — no prose, no code fence, no markdown.",
        },
      ],
    }),
    onFailure: (errors, providerName) => {
      const last = errors[errors.length - 1]!;
      return new DraftError(
        `revise JSON parse failed after retry: ${last.message}`,
        providerName,
        errors[0] ?? last,
      );
    },
  });

  const { fixed, audit } = verifySurgicalRevision(
    input.base,
    r.data,
    input.findings,
  );
  const frontmatter: DraftInput = {
    topic: input.topic,
    audience: input.audience,
    language: input.language,
    duration: input.duration,
    ...(input.channelProfile !== undefined
      ? { channelProfile: input.channelProfile }
      : {}),
  };
  return {
    markdown: renderArticleMd(frontmatter, fixed),
    raw: fixed,
    audit,
    usage: r.usage,
    providerName: r.providerName,
  };
}
