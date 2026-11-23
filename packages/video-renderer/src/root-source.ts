import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Where the Remotion Root component's SOURCE lives.
 *
 * The render path writes a generated entry that imports `Root` by
 * absolute path (Remotion compiles that entry with its own bundler, so
 * the import must be a real file on disk). Two layouts exist:
 *
 * - the workspace: `Root.js` sits next to this module
 *   (`packages/video-renderer/dist/Root.js`);
 * - the published single-file package: the Root is vendored under
 *   `vendor/` because the bundle inlines this module (so
 *   `import.meta.url` points at the bundle, not at a package dir).
 *
 * The first existing candidate wins. Null means "no Root source" — the
 * caller fails loudly with the reinstall hint rather than rendering a
 * black frame.
 */
export function resolveRootSourcePath(moduleFile: string): string | null {
  const dir = path.dirname(moduleFile);
  const ext = moduleFile.endsWith(".ts") ? "tsx" : "js";
  const candidates = [
    path.join(dir, `Root.${ext}`),
    path.join(dir, "vendor", `Root.${ext}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
