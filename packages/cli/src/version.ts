/** Single source of truth for the CLI version string.
 *  Imported by both `index.ts` (where it's the canonical
 *  `program.version(VERSION)` for `--version` and the --help banner)
 *  and by `ui.ts` (where it's used by `brandBannerLine`). Keeping it
 *  here avoids a `ui.ts` → `index.ts` → `ui.ts` import cycle. */
export const VERSION = "0.6.0";
