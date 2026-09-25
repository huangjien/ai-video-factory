import type { ChatMessage, Provider } from "@vf/llm";
import { chatWithFallback } from "@vf/llm";
import { buildMessages, type DraftInput } from "./prompt.js";

export class DraftError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "DraftError";
    this.cause = cause;
  }
}

export interface CallDraftResult {
  /** Assembled article.md (frontmatter + title + hook + sections + scenes). */
  markdown: string;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
}

interface RawArticle {
  title?: string;
  hook?: string;
  sections?: { heading?: string; body?: string }[];
  scenes?: {
    id?: string;
    duration?: number;
    caption?: string;
    visual?: string;
    narration?: string;
  }[];
}

export async function callDraft(
  input: DraftInput,
  provider: Provider,
  /** Optional fallback provider — when `provider` returns a quota /
   * rate-limit error, retry the request with `fallback` instead of
   * failing the run. */
  fallback?: Provider | null,
): Promise<CallDraftResult> {
  let res = await chatWithFallback(provider, fallback ?? null, {
    messages: buildMessages(input),
  });
  let parsed = tryParse(res.response.content);
  let lastErr: unknown;
  if (!parsed.ok) {
    lastErr = parsed.error;
    // Retry once with a tight reminder; LLMs occasionally emit prose
    // around the JSON on the first pass.
    const retryMessages: ChatMessage[] = [
      ...buildMessages(input),
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Reply with ONLY a single JSON object — no prose, no code fence, no markdown.",
      },
    ];
    const retry = await chatWithFallback(provider, fallback ?? null, {
      messages: retryMessages,
    });
    res = retry;
    parsed = tryParse(res.response.content);
    if (!parsed.ok) {
      throw new DraftError(
        `JSON parse failed after retry: ${(parsed.error as Error).message}`,
        res.provider,
        lastErr,
      );
    }
  }
  const markdown = renderArticleMd(input, parsed.value);
  return { markdown, usage: res.response.usage, providerName: res.provider };
}

/** Result of attempting to parse the LLM response into JSON. */
type ParseResult =
  | { ok: true; value: RawArticle }
  | { ok: false; error: unknown };

/** Tolerant parser — handles fenced JSON, surrounding prose, and minor
 * brace-mismatch errors by extracting the largest balanced JSON object. */
function tryParse(content: string): ParseResult {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: new Error("empty content") };

  // 1) Try the strict path first — exactly the response, optionally after
  //    stripping a code fence.
  for (const candidate of candidates(trimmed)) {
    try {
      return { ok: true, value: JSON.parse(candidate) as RawArticle };
    } catch (err) {
      // fall through to next candidate
      if (candidate === trimmed) {
        // No fence to strip — try the balanced extractor on the next pass.
        break;
      }
    }
  }

  // 2) Extract the largest balanced `{...}` substring and try that.
  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    try {
      return { ok: true, value: JSON.parse(balanced) as RawArticle };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  return { ok: false, error: new Error("no balanced JSON object in response") };
}

/** Possible JSON bodies to try, in order — full string, then stripped of
 * a single wrapping fence (the LLM often wraps responses in ```json). */
function candidates(text: string): string[] {
  const out = [text];
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const m = text.match(fence);
  if (m && m[1] !== undefined) out.push(m[1].trim());
  return out;
}

/** Find the first balanced JSON object substring. Handles strings
 * (with escape sequences), escaped backslashes, and nested objects.
 * Returns `null` if no balanced object is found. */
export function extractBalancedJson(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Compose article.md from a structured RawArticle — guaranteed shape; the
 * LLM is responsible for content quality, our code is responsible for the
 * markdown structure humans see. */
function renderArticleMd(input: DraftInput, r: RawArticle): string {
  const project = slugifyProjectName(input.topic);
  const language = input.language;
  const duration = input.duration;
  const voice = pickVoice(language);

  const sectionsBlock = (r.sections ?? []).flatMap((s, idx) => {
    if (!s.heading && !s.body) return [];
    return [
      `## ${idx + 1}. ${s.heading ?? "(待编辑)"}`,
      "",
      s.body ?? "<!-- 在这里写这一节的内容 -->",
      "",
    ];
  });

  const scenesBlock = [
    "## Scenes",
    "",
    "```yaml",
    "scenes:",
    ...(r.scenes ?? []).flatMap((s) => [
      `  - id: ${s.id ?? "scene_X"}`,
      `    duration: ${s.duration ?? 0}`,
      `    caption: ${yamlScalar(s.caption ?? "")}`,
      `    visual: ${yamlScalar(s.visual ?? "")}`,
      `    narration: |`,
      ...(s.narration ?? "")
        .split("\n")
        .map((line) => `      ${line}`),
    ]),
    "```",
    "",
  ].join("\n");

  const frontmatter = [
    "---",
    `project: ${project}`,
    `language: ${language}`,
    `duration_target_sec: ${duration}`,
    `voice: ${voice}`,
    "---",
    "",
  ].join("\n");

  return [
    frontmatter,
    `# ${r.title ?? input.topic}`,
    "",
    `> **Hook** (≤20s): ${r.hook ?? "(待编辑：在这一行写一句话开场)"}`,
    "",
    ...sectionsBlock,
    scenesBlock,
  ].join("\n");
}

function yamlScalar(s: string): string {
  if (/[:#\n]/g.test(s)) return JSON.stringify(s);
  if (s === "") return '""';
  return s;
}

// Default: male narration. Female alternatives: zh-CN-YunjianNeural,
// en-US-ChristopherNeural.
function pickVoice(lang: string): string {
  if (lang === "en-US") return "en-US-ChristopherNeural";
  return "zh-CN-YunjianNeural";
}

function slugifyProjectName(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project"
  );
}
