import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readdir,
  stat,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderPlan } from "@vf/vdsl";

const execFileAsync = promisify(execFile);

const rendererFile = fileURLToPath(import.meta.url);
const rendererDir = path.dirname(rendererFile);
const ext = rendererFile.endsWith(".ts") ? "tsx" : "js";
const rootSrcPath = `${rendererDir}/Root.${ext}`;

/** Remotion's bundler leaks a ~26MB `remotion-webpack-bundle-*` dir in
 * os.tmpdir() per render (plus `remotion-v*-assets*` dirs) and never
 * removes them — hundreds of renders accumulate tens of GB. This sweep
 * removes entries older than `maxAgeMs`. Fire-and-forget; never throws. */
export async function sweepRemotionTemp(
  maxAgeMs: number = 3600_000,
): Promise<number> {
  const tmp = tmpdir();
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(tmp);
  } catch {
    return 0;
  }
  const stalePatterns = [
    /^remotion-webpack-bundle-/,
    /^remotion-v\d+\.\d+\.\d+-assets/,
  ];
  const now = Date.now();
  await Promise.all(
    entries.map(async (name) => {
      if (!stalePatterns.some((p) => p.test(name))) return;
      const full = path.join(tmp, name);
      try {
        const st = await stat(full);
        if (now - st.mtimeMs < maxAgeMs) return;
        await rm(full, { recursive: true, force: true });
        removed++;
      } catch {
        // already gone or in use — skip
      }
    }),
  );
  return removed;
}

const renderEntryTemplate = (
  renderPlan: RenderPlan,
): string => `import { registerRoot, Composition } from "remotion";
import { Root } from "${rootSrcPath}";

const renderPlan = ${JSON.stringify(renderPlan)};

const App = () => (
  <Composition
    id="video-factory"
    component={Root}
    durationInFrames={renderPlan.totalFrames}
    fps={renderPlan.project.fps}
    width={renderPlan.project.width}
    height={renderPlan.project.height}
    defaultProps={{ renderPlan }}
  />
);

registerRoot(App);
`;

export async function renderPlanToVideo(
  renderPlan: RenderPlan,
  outPath: string,
): Promise<void> {
  void sweepRemotionTemp().catch(() => {});
  await mkdir(path.dirname(outPath), { recursive: true });
  const resolvedPlan = await resolveImageSources(renderPlan);
  const workDir = await mkdtemp(path.join(tmpdir(), "vf-render-"));
  const entry = path.join(workDir, "entry.tsx");
  await writeFile(entry, renderEntryTemplate(resolvedPlan), "utf8");
  try {
    const serveUrl = await bundle({ entryPoint: entry });
    const composition = await selectComposition({
      serveUrl,
      id: "video-factory",
      inputProps: { renderPlan: resolvedPlan },
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps: { renderPlan: resolvedPlan },
      overwrite: true,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Convert ImageBackground scene `src` file paths to base64 data URLs.
 * Remotion's bundler serves the entry over HTTP, so file:// and
 * relative paths won't resolve in the headless browser. Data URLs
 * bypass that entirely. Non-existent files leave the src unchanged
 * (the dark background renders instead of crashing).
 */
async function resolveImageSources(
  plan: RenderPlan,
): Promise<RenderPlan> {
  const scenes = await Promise.all(
    plan.scenes.map(async (scene) => {
      if (scene.component !== "ImageBackground") return scene;
      const src = (scene.props as { src?: unknown }).src;
      if (typeof src !== "string" || src.startsWith("data:")) return scene;
      if (!existsSync(src)) return scene;
      const bytes = await readFile(src);
      const ext = path.extname(src).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
      return {
        ...scene,
        props: { ...scene.props, src: dataUrl },
      };
    }),
  );
  return { ...plan, scenes };
}

/** Re-mux with +faststart for streamable MP4 without recompressing video. */
export async function faststart(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}
