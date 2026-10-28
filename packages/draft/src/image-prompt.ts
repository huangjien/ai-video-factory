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
import {
  identityDigest,
  resolveSceneIdentities,
  type SceneIdentity,
} from "./scene-identity.js";

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

/** Hard ceiling on the WHOLE prompt, brief + style suffix.
 *
 *  The provider enforces this, not us: `MiniMaxImageProvider` rejects a
 *  prompt over 1500 characters rather than spending a request on a 400. The
 *  budget used to cover only the brief, on the reasoning that the suffix is
 *  fixed and therefore not the expander's problem — which is exactly how
 *  `isometric` (a long suffix) pushed three skills-first scenes to 1561-1613
 *  characters and silently dropped them from the render. Budget against the
 *  provider's limit and slice the brief to whatever is left over. */
const MAX_PROMPT_CHARS = 1500;

/** Ceiling for the LLM-authored part alone, used when the suffix is short
 *  enough that the provider limit is not the binding constraint. The fixed
 *  structure needs room for six parts; 400 clipped mid-sentence and left the
 *  constraints — the overlay zone and the exclusions — unwritten. The prompt
 *  asks for 500-1000 characters, so this only bites on a runaway response. */
const MAX_BRIEF_CHARS = 1400;

/** Bumped whenever the expander prompt, this module's instruction text, or
 *  the stripping rules change in a way that should invalidate briefs already
 *  on disk. Two caches depend on it: the brief cache below, and the scene
 *  image cache in @video/make — a brief written by an older expander no
 *  longer describes the image that was generated from it.
 *  v2 — fixed the structure prompt; strips reasoning blocks before slicing. */
