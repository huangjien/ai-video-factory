import type { ChatMessage, Provider } from "@vf/llm";
import { parse as parseYaml } from "yaml";
import {
  YouTubePackageSchema,
  type Chapter,
  type YouTubePackage,
} from "./schemas.js";

export interface YouTubeInput {
  storyboard: string;
  script: string;
  research: string;
}

export const SYSTEM_PROMPT = `You are the YouTube Automation Agent for the AI Video Factory.

Your ONLY job: produce a YouTube publishing package for a given (storyboard,
script, research) triple. The package is fully text — no images, no video.

Output: ONE fenced YAML code block (\`\`\`yaml ... \`\`\`) with EXACTLY these keys:
  title:            string (1-100 chars; SEO-friendly; localized to script language)
  description:      string (multi-line; include 2-5 hashtags at the bottom; cite research URLs)
  chapters:         list of {timestamp, title}  (timestamps in MM:SS format, in order)
  thumbnail_prompt: string (text description of the thumbnail image to design)
  shorts_hook:      string (text for a 60-second Shorts clip: hook + key claim)

Constraints:
- Title must NOT exceed 100 chars (YouTube limit).
- Chapters must be in MM:SS format and sorted by time.
- Thumbnail prompt describes what an image generator should produce — be
  concrete (background color, text overlay, focal element, mood).
- Shorts hook is a self-contained 60-second script beat.
- NO prose outside the YAML block.`;

export function buildYouTubeMessages(input: YouTubeInput): ChatMessage[] {
  const userParts = [
    "## Storyboard (VDSL)",
    input.storyboard.slice(0, 4000),
    "\n## Script (Markdown)",
    input.script.slice(0, 4000),
    "\n## Research (excerpt — sources for description citations)",
    input.research.slice(0, 2000),
    "\nProduce the YouTube package YAML.",
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}

export class YouTubeError extends Error {
  override readonly cause: unknown;
  constructor(message: string, public readonly providerName: string, cause?: unknown) {
    super(message);
    this.name = "YouTubeError";
    this.cause = cause;
  }
}

export interface CallYouTubeResult {
  youtube: YouTubePackage;
  usage: { input: number; output: number };
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
    return (
      (parts[0] ?? 0) * 3600 +
      (parts[1] ?? 0) * 60 +
      (parts[2] ?? 0)
    );
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
): Promise<CallYouTubeResult> {
  const messages = buildYouTubeMessages(input);
  const res = await provider.chat({ messages });
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new YouTubeError("no YAML in response", provider.name);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new YouTubeError(`YAML parse failed: ${(err as Error).message}`, provider.name, err);
  }
  const result = YouTubePackageSchema.safeParse(parsed);
  if (!result.success) {
    throw new YouTubeError(
      `YouTube package schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      provider.name,
      result.error,
    );
  }
  // Sanity: chapters sorted by timestamp — reject unsorted output.
  const ts = (s: string): number => {
    const parts = s.split(":").map((p) => Number.parseInt(p, 10));
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    return (
      (parts[0] ?? 0) * 3600 +
      (parts[1] ?? 0) * 60 +
      (parts[2] ?? 0)
    );
  };
  const sorted = [...result.data.chapters].sort((a, b) => ts(a.timestamp) - ts(b.timestamp));
  if (sorted.some((c, i) => c !== result.data.chapters[i])) {
    throw new YouTubeError(
      "chapters must be sorted by timestamp",
      provider.name,
    );
  }
  return { youtube: result.data, usage: res.usage };
}
