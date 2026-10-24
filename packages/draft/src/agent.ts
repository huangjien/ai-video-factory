import type { Provider } from "@video/llm";
import {
  callStructured,
  extractBalancedJson as extractBalancedJsonImpl,
  extractJsonObject,
} from "@video/llm";
import { buildMessages, type DraftInput } from "./prompt.js";

/** Shared balanced-JSON extractor (@video/llm) — re-exported because the
 *  quality judge (article-review.ts) and the drafter tests import it from
 *  this package's surface. */
export function extractBalancedJson(text: string): string | null {
  return extractBalancedJsonImpl(text);
}

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
  const messages = buildMessages(input);
  const r = await callStructured<RawArticle>({
    messages,
    provider,
    fallback: fallback ?? null,
    // Tolerant parser — the shared extractor handles fenced JSON,
    // surrounding prose, and a minor brace mismatch by taking the largest
    // balanced object, with the reasoning stripped first. A reasoning
    // model emits its thinking before the answer, and that thinking
    // contains a JSON SKETCH: reading the whole response — or the largest
    // balanced object in it — reads the sketch, not the answer.
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
    // Retry once with a tight reminder; LLMs occasionally emit prose
    // around the JSON on the first pass.
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
        `JSON parse failed after retry: ${last.message}`,
        providerName,
        errors[0] ?? last,
      );
    },
  });
  const markdown = renderArticleMd(input, r.data);
  return { markdown, usage: r.usage, providerName: r.providerName };
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
      ...(s.narration ?? "").split("\n").map((line) => `      ${line}`),
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
