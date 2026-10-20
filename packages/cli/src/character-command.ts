import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import {
  approveReference,
  anchorPromptLines,
  listCharacterIds,
  loadCharacterById,
  loadCharacterProfile,
  resolveImageStyle,
  stylePromptSuffix,
  styleSystemBlock,
  CharacterProfileSchema,
  type CharacterProfile,
  type ImageStyle,
} from "@video/draft";
import {
  MiniMaxImageProvider,
  MockImageProvider,
} from "@video/media-generators";
import { brandBannerLine } from "./ui.js";

/**
 * `video character` — the character bible's review workflow (CS-13).
 *
 *   video character list                     → every character and its
 *                                                reference sheets
 *   video character approve <id> <style> <ver> --by <name>
 *                                             → promote a candidate to
 *                                                the official sheet for
 *                                                that art style
 *
 * The approval is a deliberate, recorded act: it stamps who reviewed the
 * sheet and when, and it supersedes the previous official sheet rather
 * than overwriting it. A candidate is never an official asset until this
 * runs.
 */

/** Default bible root: the WORKSPACE's assets/characters, so the bible is
 *  shared across films. */
export function defaultCharacterRoot(cwd = process.cwd()): string {
  return path.join(cwd, "assets", "characters");
}

export interface CharacterListLine {
  character: string;
  name: string;
  variants: number;
  references: string;
}

