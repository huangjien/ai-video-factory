import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChatMessage, Provider } from "@video/llm";
import { loadPrompt } from "@video/prompts";
import {
  DEFAULT_IMAGE_STYLE,
  stylePromptSuffix,
  styleSystemBlock,
  resolveImageStyle,
  type ImageStyle,
} from "./image-style.js";

/**
 * v0.4 (T3) — image-prompt expansion for the MiniMax image provider.
 *
 * The article's `visual:` field is written for keyword-matching against
 * the `AnimatedIllustration` shape vocabulary — it's a one-liner under
 * 80 chars that mentions a category ("network of nodes", "a formula").
 * For real image generation (`image-01`), that's not enough: image
 * generators want subject + environment + lighting + composition + style.
 *
 * `expandScenePrompt` rewrites the visual line into one paragraph that
 * follows a fixed structure — subject, scene, composition, lighting,
 * style, constraints (see `prompts/draft-image-prompt.md`). It's a cheap
 * LLM call (≤MAX_BRIEF_CHARS, temperature 0.4) cached on a content hash so
 * re-runs are free.
 *
 * Cache layout:
 *   <projectRoot>/assets/images/.prompt-cache/<hash>.json
 *                  {prompt, model, generatedAt}
 *   <projectRoot>/assets/images/scene_<N>.prompt.txt
 */

/** Character budget for the LLM-authored part of the brief. The fixed
 *  structure needs room for six parts; 400 clipped mid-sentence and left
 *  the constraints — the overlay zone and the exclusions — unwritten.
 *  The style suffix is appended after this budget, not counted in it. */
const MAX_BRIEF_CHARS = 700;

/** Bumped whenever the expander prompt, this module's instruction text, or
 *  the stripping rules change in a way that should invalidate briefs already
 *  on disk. Two caches depend on it: the brief cache below, and the scene
 *  image cache in @video/make — a brief written by an older expander no
 *  longer describes the image that was generated from it.
 *  v2 — fixed the structure prompt; strips reasoning blocks before slicing. */
export const IMAGE_PROMPT_REVISION = "2";

/** Remove the reasoning scaffold that reasoning-enabled chat models emit
 *  ahead of their answer (`<think>…</think>`, an unterminated `<think>`,
 *  a stray `</think>`, and fenced wrappers).
 *
 *  This is not a cosmetic cleanup: without it the reasoning — not the
 *  scene — occupied the whole character budget, so the image model
 *  received truncated meta-commentary instead of the visual description.
 *  Every brief written by the pre-v2 path was affected. */
