import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { OWNED_LICENSE } from "../license.js";
import type {
  HistoricalCandidate,
  PictureSearchOptions,
  PictureSource,
} from "../types.js";

/**
 * Pictures the project already owns.
 *
 * Two places:
 *  1. the workspace character bible's reference sheets
 *     (`assets/characters/<id>/refs/<style>/vN.jpg`) — approved artwork of
 *     the film's own characters, and today the ONLY reference images in the
 *     repo that nothing consumes. They inform a generated frame (the model
 *     draws the same face), but they never BECOME the frame: putting the
 *     cast sheet on screen would show the drawing, not the person.
 *  2. the project's placed figures (`assets/figures/`) — assets somebody
 *     put there for this film. They may be the frame itself.
 *
 * The project's EARLIER SCENE IMAGES are deliberately NOT candidates:
 * reusing one would put another scene's art in this scene's frame, and
 * the candidate set would grow during the run — which would change the
 * image cache key on every re-run for no reason.
 *
 * No network, no license question: these are the project's own bytes, so
 * they carry the `OWNED` marker and skip the free-license filter.
 */

export interface ArtifactPictureSourceOptions {
  projectRoot: string;
  /** The workspace root (the dir that CONTAINS `projects/`). Null when the
   *  project does not live under one. */
  workspaceRoot: string | null;
  /** Maximum candidates returned. */
  limit?: number | undefined;
}

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ownedCandidate(
  filePath: string,
  title: string,
  query: string,
  directEligible: boolean,
): HistoricalCandidate | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return null;
    return {
      source: "artifact",
      title,
      pageUrl: filePath,
      fileUrl: "",
      localPath: filePath,
      author: "ai-video-factory (project-owned)",
      license: OWNED_LICENSE,
      licenseUrl: "",
      width: null,
      height: null,
      // The content hash is part of the key: a re-rendered character sheet
      // must invalidate the scene that borrowed it.
      digestKey: `${filePath}|${fileSha256(filePath)}`,
      query,
      owned: true,
      directEligible,
    };
  } catch {
    return null;
  }
}

export class ArtifactPictureSource implements PictureSource {
  readonly name = "artifact" as const;
  readonly offline = true;
  private readonly projectRoot: string;
  private readonly workspaceRoot: string | null;
  private readonly limit: number;

  constructor(opts: ArtifactPictureSourceOptions) {
    this.projectRoot = opts.projectRoot;
    this.workspaceRoot = opts.workspaceRoot;
    this.limit = opts.limit ?? 20;
  }

  async search(
    query: string,
    _opts: PictureSearchOptions,
  ): Promise<HistoricalCandidate[]> {
    // The placed figures come first: an asset somebody put in the project
    // on purpose is worth more than a cast sheet.
    const out: HistoricalCandidate[] = [];
    for (const c of this.figures()) out.push(c);
    for (const c of this.characterSheets()) out.push(c);
    return out.slice(0, this.limit);
  }

  /** `<workspace>/assets/characters/<id>/refs/<style>/<file>` */
  private characterSheets(): HistoricalCandidate[] {
    if (this.workspaceRoot === null) return [];
    const root = path.join(this.workspaceRoot, "assets", "characters");
    if (!existsSync(root)) return [];
    const out: HistoricalCandidate[] = [];
    let ids: string[];
    try {
      ids = readdirSync(root);
    } catch {
      return [];
    }
    for (const id of ids) {
      const refsDir = path.join(root, id, "refs");
      if (!existsSync(refsDir)) continue;
      let styles: string[];
      try {
        styles = readdirSync(refsDir);
      } catch {
        continue;
      }
      for (const style of styles) {
        const styleDir = path.join(refsDir, style);
        let files: string[];
        try {
          files = readdirSync(styleDir);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) continue;
          const c = ownedCandidate(
            path.join(styleDir, file),
            `${this.characterName(id)} reference sheet (${style})`,
            "",
            // A cast sheet informs the model; it is never the frame.
            false,
          );
          if (c !== null) out.push(c);
        }
      }
    }
    return out;
  }

  /** The character's own name ("李世民"), so a Chinese query matches the
   *  sheet the way it matches a catalogued file. Falls back to the id. */
  private characterName(id: string): string {
    try {
      const raw = readFileSync(
        path.join(this.workspaceRoot as string, "assets", "characters", id, "character.yaml"),
        "utf8",
      );
      const parsed = parseYaml(raw) as { name?: string } | null;
      const name = parsed?.name;
      return typeof name === "string" && name.trim() !== "" ? name.trim() : id;
    } catch {
      return id;
    }
  }

  /** `<project>/assets/figures/*` */
  private figures(): HistoricalCandidate[] {
    const dir = path.join(this.projectRoot, "assets", "figures");
    if (!existsSync(dir)) return [];
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      return [];
    }
    const out: HistoricalCandidate[] = [];
    for (const file of files.sort()) {
      if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) continue;
      const c = ownedCandidate(
        path.join(dir, file),
        path.parse(file).name,
        "",
        // An asset somebody placed in the project is meant to be shown.
        true,
      );
      if (c !== null) out.push(c);
    }
    return out;
  }
}
