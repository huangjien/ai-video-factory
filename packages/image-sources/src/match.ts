import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { z } from "zod/v3";
import type { SourceMode } from "./types.js";

/**
 * Matching a subject to the pictures an archive returned.
 *
 * The archive matches STRINGS. A query for 李治 can return
 * "Gaozong of Song.jpg" — a portrait of a Song-dynasty emperor with the
 * same temple name — and no string comparison can tell the difference.
 * The subject's name may be in Chinese while the file title is in English.
 *
 * So the picture that reaches the frame is chosen by an LLM that can read
 * both, in ONE call for the whole video. A wrong picture on screen is
 * worse than no picture — the scene falls back to being generated — so
 * the matcher is allowed to answer "none".
 */

/** Body lives in `packages/prompts/prompts/image-source-match.md`. */
const SYSTEM_PROMPT = loadPrompt("image-source-match");

/** One picture offered to the matcher. */
export interface MatchCandidate {
  title: string;
  source: string;
  pageUrl: string;
}

export interface SceneCandidates {
  scene: number;
  /** The real historical thing the scene shows, in any language. */
  subject: string;
  mode: SourceMode;
  candidates: MatchCandidate[];
}

const MatchSchema = z.object({
  scene: z.number().int().positive(),
  /** Index into the candidate list, or -1 for "none of these". */
  pick: z.number().int(),
  reason: z.string().default(""),
});

const MatchesSchema = z.object({
  matches: z.array(MatchSchema),
});

export class ImageSourceMatchError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ImageSourceMatchError";
    this.cause = cause;
  }
}

/** The exact messages handed to the matcher. */
export function buildMatchMessages(scenes: SceneCandidates[]): ChatMessage[] {
  const lines: string[] = [];
  for (const scene of scenes) {
    lines.push(`Scene ${scene.scene} — subject: ${scene.subject}`);
    if (scene.candidates.length === 0) {
      lines.push("  (no picture was found)");
      continue;
    }
    scene.candidates.forEach((candidate, index) => {
      lines.push(
        `  [${index}] ${candidate.title} (${candidate.source}) — ${candidate.pageUrl}`,
      );
    });
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/**
 * Ask the matcher which picture belongs to which scene. Returns a map of
 * scene number → candidate index (-1 when the scene gets no picture).
 *
 * A failed call returns an empty map — the caller then falls back to the
 * token-scored pick. A missing picture is never fatal.
 */
export async function matchSceneSources(
  scenes: SceneCandidates[],
  provider: Provider,
  fallback?: Provider | null,
): Promise<Map<number, number>> {
  const answerable = scenes.filter((s) => s.candidates.length > 0);
  if (answerable.length === 0) return new Map();
  const r = await callStructuredAgent({
    messages: buildMatchMessages(answerable),
    provider,
    fallback: fallback ?? null,
    schema: MatchesSchema,
    schemaLabel: "Image source match schema",
    toError: (message, providerName, cause) =>
      new ImageSourceMatchError(message, providerName, cause),
  });
  const out = new Map<number, number>();
  for (const entry of r.data.matches) {
    const scene = scenes.find((s) => s.scene === entry.scene);
    if (scene === undefined) continue;
    const count = scene.candidates.length;
    // An index outside the list is not a pick — the scene gets nothing.
    out.set(entry.scene, entry.pick >= 0 && entry.pick < count ? entry.pick : -1);
  }
  return out;
}
