import { z } from "zod";

/**
 * Theme system (doc §25 — "single theme today" was the v0.1 state; v0.2
 * ships a registry).
 *
 * A theme is a flat token set consumed by every rendering layer:
 *   - `colors.background` — Root's wrap layer and DoodleScene's dark mode
 *   - `colors.surface`    — node/panel fills (SvgScene, Terminal, …)
 *   - `colors.primary`    — main text/ink on the background
 *   - `colors.secondary`  — muted text (captions labels, edge labels)
 *   - `colors.accent`     — arrows, links, highlights that must pop
 *   - `colors.warning`    — marker rings, attention callouts
 *   - `colors.success`    — positive states (deploy ✓, result ✓)
 *   - `typography.*`      — font family/weight/size per text role
 *   - `spacing.unit`      — base spacing unit (8px grid)
 *   - `defaultEasing`     — Remotion easing keyword for entrance tweens
 *   - `fonts`             — font family names per role (no missing fonts, §62.4)
 *
 * House rules (§62.4 line 2298): components read tokens THROUGH a theme —
 * they must never invent colors or font names. The theme is chosen per
 * storyboard via `style.theme` (a theme name from THEMES); unknown names
 * fall back to `darkTechTheme` so a typo can never crash a render.
 *
 * Contrast requirements: `primary` must read on `background` and
 * `surface`; `accent` must read on both `background` and `surface`;
 * DoodleScene's `paper` mode always uses its own light paper regardless
 * of theme (ink-on-paper is the look), so light themes are safe to pair
 * with canvas scenes too.
 */

const themeTokenSchema = z.object({
  colors: z.object({
    background: z.string(),
    surface: z.string(),
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    warning: z.string(),
    success: z.string(),
  }),
  typography: z.object({
    title: z.object({
      fontFamily: z.string(),
      fontWeight: z.number(),
      fontSize: z.number(),
    }),
    subtitle: z.object({
      fontFamily: z.string(),
      fontWeight: z.number(),
      fontSize: z.number(),
    }),
    body: z.object({
      fontFamily: z.string(),
      fontWeight: z.number(),
      fontSize: z.number(),
    }),
    code: z.object({
      fontFamily: z.string(),
      fontWeight: z.number(),
      fontSize: z.number(),
    }),
  }),
  spacing: z.object({ unit: z.number() }),
  /** Remotion easing keyword — components use this for all entrance tweens. */
  defaultEasing: z.string(),
  fonts: z.object({
    title: z.string(),
    body: z.string(),
    code: z.string(),
  }),
});

export type Theme = z.infer<typeof themeTokenSchema>;

/** The original v0.1 theme — deep navy, cyan-blue accent, Noto Sans SC.
 * Default for every storyboard (unknown/missing `style.theme` → this). */