/** Pure formatter for the listing — unit-testable without the filesystem. */
export function formatCharacterList(
  profiles: CharacterProfile[],
): CharacterListLine[] {
  return profiles.map((p) => ({
    character: p.id,
    name: p.name,
    variants: p.variants.length,
    references:
      p.references.length === 0
        ? "—"
        : p.references
            .map((r) => `${r.style}/${r.version} ${r.status}`)
            .join("  "),
  }));
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

export interface CharacterCommandOptions {
  cwd?: string | undefined;
  /** Reviewer recorded on the approval. */
  by?: string | undefined;
  /** Override the bible root (defaults to <cwd>/assets/characters). */
  root?: string | undefined;
  /** Art style for a generated sheet (must be a known image_style). */
  style?: string | undefined;
  /** Image provider: minimax (default) | mock | none. */
  provider?: string | undefined;
  /** Appearance variant to draw. */
  variant?: string | undefined;
  /** Version label for a generated sheet (default: the next free one). */
  version?: string | undefined;
}

export async function runCharacter(
  args: string[],
  opts: CharacterCommandOptions = {},
): Promise<number> {
  const root = opts.root ?? defaultCharacterRoot(opts.cwd ?? process.cwd());
  const [sub, ...rest] = args;

  if (sub === undefined || sub === "list") {
    if (!existsSync(root)) {
      console.error(`character: no character bible at ${root}`);
      return 1;
    }
    const ids = listCharacterIds(root);
    if (ids.length === 0) {
      console.log(`character: no characters under ${root}`);
      return 0;
    }
    const profiles = ids
      .map((id) => loadCharacterById(root, id))
      .filter((p): p is CharacterProfile => p !== undefined);
    console.log(brandBannerLine());
    for (const line of formatCharacterList(profiles)) {
      console.log(
        `  ${line.character.padEnd(18)} ${line.name.padEnd(10)} variants=${line.variants}  ${line.references}`,
      );
    }
    return 0;
  }

  if (sub === "approve") {
    const [id, style, version] = rest;
    if (!id || !style || !version) {
      console.error(
        "character: approve needs <id> <style> <version> — e.g. `video character approve li_shimin gongbi v1 --by <name>`",
      );
      return 1;
    }
    if (!opts.by || opts.by.trim() === "") {
      console.error(
        "character: approve needs --by <name> — an approval without a reviewer is not a review",
      );
      return 1;
    }
    const file = path.join(root, id, "character.yaml");
    if (!existsSync(file)) {
      console.error(`character: no profile at ${file}`);
      return 1;
    }
    const profile = loadCharacterProfile(file);
    // The sheet must actually exist: approving a reference to a missing
    // image would make the official asset unusable, and the gap would
    // only show up much later, in a generated frame.
    const target = profile.references.find(
      (r) => r.style === style && r.version === version,
    );
    if (target === undefined) {
      console.error(
        `✗ character "${id}" has no reference ${style}/${version}`,
      );
      return 1;
    }
    const imagePath = path.join(root, id, target.file);
    if (!existsSync(imagePath)) {
      console.error(
        `✗ ${style}/${version} points at a missing file: ${imagePath} — generate the candidate sheet first`,
      );
      return 1;
    }
    let updated: CharacterProfile;
    try {
      updated = approveReference(profile, style, version, opts.by.trim());
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      return 1;
    }
    writeFileSync(file, yamlStringify(updated), "utf8");
    const approved = updated.references.find(
      (r) => r.style === style && r.version === version,
    );
    console.log(
      `✓ ${id}: ${style}/${version} approved by ${approved?.reviewedBy} (${approved?.reviewedAt})`,
    );
    const superseded = updated.references.filter(
      (r) => r.style === style && r.status === "superseded",
    );
    for (const r of superseded) {
      console.log(`  previous ${r.version} → superseded (kept on disk)`);
    }
    return 0;
  }

  if (sub === "sheet") {
    const [id, style] = rest;
    if (!id || !style) {
      console.error(
        "character: sheet needs <id> <style> — e.g. `video character sheet li_shimin gongbi`",
      );
      return 1;
    }
    const file = path.join(root, id, "character.yaml");
    if (!existsSync(file)) {
      console.error(`character: no profile at ${file}`);
      return 1;
    }
    const profile = loadCharacterProfile(file);
    const resolvedStyle = resolveImageStyle(style);
    if (resolvedStyle !== style) {
      console.error(
        `character: unknown style "${style}" — run \`video prompts show image-styles.yaml\` for the list`,
      );
      return 1;
    }
    if (opts.variant !== undefined && !profile.variants.some((v) => v.id === opts.variant)) {
      console.error(
        `character: "${id}" has no variant "${opts.variant}" (has: ${profile.variants.map((v) => v.id).join(", ") || "none"})`,
      );
      return 1;
    }
    // The next free version — sheets are never overwritten.
    const used = new Set(
      profile.references.filter((r) => r.style === style).map((r) => r.version),
    );
    let n = 1;
    while (used.has(`v${n}`)) n++;
    const version = opts.version ?? `v${n}`;

    const provider =
      (opts.provider ?? "minimax") === "mock"
        ? new MockImageProvider()
        : new MiniMaxImageProvider();
    const prompt = buildSheetPrompt(profile, resolvedStyle, opts.variant);
    let bytes: Uint8Array;
    try {
      const result = await provider.generate({
        prompt,
        width: 1024,
        height: 1024,
      });
      bytes = result.bytes;
    } catch (err) {
      console.error(`✗ sheet generation failed: ${(err as Error).message}`);
      return 1;
    }
    const dir = path.join(root, id, "refs", style);
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${version}.jpg`);
    writeFileSync(out, bytes);
    // A fresh sheet is always a CANDIDATE: it becomes official only through
    // `video character approve`, after a human has checked the anchors.
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
    console.log(
      `✓ ${id}: ${style}/${version} candidate written to ${out}`,
    );
    console.log(
      `  review the anchors against it, then: video character approve ${id} ${style} ${version} --by <name>`,
    );
    return 0;
  }

  console.error(`character: unknown subcommand "${sub}" — use list, sheet or approve`);
  return 1;
}

export function registerCharacter(program: Command): void {
  program
    .command("character")
    .argument(
      "[args...]",
      "list (default) | approve <id> <style> <version>",
    )
    .option("--cwd <dir>", "workspace root holding assets/characters")
    .option("--by <name>", "reviewer recorded on an approval")
    .option("--root <dir>", "character bible root (default: <cwd>/assets/characters)")
    .option("--style <style>", "art style for a generated sheet (see image-styles.yaml)")
    .option("--variant <id>", "appearance variant to draw (default: the base identity)")
    .option("--version <vN>", "version label for a generated sheet (default: the next free one)")
    .option("--provider <p>", "image provider for a generated sheet: minimax (default) | mock")
    .action(
      async (
        args: string[],
        opts: {
          cwd?: string;
          by?: string;
          root?: string;
          style?: string;
          variant?: string;
          version?: string;
          provider?: string;
        },
      ) => {
        process.exitCode = await runCharacter(args, {
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.by !== undefined ? { by: opts.by } : {}),
          ...(opts.root !== undefined ? { root: opts.root } : {}),
          ...(opts.style !== undefined ? { style: opts.style } : {}),
          ...(opts.variant !== undefined ? { variant: opts.variant } : {}),
          ...(opts.version !== undefined ? { version: opts.version } : {}),
          ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
        });
      },
    );
}
