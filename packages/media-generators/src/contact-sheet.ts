import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contact-sheet runner (v0.8 visual-guardrails plan, G3). Shells out to
 * the pure-Pillow `contact_sheet.py` in the python dir. Review never
 * needs a model runtime, so the script stays a thin Pillow dependency.
 */

export interface ContactSheetOptions {
  /** Project-relative or absolute image dir (assets/images). */
  imagesDir: string;
  /** Output PNG path. */
  outPath: string;
  /** scene_N → caption labels burned under each thumb. */
  captions: Record<string, string>;
  /** Columns (default 4). */
  cols?: number;
  /** Override `uv` (tests). */
  pythonBin?: string;
}

export interface ContactSheetResult {
  ok: boolean;
  outPath: string;
  error?: string;
}

/** packages/media-generators/{dist|src} → ../python (same either way).
 *  Shared by every uv-run helper in this package. */
export function resolvePythonDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "python");
}

export async function buildContactSheet(
  opts: ContactSheetOptions,
): Promise<ContactSheetResult> {
  if (!existsSync(opts.imagesDir)) {
    return {
      ok: false,
      outPath: opts.outPath,
      error: `no images dir: ${opts.imagesDir}`,
    };
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "contact-sheet-"));
  const labelsPath = path.join(workDir, "labels.json");
  await writeFile(labelsPath, JSON.stringify(opts.captions), "utf8");
  try {
    await mkdir(path.dirname(opts.outPath), { recursive: true });
    const code = await new Promise<number>((resolve, reject) => {
      const proc = spawn(
        opts.pythonBin ?? "uv",
        [
          "run",
          "python",
          "contact_sheet.py",
          "--images-dir",
          opts.imagesDir,
          "--out",
          opts.outPath,
          "--labels",
          labelsPath,
          "--cols",
          String(opts.cols ?? 4),
        ],
        { cwd: resolvePythonDir(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      proc.stdout.on("data", () => undefined);
      proc.stderr.on("data", (d) => {
        stderr += String(d);
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      proc.on("error", reject);
      proc.on("close", (c) => resolve(c ?? 1));
    });
    if (code !== 0) {
      return {
        ok: false,
        outPath: opts.outPath,
        error: `contact_sheet.py exited ${code} — uv/Pillow available?`,
      };
    }
    return { ok: true, outPath: opts.outPath };
  } catch (err) {
    return { ok: false, outPath: opts.outPath, error: (err as Error).message };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
