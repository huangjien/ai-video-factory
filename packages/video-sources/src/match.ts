import type { ChatMessage, Provider } from "@video/llm";
import { callStructuredAgent } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import { z } from "zod/v3";

/**
 * Matching a subject to the clips an archive returned.
 *
 * Same problem as the picture matcher: the archive matches STRINGS. A
 * query for a 1944 carrier battle can return a 1969 training film with a
 * similar title. One LLM call for the whole video decides which clip is
 * really the subject; a wrong clip on screen is worse than no clip, so
 * the matcher may answer "none".
 */

/** Body lives in `packages/prompts/prompts/video-source-match.md`. */
const SYSTEM_PROMPT = loadPrompt("video-source-match");

/** One clip offered to the matcher. */
export interface VideoMatchCandidate {
  title: string;
  source: string;
  pageUrl: string;
  durationSec: number | null;
}

export interface SceneVideoCandidates {
  scene: number;
  /** The real historical thing the scene shows, in any language. */
  subject: string;
  candidates: VideoMatchCandidate[];
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

export class VideoSourceMatchError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "VideoSourceMatchError";
    this.cause = cause;
  }
}

/** The exact messages handed to the matcher. */
export function buildVideoMatchMessages(
  scenes: SceneVideoCandidates[],
): ChatMessage[] {
  const lines: string[] = [];
  for (const scene of scenes) {
    lines.push(`Scene ${scene.scene} — subject: ${scene.subject}`);
    if (scene.candidates.length === 0) {
      lines.push("  (no clip was found)");
      continue;
    }
    scene.candidates.forEach((candidate, index) => {
      const dur =
        candidate.durationSec !== null
          ? ` [${Math.round(candidate.durationSec)} s]`
          : "";
      lines.push(
        `  [${index}] ${candidate.title}${dur} (${candidate.source}) — ${candidate.pageUrl}`,
      );
    });
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/**
 * Ask the matcher which clip belongs to which scene. Returns a map of
 * scene number → candidate index (-1 when the scene gets no clip).
 *
 * A failed call returns an empty map — the caller then falls back to the
 * token-scored pick. A missing clip is never fatal.
 */
export async function matchSceneVideos(
  scenes: SceneVideoCandidates[],
  provider: Provider,
): Promise<Map<number, number>> {
  const answerable = scenes.filter((s) => s.candidates.length > 0);
  if (answerable.length === 0) return new Map();
  const r = await callStructuredAgent({
    messages: buildVideoMatchMessages(answerable),
    provider,
    fallback: null,
    schema: MatchesSchema,
    schemaLabel: "Video source match schema",
    toError: (message, providerName, cause) =>
      new VideoSourceMatchError(message, providerName, cause),
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
