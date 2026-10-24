import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  approveReference,
  anchorPromptLines,
  CharacterProfileSchema,
  type CharacterProfile,
  type CharacterReference,
} from "./character-profile.js";
import { stylePromptSuffix, type ImageStyle } from "./image-style.js";

/**
 * The 角色圣经 on disk, and the 角色参考 lifecycle that moves a sheet from
 * 候选 to 正式.
 *
 * The rules that matter live here, not in a command:
 *
 *  - A sheet is a 候选角色参考 until a human approves it, and an approval
 *    records who reviewed it and when.
 *  - Only one 正式角色参考 exists per art style; approving a newer sheet
 *    supersedes the older one, which stays on disk.
 *  - An approved sheet must point at a file that exists — an approval of a
 *    missing image makes the official asset unusable, and the gap only
 *    shows up much later, in a generated frame.
 *  - Sheets are never overwritten; a new one takes the next free version.
 *
 * The on-disk shape is owned here too, so no caller spells out
 * `<root>/<id>/character.yaml` or `refs/<style>/<version>.jpg` itself.
 */

/** The bible lives at the WORKSPACE root, not inside a project: it is shared
 *  across films, which is the whole point of the bible. */
export function workspaceCharacterRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, "assets", "characters");
}

/**
 * The character bible a project sees, or null when it has none.
 *
 * A project under `<workspace>/projects/<id>` reaches the bible at
 * `<workspace>/assets/characters`. A project used standalone simply has no
 * bible rather than guessing at a path.
 */
export function characterRootFor(projectRoot: string): string | null {
  const parent = path.dirname(projectRoot);
  if (path.basename(parent) !== "projects") return null;
  const root = workspaceCharacterRoot(path.dirname(parent));
  return existsSync(root) ? root : null;
}

/** Where one character's profile lives. */
export function characterFilePath(root: string, id: string): string {
  return path.join(root, id, "character.yaml");
}

/** Where one reference sheet lives, absolute. */
export function referenceFilePath(
  root: string,
  id: string,
  style: string,
  version: string,
): string {
  return path.join(root, id, "refs", style, `${version}.jpg`);
}

/**
 * Every character id under `root`, sorted. A directory counts only when
 * it holds a character.yaml, so refs/ subfolders and stray files are
 * ignored rather than reported as broken characters.
 */
export function listCharacterIds(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(characterFilePath(root, name)))
    .sort();
}

export function loadCharacterProfile(file: string): CharacterProfile {
  return CharacterProfileSchema.parse(parseYaml(readFileSync(file, "utf8")));
}

/**
 * Load a character by id from a bible root, or undefined when it is not
 * there. A missing character is not an error: a scene may cite someone
 * who has no profile yet, and the prompt simply carries no anchors for
 * them.
 */
export function loadCharacterById(
  root: string | null,
  id: string,
): CharacterProfile | undefined {
  if (root === null) return undefined;
  const file = characterFilePath(root, id);
  if (!existsSync(file)) return undefined;
  return loadCharacterProfile(file);
}

/**
 * The next free version label for a style. Sheets are never overwritten,
 * so a new sheet takes the next unused `vN`.
 */
export function nextVersionLabel(
  profile: CharacterProfile,
  style: string,
): string {
  const used = new Set(
    profile.references.filter((r) => r.style === style).map((r) => r.version),
  );
  let n = 1;
  while (used.has(`v${n}`)) n++;
  return `v${n}`;
}

/**
 * Build the image prompt for a character reference sheet.
 *
 * Straight from the profile's anchors — no LLM in the loop. A reference
 * sheet has to be a faithful rendering of the ANCHORS, and an expander
 * that "improves" the description would defeat the point: the sheet is
 * the thing the anchors are checked against.
 */