// v4 — six labelled output lines (Subject/Scene/Composition/Lighting/Style/
// Constraints) + materials guidance. v3 was the era anchoring; briefs written
// as a single paragraph must not survive the format change.
// v6 — flat-vector contract merge: "simple silhouettes" + "no 3D rendering,
// no glossy surfaces" in the suffix, and the flat-shadow nuance in the system
// block. The suffix is stored inside every cached brief, so a preset change
// must invalidate the cache the same way an expander change does.
// v7 — visual direction is now a vivid art-direction line (~80-220 chars),
// not a thin category hint. Briefs written from sparse directions need to be
// re-expanded under the new contract so the still matches the article.
// v8 — the no-text rule now draws the line at READABILITY, not at the
// presence of marks: illegible page texture and unreadable seals pass, a
// viewer-readable sign or title does not. The rule text is injected into
// the expander's system message, so briefs written under the old wording
// would keep asking for the old thing.
// v12 — whiteboard preset rewritten: one focal diagram per frame, accent
// discipline (blue only on the narration's element), connector grammar,
// anti-thin-ink wording. Same failure the suffix-storage rule covers: a
// preset change must invalidate the brief cache.
// v13 — whiteboard preset states its palette lock again. The v12 rewrite
// folded the palette into the accent bullet and dropped the literal
// "Locked palette:" contract the prompts contract test enforces on every
// preset; the colors are unchanged (same three hex values, same
// reuse-in-every-scene rule), but the preset text feeds the expander's
// system message, so the brief cache must invalidate as it does for any
// other preset edit.
export const IMAGE_PROMPT_REVISION = "13";

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
    .replace(
      /^\s*(?:here(?:'s| is)|the (?:image )?prompt(?: is)?|prompt)\s*[:—-]\s*/i,
      "",
    )
    .replace(/^\s*(?:\*\*)?(?:prompt|brief)(?:\*\*)?\s*[:—-]\s*/i, "")
    .trim();
}

export interface ScenePromptInput {
  id: string;
  visual: string;
  caption?: string | undefined;
  narration?: string | undefined;
  /** CS-12: characters on screen, cited by character-bible id and
   *  optional appearance variant. Their anchors are spliced into the
   *  brief so the same person reads the same across scenes. */
  characters?: { id: string; variant?: string | undefined }[] | undefined;
}

/** Everything the expander knows that is not per-scene: the style preset, the
 *  human-review lessons, and the setting (era + region + culture). */
export interface ScenePromptContext {
  style?: ImageStyle | undefined;
  learned?: string | undefined;
  /** Declared era/region/culture for the whole video, from article.md
   *  frontmatter `setting:` — e.g. "Tang-dynasty China, 626 CE". Without it
   *  the expander only has the narration to guess from, which is how a Tang
   *  court scene ends up rendered in Western medieval armour. */
  setting?: string | undefined;
  /** CS-12: the 关键视觉锚点 for the characters this scene cites, already
   *  resolved against the 角色圣经 by `resolveSceneIdentities`.
   *
   *  The brief names the resolved identities, not the bible path: there is
   *  one way to say who is in the scene, so the anchors cannot be dropped
   *  on one path and kept on another. */
  identities?: readonly SceneIdentity[] | undefined;
}

/** What `expandScenePrompt` needs beyond the brief context: where the
 *  角色圣经 lives. It resolves the identities itself and hands them to the
 *  brief, so the cache key and the brief body come from one resolution. */
export interface ExpandSceneOptions extends Omit<
  ScenePromptContext,
  "identities"
> {
  /** CS-12: the character bible root. Null when the project is not under
   *  a workspace `projects/` dir, or no bible exists. */
  characterRoot?: string | null | undefined;
}

/** Body lives in `packages/prompts/prompts/draft-image-prompt.md` — edit it there. */
const SYSTEM_PROMPT = loadPrompt("draft-image-prompt");

/** The exact messages handed to the expander. Extracted from
 *  `expandScenePrompt` so it can be asserted directly in tests and driven by
 *  the prompt-eval harness without touching the filesystem or a provider. */
export function buildScenePromptMessages(
  scene: ScenePromptInput,
  context: ScenePromptContext = {},
): ChatMessage[] {
  const style =
    context.style !== undefined
      ? resolveImageStyle(context.style)
      : DEFAULT_IMAGE_STYLE;
  const learned = context.learned ?? "";
  const setting = context.setting?.trim() ?? "";

  const parts: string[] = [];
  parts.push(`Scene ID: ${scene.id}`);
  if (setting !== "") {
    // Placed above the visual direction on purpose: the visual line is a bare
    // category hint and reads as era-neutral, so the setting has to arrive
    // before the model decides what a "mounted courier" looks like.
    parts.push(
      `Setting (the whole video is set here — era, region and culture; every brief must stay inside it): ${setting}`,
    );
  }
  if (scene.caption) parts.push(`Caption (on-screen text): ${scene.caption}`);
  parts.push(`Visual direction: ${scene.visual}`);
  // CS-12: the character bible's anchors, spliced in as text. The image
  // model takes NO reference image (MiniMax has no subject_reference), so
  // the anchors ARE the consistency mechanism — they must be in the brief
  // or the same person drifts between scenes.
  for (const identity of context.identities ?? []) {
    if (identity.anchorLines.length === 0) continue;
    const label = identity.variant === "" ? "base identity" : identity.variant;
    parts.push(
      `Character "${identity.name}" (${identity.id}, ${label}) — reproduce these identity anchors EXACTLY, and keep this the same person as in every other scene:`,
      ...identity.anchorLines.map((a) => `  - ${a}`),
    );
  }
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

  return [
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
}

export interface ExpandedPrompt {
  prompt: string;
  model: string;
  cacheHit: boolean;
}

/**
 * The pure half of the expander: build messages, call the provider, trim to the
 * brief budget, append the verbatim style contract. No filesystem, no cache —
 * which is what makes it drivable from the prompt-eval harness and directly
 * testable. `expandScenePrompt` is this plus cache and sidecar writes.
 */
export async function expandSceneBrief(
  scene: ScenePromptInput,
  provider: Provider,
  context: ScenePromptContext = {},
): Promise<{ prompt: string; providerName: string }> {
  const style =
    context.style !== undefined
      ? resolveImageStyle(context.style)
      : DEFAULT_IMAGE_STYLE;
  const messages = buildScenePromptMessages(scene, context);
  const res = await provider.chat({ messages, temperature: 0.4 });
  // The verbatim style contract rides along even if the LLM drifts —
  // the image model always sees it. Trim the brief so the ASSEMBLED prompt
  // fits the provider's ceiling: a long style suffix must not push the total
  // past what the API accepts.
  const suffix = stylePromptSuffix(style);
  const briefBudget = Math.min(
    MAX_BRIEF_CHARS,
    MAX_PROMPT_CHARS - suffix.length - 1,
  );
  const brief = extractBrief(res.content).slice(0, briefBudget);
  return {
    prompt: `${brief}\n${suffix}`,
    providerName: provider.name,
  };
}

export async function expandScenePrompt(
  scene: ScenePromptInput,
  provider: Provider,
  projectRoot: string,
  sceneNumber: number,
  opts: ExpandSceneOptions = {},
): Promise<ExpandedPrompt> {
  const style =
    opts.style !== undefined
      ? resolveImageStyle(opts.style)
      : DEFAULT_IMAGE_STYLE;
  const learned = opts.learned ?? "";
  // CS-12: resolve the 关键视觉锚点 ONCE. The cache key and the brief body
  // are then the same facts about who is in the scene. Before, the key
  // hashed the 角色圣经 while the brief silently dropped it, so a cached
  // brief could carry no anchors at all — the identity of the prompt and
  // the content of the prompt were derived separately.
  const identities = resolveSceneIdentities(
    scene.characters,
    opts.characterRoot ?? null,
  );
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
  cacheKey.update(learned);
  // Same for the declared setting: it changes what the brief is allowed to
  // say about era, dress and appearance, so a brief written under one
  // setting must never be reused under another.
  cacheKey.update("|");
  cacheKey.update(opts.setting ?? "");
  // CS-12: the character anchors are part of the brief's identity. A
  // cached brief written before an anchor changed (or before a variant
  // was picked) would silently keep the old face, so the anchors go
  // into the key — not just the character id.
  cacheKey.update("|");
  cacheKey.update(identityDigest(identities));
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

  const { prompt } = await expandSceneBrief(scene, provider, {
    style,
    learned,
    setting: opts.setting,
    identities,
  });
  const model = "expanded-via-llm";

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify({ prompt, model, generatedAt: new Date().toISOString() }),
    "utf8",
  );
  await writeFile(
    path.join(
      projectRoot,
      "assets",
      "images",
      `scene_${sceneNumber}.prompt.txt`,
    ),
    prompt,
    "utf8",
  );
  return { prompt, model, cacheHit: false };
}
