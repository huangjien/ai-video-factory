/**
 * The 样片主题 registry — the one place a theme name, the default theme,
 * and the per-theme metadata live.
 *
 * The theme is a cross-cutting invariant: the storyboard writer, the
 * schema, the compiler, the CLI and the renderer must all agree on it.
 * CONTEXT.md names `paper-light` as the 样片's theme and lists "项目、分镜
 * 和渲染使用互不一致的主题" as a thing to avoid — so the default and the
 * registry belong to ONE module, below every one of those packages.
 *
 * The tokens themselves are consumed by the rendering layer
 * (`@video/video-components`); this module owns the vocabulary and the
 * resolution rule, not the pixels.
 */
export * from "./theme.js";
