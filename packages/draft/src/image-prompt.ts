import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChatMessage, Provider } from "@vf/llm";

/**
 * v0.4 (T3) — image-prompt expansion for the MiniMax image provider.
 *
 * The article's `visual:` field is written for keyword-matching against
 * the `AnimatedIllustration` shape vocabulary — it's a one-liner under
 * 80 chars that mentions a category ("network of nodes", "a formula").
 * For real image generation (`image-01`), that's not enough: image
 * generators want subject + environment + lighting + composition + style.
 *
 * `expandScenePrompt` rewrites the visual line into a 2-3 sentence
 * image prompt with that structure. It's a cheap LLM call (≤400 chars,
 * temperature 0.4) cached on a content hash so re-runs are free.
 *
 * Cache layout:
 *   <projectRoot>/assets/images/.prompt-cache/<hash>.json
 *                  {prompt, model, generatedAt}
 *   <projectRoot>/assets/images/scene_<N>.prompt.txt
 */

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

const SYSTEM_PROMPT = `You rewrite a one-line visual direction into an image-generation prompt.

Subject · environment · lighting · composition · style. Under 400 characters. No prose, no preamble.

Hard rules:
- NEVER include text, subtitles, watermarks, logos, captions, titles, or brand names in the image.
- NEVER include abstract phrases like "interesting visuals", "dramatic background", or "modern technology".
- Output ONLY the prompt text. No markdown, no code fence.`;

/** Expand a single scene's visual direction into a real image prompt.
 *  Cheap LLM call; cached on disk; idempotent. */
export async function expandScenePrompt(
  scene: ScenePromptInput,
  provider: Provider,
  projectRoot: string,
  sceneNumber: number,
): Promise<ExpandedPrompt> {
  const cacheKey = createHash("sha256");
  cacheKey.update(scene.visual ?? "");
  cacheKey.update("|");
  cacheKey.update(scene.caption ?? "");
  cacheKey.update("|");
  cacheKey.update((scene.narration ?? "").slice(0, 200));
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
      `Narration (for mood/tone only — DO NOT render the words): ${scene.narration.slice(0, 200)}`,
    );
  }
  parts.push(
    "\nRewrite the visual direction into a 2-3 sentence image prompt. Subject · environment · lighting · composition · style. Under 400 characters.",
  );
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];

  const res = await provider.chat({ messages, temperature: 0.4 });
  const prompt = res.content.trim().slice(0, 400);
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