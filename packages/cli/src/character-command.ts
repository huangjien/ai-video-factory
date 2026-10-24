import type { Command } from "commander";
import { existsSync } from "node:fs";
import {
  approveCharacterReference,
  buildSheetPrompt,
  characterFilePath,
  listCharacterIds,
  loadCharacterById,
  loadCharacterProfile,
  nextVersionLabel,
  workspaceCharacterRoot,
  writeCandidateReference,
  resolveImageStyle,
  styleSystemBlock,
  type ApprovalOutcome,
  type CharacterProfile,
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
  return workspaceCharacterRoot(cwd);
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
 * The prompt belongs to the bible, not to this command: a second importer
 * of an externally drawn sheet must build the same one, and it is built
 * from the profile's anchors — no LLM in the loop. A reference sheet has
 * to be a faithful rendering of the ANCHORS, and an expander that
 * "improves" the description would defeat the point: the sheet is the
 * thing the anchors are checked against.
 */
export { buildSheetPrompt };

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
    const file = characterFilePath(root, id);
    if (!existsSync(file)) {
      console.error(`character: no profile at ${file}`);
      return 1;
    }
    // The rules of the review live in the bible module: the sheet must
    // exist, one official sheet per style, the previous one superseded
    // rather than deleted, and a superseded sheet never resurrected.
    let outcome: ApprovalOutcome;
    try {
      outcome = approveCharacterReference(
        root,
        id,
        style,
        version,
        opts.by.trim(),
      );
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      return 1;
    }
    console.log(
      `✓ ${id}: ${style}/${version} approved by ${outcome.approved.reviewedBy} (${outcome.approved.reviewedAt})`,
    );
    for (const r of outcome.superseded) {
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
    const file = characterFilePath(root, id);
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
    if (
      opts.variant !== undefined &&
      !profile.variants.some((v) => v.id === opts.variant)
    ) {
      console.error(
        `character: "${id}" has no variant "${opts.variant}" (has: ${profile.variants.map((v) => v.id).join(", ") || "none"})`,
      );
      return 1;
    }
    // The next free version — sheets are never overwritten.
    const version = opts.version ?? nextVersionLabel(profile, style);

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
    // The sheet is written and recorded as a 候选角色参考 by the bible
    // module: the file layout and the candidate record are its rules.
    const { file: out } = writeCandidateReference(
      root,
      id,
      style,
      version,
      bytes,
    );
    console.log(`✓ ${id}: ${style}/${version} candidate written to ${out}`);
    console.log(
      `  review the anchors against it, then: video character approve ${id} ${style} ${version} --by <name>`,
    );
    return 0;
  }

  console.error(
    `character: unknown subcommand "${sub}" — use list, sheet or approve`,
  );
  return 1;
}

export function registerCharacter(program: Command): void {
  program
    .command("character")
    .argument("[args...]", "list (default) | approve <id> <style> <version>")
    .option("--cwd <dir>", "workspace root holding assets/characters")
    .option("--by <name>", "reviewer recorded on an approval")
    .option(
      "--root <dir>",
      "character bible root (default: <cwd>/assets/characters)",
    )
    .option(
      "--style <style>",
      "art style for a generated sheet (see image-styles.yaml)",
    )
    .option(
      "--variant <id>",
      "appearance variant to draw (default: the base identity)",
    )
    .option(
      "--version <vN>",
      "version label for a generated sheet (default: the next free one)",
    )
    .option(
      "--provider <p>",
      "image provider for a generated sheet: minimax (default) | mock",
    )
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