function extractBrief(content: string): string {
  let out = content;
  // Unterminated reasoning first: a budget-truncated response can leave a
  // `<think>` with no closing tag, in which case everything after it is
  // still reasoning and nothing is left but the throwaway.
  const lastOpen = out.lastIndexOf("<think>");
  if (lastOpen !== -1) {
    const close = out.indexOf("</think>", lastOpen);
    out = close === -1 ? "" : out.slice(close + "</think>".length);
  }
  out = out.replace(/<\/?think>/g, "");
  const fence = out.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) out = fence[1];
  return out
    .replace(/^\s*(?:here(?:'s| is)|the (?:image )?prompt(?: is)?|prompt)\s*[:—-]\s*/i, "")
    .replace(/^\s*(?:\*\*)?(?:prompt|brief)(?:\*\*)?\s*[:—-]\s*/i, "")
    .trim();
}

export interface ScenePromptInput {
  id: string;
  visual: string;
  caption?: string | undefined;
  narration?: string | undefined;
}

export interface ExpandedPrompt {
  prompt: string;
  model: string;
  cacheHit: boolean;
}

/** Body lives in `packages/prompts/prompts/draft-image-prompt.md` — edit it there. */
const SYSTEM_PROMPT = loadPrompt("draft-image-prompt");

/** Expand a single scene's visual direction into a real image prompt.
 *  Cheap LLM call; cached on disk; idempotent.
 *
 *  v0.6: `opts.style` (from article frontmatter `image_style:`) injects
 *  an image-style preset — composition rules into the system prompt and
 *  a verbatim style contract into the final prompt. The style is part
 *  of the cache key: switching styles re-expands. */
export async function expandScenePrompt(
  scene: ScenePromptInput,
  provider: Provider,
  projectRoot: string,
  sceneNumber: number,
  opts: { style?: ImageStyle; learned?: string } = {},
): Promise<ExpandedPrompt> {
  const style = opts.style !== undefined ? resolveImageStyle(opts.style) : DEFAULT_IMAGE_STYLE;
  const learned = opts.learned ?? "";
  const cacheKey = createHash("sha256");
  cacheKey.update(scene.visual ?? "");
  cacheKey.update("|");
  cacheKey.update(scene.caption ?? "");
  cacheKey.update("|");
  cacheKey.update((scene.narration ?? "").slice(0, 200));
  cacheKey.update("|");
  cacheKey.update(style);
  cacheKey.update("|");
  // Learned rules are part of the prompt contract, so they are part of
  // the identity of the prompt. Omitting this would let a prompt cached
  // before a lesson existed outlive every lesson ever recorded.
  cacheKey.update("|");
  cacheKey.update(learned);
  // Same argument for the expander itself: a reworded `draft-image-prompt.md`
  // must not keep serving briefs that were written by the previous wording.
  cacheKey.update("|");
  cacheKey.update(IMAGE_PROMPT_REVISION);
  const key = cacheKey.digest("hex").slice(0, 16);

  const cachePath = path.join(
    projectRoot,
    "assets",
    "images",
    ".prompt-cache",
    `${key}.json`,
  );
  if (existsSync(cachePath)) {
    try {
      const raw = await readFile(cachePath, "utf8");
      const parsed = JSON.parse(raw) as { prompt?: string; model?: string };
      if (typeof parsed.prompt === "string" && parsed.prompt.length > 0) {
        return {
          prompt: parsed.prompt,
          model: typeof parsed.model === "string" ? parsed.model : "unknown",
          cacheHit: true,
        };
      }
    } catch {
      // fall through to re-expansion
    }
  }

  const parts: string[] = [];
  parts.push(`Scene ID: ${scene.id}`);
  if (scene.caption) parts.push(`Caption (on-screen text): ${scene.caption}`);
  parts.push(`Visual direction: ${scene.visual}`);
  if (scene.narration) {
    parts.push(
      `Narration (the scene's content — DO NOT render any of its words): ${scene.narration.slice(0, 200)}`,
    );
  }
  parts.push(
    "",
    "Frame: 16:9 landscape, 1920x1080, a still that will move under a slow zoom or pan and carry caption overlays in the lower third.",
    "",
    "If the visual direction is a bare category or a narration fragment, invent the concrete subject, setting and action that make it visible. Write the brief in English, following the six parts in the system prompt, then output it alone.",
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        SYSTEM_PROMPT,
        styleSystemBlock(style),
        // Human-review lessons. Empty in the common case; the block is
        // omitted entirely rather than added as blank lines.
        ...(learned.trim() === "" ? [] : [learned.trim()]),
      ].join("\n\n"),
    },
    { role: "user", content: parts.join("\n") },
  ];

  const res = await provider.chat({ messages, temperature: 0.4 });
  // The verbatim style contract rides along even if the LLM drifts —
  // the image model always sees it. (Trim BEFORE the suffix so the
  // generated part keeps the size budget; the suffix is fixed.)
  const brief = extractBrief(res.content).slice(0, MAX_BRIEF_CHARS);
  const prompt = `${brief}\n${stylePromptSuffix(style)}`;
  const model = "expanded-via-llm";

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify({ prompt, model, generatedAt: new Date().toISOString() }),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "assets", "images", `scene_${sceneNumber}.prompt.txt`),
    prompt,
    "utf8",
  );
  return { prompt, model, cacheHit: false };
}