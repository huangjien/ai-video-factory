import { anchorPromptLines } from "./character-profile.js";
import { loadCharacterById } from "./character-bible.js";

/**
 * One cited character in one scene, with the 关键视觉锚点 that keep the same
 * person on screen across every 叙事画.
 *
 * The image model takes no reference image (MiniMax has no
 * `subject_reference`), so this text IS the consistency mechanism. That makes
 * it worth resolving exactly once and handing the result to everything that
 * needs it — the brief body and the prompt cache key alike.
 */
export interface SceneIdentity {
  /** The 角色圣经 id the scene cites. */
  id: string;
  /** The 外观变体 the scene cites, or "" for the base identity. */
  variant: string;
  /** The character's name, as the 角色圣经 records it. */
  name: string;
  /** One line per 关键视觉锚点, in a stable order. */
  anchorLines: string[];
}

/**
 * Resolve the 关键视觉锚点 for the characters a scene cites.
 *
 * This is the only place the 角色圣经 is read for prompt purposes. Resolve
 * once, then feed the result to both the brief body and the cache key — a
 * brief and the key that identifies it are then the same facts, and cannot
 * disagree about who is in the scene.
 *
 * A citation with no profile is not an error: a scene may name someone who
 * has no 角色档案 yet. That character simply contributes nothing.
 */
export function resolveSceneIdentities(
  citations:
    readonly { id: string; variant?: string | undefined }[] | undefined,
  characterRoot: string | null,
): SceneIdentity[] {
  if (citations === undefined || characterRoot === null) return [];
  const identities: SceneIdentity[] = [];
  for (const citation of citations) {
    const profile = loadCharacterById(characterRoot, citation.id);
    if (profile === undefined) continue;
    identities.push({
      id: citation.id,
      variant: citation.variant ?? "",
      name: profile.name,
      anchorLines: anchorPromptLines(profile, citation.variant),
    });
  }
  return identities;
}

/**
 * The resolved identities as one stable string.
 *
 * Feeds the prompt cache key. Hashing the character id alone would be wrong:
 * the anchors are what actually reach the image model, so an edited anchor
 * must invalidate the cached brief. A character with no profile contributes
 * nothing — the scene simply has no anchors.
 */
export function identityDigest(identities: readonly SceneIdentity[]): string {
  return identities
    .map(
      (identity) =>
        `${identity.id}@${identity.variant}:` + identity.anchorLines.join("|"),
    )
    .join(";");
}