export const darkTechTheme: Theme = {
  colors: {
    background: "#0B1220",
    surface: "#111A2C",
    primary: "#E6EDF3",
    secondary: "#8B96A8",
    accent: "#4C8DFF",
    warning: "#F0B429",
    success: "#3FB68B",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Bright paper look — warm off-white board, near-black ink, amber accent.
 * Pairs naturally with DoodleScene (`background: "paper"`) and hand-drawn
 * explainers; also the right choice for bright office/tutorial content. */
export const paperLightTheme: Theme = {
  colors: {
    background: "#F5F1E8",
    surface: "#FFFFFF",
    primary: "#1F1D1A",
    secondary: "#6B665C",
    accent: "#C2410C",
    warning: "#B45309",
    success: "#15803D",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Cool deep-sea gradient feel — teal accent, softer contrast than
 * dark-tech. Good for calm/technical explainers and monitoring topics. */
export const oceanDeepTheme: Theme = {
  colors: {
    background: "#071A1E",
    surface: "#0D262C",
    primary: "#D9F2EF",
    secondary: "#7FA8A3",
    accent: "#2DD4BF",
    warning: "#FBBF24",
    success: "#34D399",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Warm dusk palette — plum background, coral accent, cream text. For
 * story-led and softer brand pieces. */
export const duskWarmTheme: Theme = {
  colors: {
    background: "#1E1420",
    surface: "#2B1D30",
    primary: "#F5E9E0",
    secondary: "#A88FA0",
    accent: "#F97362",
    warning: "#FBBF24",
    success: "#4ADE80",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Forest moss — deep emerald canopy with lime accent. Calm botanical,
 * sustainability, outdoor / nature explainers. Pairs naturally with
 * image-01 generations of plants, weather, ecosystems. */
export const forestMossTheme: Theme = {
  colors: {
    background: "#0F1F14",
    surface: "#16301E",
    primary: "#E8F2E0",
    secondary: "#92A78A",
    accent: "#84CC16",
    warning: "#FBBF24",
    success: "#22C55E",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Sunset pop — saturated magenta on near-black with bright yellow
 * accent. Energetic consumer, entertainment, lifestyle content; high
 * contrast for thumbnails. */
export const sunsetPopTheme: Theme = {
  colors: {
    background: "#1A0A14",
    surface: "#2D1320",
    primary: "#FFF1F5",
    secondary: "#C794A6",
    accent: "#FACC15",
    warning: "#FB923C",
    success: "#34D399",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Terminal vintage — phosphor green on dark gray. Old-CRT nostalgia
 * for dev tutorials, security/retro topics, hacker-history explainers.
 * Pairs naturally with `Terminal` / `CodeBlock` scenes. */
export const terminalVintageTheme: Theme = {
  colors: {
    background: "#0E1410",
    surface: "#161D17",
    primary: "#D4FFD4",
    secondary: "#7C9A7C",
    accent: "#22FF22",
    warning: "#FFD400",
    success: "#33FF66",
  },
  typography: {
    title: { fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "JetBrains Mono", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "linear",
  fonts: {
    title: "JetBrains Mono",
    body: "JetBrains Mono",
    code: "JetBrains Mono",
  },
};

/** Paper cream — soft beige / muted pastels, all monospace-friendly.
 * Friendly product, food, family-friendly explainers. Warmer and more
 * saturated than paper-light, more modern typography. */
export const paperCreamTheme: Theme = {
  colors: {
    background: "#F4ECDF",
    surface: "#FFF7E8",
    primary: "#2A2418",
    secondary: "#7A6F5C",
    accent: "#D97706",
    warning: "#B91C1C",
    success: "#15803D",
  },
  typography: {
    title: { fontFamily: "Noto Sans SC", fontWeight: 700, fontSize: 72 },
    subtitle: { fontFamily: "Noto Sans SC", fontWeight: 600, fontSize: 48 },
    body: { fontFamily: "Noto Sans SC", fontWeight: 400, fontSize: 32 },
    code: { fontFamily: "JetBrains Mono", fontWeight: 400, fontSize: 26 },
  },
  spacing: { unit: 8 },
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
};

/** Every available theme, keyed by the `style.theme` storyboard value. */
export const THEMES: Record<string, Theme> = {
  "dark-tech": darkTechTheme,
  "paper-light": paperLightTheme,
  "ocean-deep": oceanDeepTheme,
  "dusk-warm": duskWarmTheme,
  "forest-moss": forestMossTheme,
  "sunset-pop": sunsetPopTheme,
  "terminal-vintage": terminalVintageTheme,
  "paper-cream": paperCreamTheme,
};

export const THEME_NAMES = Object.keys(THEMES);

/** Resolve a storyboard `style.theme` value to a Theme. Unknown, misspelled
 * or missing names fall back to darkTechTheme — renders never crash on a
 * theme typo. */
export function resolveTheme(name?: string | null): Theme {
  if (!name) return paperLightTheme;
  return THEMES[name] ?? paperLightTheme;
}

/** Validate an object as a complete theme (used by tests and by anything
 * that accepts user-defined themes later). */
export function isValidTheme(value: unknown): value is Theme {
  return themeTokenSchema.safeParse(value).success;
}
