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
 *  overlay / poster / dashboard instead of a real scene. The validator
 *  scans the lowercased prompt for any of these substrings. */
const BANNED_TOKENS = [
  "text",
  "subtitle",
  "subtitles",
  "watermark",
  "logo",
  "caption",
  "caption:",
  "title text",
  "bold text",
  "大字",
  "字幕",
  "标志",
  "logo文字",
  "标题",
  "海报",
  "海报风格",
  "屏幕截图",
  "截图",
  "仪表盘",
  "界面",
];

export function hasTextOverlay(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return BANNED_TOKENS.some((tok) => lower.includes(tok.toLowerCase()));
}
