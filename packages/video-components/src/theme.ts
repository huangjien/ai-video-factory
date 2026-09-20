/**
 * `dark-tech` is the project-level theme (doc §25). Tokens are concrete so
 * components read them through this single source — agents must never invent
 * colors or fonts (§62.4 line 2298: no missing fonts / off-theme renders).
 */
export const darkTechTheme = {
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
  /** Remotion easing keyword — components use this for all entrance tweens. */
  defaultEasing: "inOut-cubic",
  fonts: {
    title: "Noto Sans SC",
    body: "Noto Sans SC",
    code: "JetBrains Mono",
  },
} as const;

export type Theme = typeof darkTechTheme;
