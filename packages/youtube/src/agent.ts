import type { ChatMessage, Provider } from "@video/llm";
import { chatWithFallback } from "@video/llm";
import { parse as parseYaml } from "yaml";
import {
  YouTubePackageSchema,
  type Chapter,
  type YouTubePackage,
} from "./schemas.js";
import { buildYouTubeMessages, type YouTubeInput } from "./prompt.js";

export { SYSTEM_PROMPT } from "./prompt.js";

export class YouTubeError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "YouTubeError";
    this.cause = cause;
  }
}

export interface CallYouTubeResult {
  youtube: YouTubePackage;
  usage: { input: number; output: number };
  /** Name of the provider that actually served the request
   * (primary or its fallback, per `chatWithFallback`). */
  providerName: string;
  /** The exact messages sent to the provider — lets callers hash the
   * real prompt for run-record `prompt_hash`. */
  messages: ChatMessage[];
}

export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

/** Convert a chapters array to WebVTT format for upload. Each chapter's
 * end-time is the next chapter's start (or +1s for the last one). */
export function chaptersToVtt(chapters: Chapter[]): string {
  const ts = (s: string): number => {
    const parts = s.split(":").map((p) => Number.parseInt(p, 10));
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  };
  const fmt = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const lines = ["WEBVTT", ""];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (!ch) continue;
    const next = chapters[i + 1];
    const endTs = next ? ts(next.timestamp) : ts(ch.timestamp) + 1;
    lines.push(`${fmt(ts(ch.timestamp))} --> ${fmt(endTs)}`);
    lines.push(ch.title);
    lines.push("");
  }
  return lines.join("\n");
}

export async function callYouTube(
  input: YouTubeInput,
  provider: Provider,
  fallback?: Provider | null,
): Promise<CallYouTubeResult> {
  const messages = buildYouTubeMessages(input);
  const out = await chatWithFallback(provider, fallback ?? null, { messages });
  const res = out.response;
  const actualProvider = out.provider;
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new YouTubeError("no YAML in response", actualProvider);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new YouTubeError(
      `YAML parse failed: ${(err as Error).message}`,
      actualProvider,
      err,
    );
  }
  const result = YouTubePackageSchema.safeParse(parsed);
  if (!result.success) {
    throw new YouTubeError(
      `YouTube package schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      actualProvider,
      result.error,
    );
  }
  // Sanity: chapters sorted by timestamp — reject unsorted output.
  const ts = (s: string): number => {
    const parts = s.split(":").map((p) => Number.parseInt(p, 10));
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  };
  const sorted = [...result.data.chapters].sort(
    (a, b) => ts(a.timestamp) - ts(b.timestamp),
  );
  if (sorted.some((c, i) => c !== result.data.chapters[i])) {
    throw new YouTubeError(
      "chapters must be sorted by timestamp",
      actualProvider,
    );
  }
  if (hasTextOverlay(result.data.thumbnail_prompt)) {
    throw new YouTubeError(
      "thumbnail_prompt contains banned tokens (text/字幕/字体/logo/标题/海报) — re-prompt with stricter negative constraints",
      actualProvider,
      { thumbnail_prompt: result.data.thumbnail_prompt },
    );
  }
  return {
    youtube: result.data,
    usage: res.usage,
    providerName: actualProvider,
    messages,
  };
}

/** v0.4 (T4): banned tokens that indicate the LLM is describing a text
 *  overlay / poster / dashboard instead of a real scene.
 *
 *  Two refinements (2026-10-18, live-verified): the prompt template tells
 *  the model "NEVER include text, subtitles, watermarks, logos…", so a
 *  COMPLIANT English brief says "no text, no lettering" — scanning raw
 *  substrings rejected it and blocked packaging on both providers. ASCII
 *  tokens therefore match on word boundaries (so "texture" and "context"
 *  pass), and negated mentions are stripped before the scan. CJK has no
 *  word boundaries, so those stay substring matches. */
const NEGATED_MENTION =
  /\b(?:no|without|zero|never|free of|devoid of)\s+(?:visible\s+|readable\s+|legible\s+)?(?:text|lettering|letters|typography|captions?|subtitles?|words|writing|labels?)\b/gi;

const ASCII_BANNED_TOKENS = [
  "text",
  "subtitle",
  "subtitles",
  "watermark",
  "logo",
  "caption",
  "captions",
];

const CJK_BANNED_TOKENS = [
  "大字",
  "字幕",
  "标志",
  "logo文字",
  "海报",
  "海报风格",
  "屏幕截图",
  "截图",
  "仪表盘",
  "界面",
];
// 标题 is deliberately NOT here: the prompt template REQUIRES a brief to
// name the quiet region it reserves for the title ("留给后期排印标题"),
// so banning the word rejected a compliant brief every time. The template
// already forbids describing a real text overlay in far stronger terms.

/** zh negation cue. A compliant zh brief ends with "无任何文字、字母、
 *  数字、标志或水印", so the banned noun sits inside a negation. */
const CJK_NEGATION = /无|没有|不含|不要|不得|不带|不出现|零/;

/** Characters of look-back in which a zh negation excuses a banned noun
 *  (long enough to cover "无任何文字、字母、数字、标志", short enough
 *  that "标题在左上角，无字幕" still fails on 标题). */
const CJK_LOOKBACK = 30;

function cjkTokenAllowed(lower: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(token, from);
    if (idx === -1) return true; // token absent entirely
    const before = lower.slice(Math.max(0, idx - CJK_LOOKBACK), idx);
    if (!CJK_NEGATION.test(before)) return false;
    from = idx + token.length;
  }
}

export function hasTextOverlay(prompt: string): boolean {
  const lower = prompt.toLowerCase().replace(NEGATED_MENTION, " ");
  if (
    ASCII_BANNED_TOKENS.some((tok) =>
      new RegExp(`\\b${tok}\\b`, "i").test(lower),
    )
  ) {
    return true;
  }
  return CJK_BANNED_TOKENS.some((tok) => !cjkTokenAllowed(lower, tok));
}