export function buildSheetPrompt(
  profile: CharacterProfile,
  style: ImageStyle,
  variantId?: string,
): string {
  const anchors = anchorPromptLines(profile, variantId);
  const variantLabel =
    variantId === undefined
      ? "base identity"
      : (profile.variants.find((v) => v.id === variantId)?.label ?? variantId);
  // The style SYSTEM block is written for the LLM expander (it teaches a
  // six-part brief structure) and runs ~2.9k characters — the image API
  // accepts 1500. The image model only needs the style SUFFIX, which
  // carries the same palette and the no-text rules.
  //
  // "Sheet" and "on paper" are deliberately NOT used: the model reads
  // them as a traditional 工笔 character sheet, which is an ARTWORK on
  // paper and therefore gets a calligraphy inscription, a seal and a
  // date — the exact text leak the no-text rules exist to stop. Asking
  // for a plain portrait instead is what actually keeps it unsigned.
  return [
    `Character portrait: ${profile.name}, ${variantLabel}.`,
    `Setting: ${profile.identity.era_region}${profile.identity.role ? `, ${profile.identity.role}` : ""}.`,
    "Reproduce these identity anchors exactly:",
    ...anchors.map((a) => `- ${a}`),
    "A plain single-figure portrait, one figure only, facing the viewer, upper body and the costume clearly visible, on a plain even background.",
    "A plain illustration, not a framed artwork: no calligraphy, no inscription, no seal, no red stamp, no signature, no artist mark, no date, no border, no characters of any language.",
    stylePromptSuffix(style),
  ].join("\n");
}

export interface CandidateWrite {
  /** The profile as it now stands, with the new candidate recorded. */
  profile: CharacterProfile;
  /** The absolute path of the sheet that was written. */
  file: string;
}

/**
 * Record a freshly generated sheet as a 候选角色参考.
 *
 * A fresh sheet is always a candidate: it becomes official only through
 * `approveCharacterReference`, after a human has checked the anchors.
 */
export function writeCandidateReference(
  root: string,
  id: string,
  style: string,
  version: string,
  bytes: Uint8Array,
): CandidateWrite {
  const file = characterFilePath(root, id);
  const profile = loadCharacterProfile(file);
  const out = referenceFilePath(root, id, style, version);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const references = profile.references.filter(
    (r) => !(r.style === style && r.version === version),
  );
  references.push({
    style,
    version,
    status: "candidate" as const,
    file: path.posix.join("refs", style, `${version}.jpg`),
  });
  const updated = CharacterProfileSchema.parse({ ...profile, references });
  writeFileSync(file, yamlStringify(updated), "utf8");
  return { profile: updated, file: out };
}

export interface ApprovalOutcome {
  /** The profile as it now stands. */
  profile: CharacterProfile;
  /** The sheet that is now the 正式角色参考 for its style. */
  approved: CharacterReference;
  /** The sheets it replaced. They stay on disk. */
  superseded: CharacterReference[];
}

/**
 * Promote a 候选角色参考 to the 正式角色参考 for its style.
 *
 * Throws when the reference does not exist, when its image is missing, or
 * when the sheet is already approved or was superseded — an approval that
 * cannot be honoured is reported, never silently ignored.
 */
export function approveCharacterReference(
  root: string,
  id: string,
  style: string,
  version: string,
  reviewer: string,
  reviewedAt: string = new Date().toISOString(),
): ApprovalOutcome {
  const file = characterFilePath(root, id);
  if (!existsSync(file)) {
    throw new Error(`no character profile at ${file}`);
  }
  const profile = loadCharacterProfile(file);
  const target = profile.references.find(
    (r) => r.style === style && r.version === version,
  );
  if (target === undefined) {
    throw new Error(`character "${id}" has no reference ${style}/${version}`);
  }
  // The sheet must actually exist: approving a reference to a missing
  // image would make the official asset unusable, and the gap would
  // only show up much later, in a generated frame.
  const imagePath = path.join(root, id, target.file);
  if (!existsSync(imagePath)) {
    throw new Error(
      `${style}/${version} points at a missing file: ${imagePath} — generate the candidate sheet first`,
    );
  }
  const updated = approveReference(
    profile,
    style,
    version,
    reviewer,
    reviewedAt,
  );
  writeFileSync(file, yamlStringify(updated), "utf8");
  const approved = updated.references.find(
    (r) => r.style === style && r.version === version,
  );
  if (approved === undefined) {
    throw new Error(
      `character "${id}" has no reference ${style}/${version} after approval`,
    );
  }
  return {
    profile: updated,
    approved,
    superseded: updated.references.filter(
      (r) => r.style === style && r.status === "superseded",
    ),
  };
}
