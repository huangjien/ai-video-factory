import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  THEME_NAMES,
  THEMES,
  isValidTheme,
  resolveTheme,
} from "@video/video-components";
import { brandBannerLine, channelHeader } from "./ui.js";

/**
 * `video theme` — palette inspector (operator UX).
 *
 *   video theme                 → list every theme with a colored swatch
 *   video theme <name>          → full palette for one theme
 *   video theme --cwd <root>    → resolve style.theme from a project's
 *                                  storyboard.yaml and print that palette
 *
 * The output here is PURE: every line is built by a non-side-effect
 * function so it can be unit-tested. `runTheme` only does the I/O
 * (console.log, exit code).
 */

// ─── Formatters (pure) ────────────────────────────────────────────────────────

/**
 * Background-colored swatch: two spaces filled with the hex color, ANSI
 * truecolor. Falls back to plain text when NO_COLOR is set (per the
 * https://no-color.org convention) so tests and CI logs stay readable.
 */
export function paint(hex: string, text = "  "): string {
  if (process.env["NO_COLOR"] || !hex.startsWith("#") || hex.length !== 7) {
    return text;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m${text}\x1b[0m`;
}

/** Short mood label per theme — used in the index for the "what's it for" column. */
const MOOD: Record<string, string> = {
  "dark-tech": "deep navy / tutorial",
  "paper-light": "warm paper / hand-drawn",
  "ocean-deep": "calm teal / monitoring",
  "dusk-warm": "plum / story-led",
  "forest-moss": "emerald / nature",
  "sunset-pop": "magenta / lifestyle",
  "terminal-vintage": "CRT phosphor / dev",
  "paper-cream": "beige / friendly product",
  "ai-red": "player dark / creator",
};

/** Compact index: one row per theme with a swatch. */
export function themeIndex(): string {
  const banner = brandBannerLine();
  const header = channelHeader(`themes · ${THEME_NAMES.length} available`, "index");
  const lines: string[] = [banner, header, ""];
  for (const name of THEME_NAMES) {
    const t = THEMES[name];
    if (!t) continue;
    const swatch = paint(t.colors.background, "  ") + paint(t.colors.accent, "  ");
    const mood = MOOD[name] ?? "";
    lines.push(`  ${swatch} ${name.padEnd(18)} ${t.colors.background} bg · ${t.colors.accent} accent${mood ? `  · ${mood}` : ""}`);
  }
  lines.push("");
  lines.push("Run `video theme <name>` for the full palette.");
  return lines.join("\n");
}

/** Full palette for one theme. Returns "" if the name is unknown. */
export function themeDetail(name: string): string {
  const t = resolveTheme(name);
  // resolveTheme falls back to paper-light on typos — for the inspector we
  // want to be honest about the unknown name instead of showing a fall-back.
  if (name && !THEMES[name]) {
    return `${brandBannerLine()}\n${channelHeader(name, "theme — unknown")}\n\n  Unknown theme. Available: ${THEME_NAMES.join(", ")}\n`;
  }
  const banner = brandBannerLine();
  const header = channelHeader(name, "theme");
  const headerBlock = [banner, header, ""].join("\n");
  return headerBlock + paletteRows(t, name);
}

/** Palette rows only (no banner/header) — composable by `themeFromProject`. */
function paletteRows(t: ReturnType<typeof resolveTheme>, name: string): string {
  const colorRow = (label: string, hex: string) =>
    `  ${paint(hex, "  ")} ${label.padEnd(11)} ${hex}`;
  return [
    `  Mood · ${MOOD[name] ?? "—"}`,
    "",
    colorRow("background", t.colors.background),
    colorRow("surface", t.colors.surface),
    colorRow("primary", t.colors.primary),
    colorRow("secondary", t.colors.secondary),
    colorRow("accent", t.colors.accent),
    colorRow("warning", t.colors.warning),
    colorRow("success", t.colors.success),
    "",
    `  title  ${t.typography.title.fontFamily} ${t.typography.title.fontWeight} @ ${t.typography.title.fontSize}px`,
    `  body   ${t.typography.body.fontFamily} ${t.typography.body.fontWeight} @ ${t.typography.body.fontSize}px`,
    `  code   ${t.fonts.code}`,
    "",
    `  ${isValidTheme(t) ? "✓ token set valid" : "✗ token set INVALID"}`,
  ].join("\n");
}

/** Read a project's storyboard.yaml and return the resolved theme detail. */
export function themeFromProject(root: string): string {
  const storyboardPath = path.join(root, "storyboard", "storyboard.yaml");
  if (!existsSync(storyboardPath)) {
    return `${brandBannerLine()}\n${channelHeader("project — none", "no storyboard.yaml")}\n\n  No storyboard found at ${storyboardPath}.\n`;
  }
  try {
    const raw = readFileSync(storyboardPath, "utf8");
    const parsed = parseYaml(raw) as { style?: { theme?: string } } | null;
    const themeName = parsed?.style?.theme;
    if (!themeName) {
      // No theme → just say so (paper-light is the default but we don't
      // need to dump the whole palette — the user can run `video theme
      // paper-light` to see it).
      return `${brandBannerLine()}\n${channelHeader(path.basename(root), "paper-light (default)")}\n\n  storyboard.yaml has no style.theme — defaulting to paper-light. Run \`video theme paper-light\` for the palette.\n`;
    }
    return `${brandBannerLine()}\n${channelHeader(path.basename(root), themeName)}\n\n${paletteRows(resolveTheme(themeName), themeName)}`;
  } catch {
    return `${brandBannerLine()}\n${channelHeader(root, "project — corrupt")}\n\n  storyboard.yaml could not be parsed (run \`video validate\` to see why).\n`;
  }
}

// ─── Runner (I/O) ────────────────────────────────────────────────────────────

export interface ThemeOptions {
  /** Optional theme name — omit to print the full index. */
  name?: string;
  /** Project root — read style.theme from this project's storyboard. */
  cwd?: string;
}

export function runTheme(opts: ThemeOptions): number {
  if (opts.cwd) {
    const root = path.resolve(opts.cwd);
    console.log(themeFromProject(root));
    return 0;
  }
  if (opts.name) {
    console.log(themeDetail(opts.name));
    // resolveTheme never crashes; we surface a non-zero exit when the
    // user asked for an unknown name so scripts can detect a typo.
    return THEMES[opts.name] ? 0 : 1;
  }
  console.log(themeIndex());
  return 0;
}
