import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * IartSkillAdapter (plan T4.1, AD-5, Principle 4) — the ONLY module in the
 * codebase that knows where agent skills live and how to read them. Skills
 * are procedural knowledge (markdown); their guidance text may be handed to
 * LLM agents (T4.2 Motion Agent), but their formats never leak into core
 * schemas — everything machine-usable is encoded in heuristics.ts.
 *
 * When the skills directory is missing (offline, slim checkout), every
 * adapter method degrades to null and callers fall back to the built-in
 * heuristics — planSceneMotion() is pure and needs no skills at all.
 */

export interface SkillGuidance {
  name: string;
  /** SKILL.md body with the YAML frontmatter stripped. */
  body: string;
}

export class IartSkillAdapter {
  constructor(private readonly skillDirs: string[]) {}

  /** Standard locations: the skills CLI's universal dir and our first-party
   * dir (plan §32's skills/), most-specific first. */
  static fromProjectRoot(projectRoot: string): IartSkillAdapter {
    return new IartSkillAdapter([
      path.join(projectRoot, ".agents", "skills"),
      path.join(projectRoot, "skills"),
    ]);
  }

  isAvailable(name: string): boolean {
    return this.skillDirs.some((dir) =>
      existsSync(path.join(dir, name, "SKILL.md")),
    );
  }

  /** Full SKILL.md body (frontmatter stripped), or null when the skill is
   * not installed — the AD-5 fallback signal. */
  async loadSkillGuidance(name: string): Promise<SkillGuidance | null> {
    for (const dir of this.skillDirs) {
      const file = path.join(dir, name, "SKILL.md");
      if (!existsSync(file)) continue;
      const raw = await readFile(file, "utf8");
      return { name, body: stripFrontmatter(raw) };
    }
    return null;
  }
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  return markdown.slice(markdown.indexOf("\n", end + 1) + 1);
}
