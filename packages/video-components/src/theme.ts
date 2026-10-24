/**
 * The theme registry now lives in `@video/theme`.
 *
 * The theme is a cross-cutting invariant — the storyboard writer, the
 * schema, the compiler, the CLI and the renderer must all agree on it —
 * so it belongs BELOW all of them, not inside the rendering layer.
 *
 * This re-export keeps `@video/video-components`' published surface intact.
 */
export * from "@video/theme";
