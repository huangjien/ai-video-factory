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
import { sharedBrowser } from "./browser.js";
import { slicePlanScene, type RenderPlan, type RenderPlanScene } from "@video/vdsl";

const execFileAsync = promisify(execFile);

const rendererFile = fileURLToPath(import.meta.url);
const rendererDir = path.dirname(rendererFile);
const ext = rendererFile.endsWith(".ts") ? "tsx" : "js";
const rootSrcPath = `${rendererDir}/Root.${ext}`;

/** Remotion's bundler leaks a ~26MB `remotion-webpack-bundle-*` dir in
 * os.tmpdir() per render (plus `remotion-v*-assets*` dirs) and never
 * removes them — hundreds of renders accumulate tens of GB. This sweep
 * removes entries older than `maxAgeMs`. Fire-and-forget; never throws. */
async function sweepRemotionTemp(
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

/** Which visual renderers are wired, and to which component families
 * (plan §9/T4.3): remotion renders every REGISTRY component; canvas
 * scenes render via DoodleScene. Unwired combinations fail loudly
 * instead of silently substituting. */
const RENDERED_COMPONENTS: Record<string, RegExp> = {
  remotion: /.*/,
  canvas: /^(DoodleScene)$/,
};

/** Fail loudly when a scene names a visual renderer/component combination
 * that has no wired runtime (plan §9). Silent fallback would render the
 * wrong thing; the CLI should stop instead. */
function assertPlanRenderable(plan: RenderPlan): void {
  const unwired = plan.scenes.filter((s) => {
    const allowed = RENDERED_COMPONENTS[s.renderer];
    return !allowed || !allowed.test(s.component);
  });
  if (unwired.length > 0) {
    throw new Error(
      `render: visual renderer/component combination not wired yet: ${unwired
        .map((s) => `${s.id}→${s.renderer}/${s.component}`)
        .join(", ")}. Wired: remotion/*, canvas/DoodleScene.`,
    );
  }
}

/** Render a single scene to its own MP4 (scene isolation, plan Principle 1):
 * the scene becomes a standalone composition starting at frame 0, so
 * touching one scene never re-renders its siblings. */
export async function renderSceneToVideo(
  renderPlan: RenderPlan,
  sceneId: string,
  outPath: string,
): Promise<void> {
  const { plan } = slicePlanScene(renderPlan, sceneId);
  await renderPlanToVideo(plan, outPath);
}

/** Concatenate per-scene MP4s (same codec/geometry) into one file via the
 * ffmpeg concat demuxer — no re-encode. Scene order is the caller's array
 * order. */
export async function concatScenes(
  sceneFiles: string[],
  outPath: string,
): Promise<void> {
  if (sceneFiles.length === 0) {
    throw new Error("concatScenes: no scene files given");
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "video-concat-"));
  try {
    const listPath = path.join(workDir, "list.txt");
    // ffmpeg's concat demuxer quoting: escape each single quote as '\''.
    const list = sceneFiles
      .map((f) => `file '${f.replaceAll("'", "'\\''")}'`)
      .join("\n");
    await writeFile(listPath, `${list}\n`, "utf8");
    await mkdir(path.dirname(outPath), { recursive: true });
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outPath,
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function renderPlanToVideo(
  renderPlan: RenderPlan,
  outPath: string,
): Promise<void> {
  assertPlanRenderable(renderPlan);
  void sweepRemotionTemp().catch(() => {});
  await mkdir(path.dirname(outPath), { recursive: true });
  const resolvedPlan = await resolveImageSources(renderPlan);
  const workDir = await mkdtemp(path.join(tmpdir(), "video-render-"));
  const entry = path.join(workDir, "entry.tsx");
  await writeFile(entry, renderEntryTemplate(resolvedPlan), "utf8");
  try {
    const serveUrl = await bundle({
      entryPoint: entry,
      // The entry embeds the renderPlan (with base64 image data URLs), so
      // its content changes every render — webpack's persistent cache can
      // never hit and instead writes a fresh 250–575MB snapshot per render
      // (69GB observed in node_modules/.cache/webpack). NOTE: cache:false
      // inside webpackOverride does NOT work — Remotion's
      // computeHashAndFinalConfig assigns `cache` AFTER the override runs;
      // enableCaching is the option that actually reaches the config.
      enableCaching: false,
    });
    const browser = await sharedBrowser.get();
    try {
      const composition = await selectComposition({
        serveUrl,
        id: "video-factory",
        inputProps: { renderPlan: resolvedPlan },
        puppeteerInstance: browser,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: outPath,
        inputProps: { renderPlan: resolvedPlan },
        overwrite: true,
        puppeteerInstance: browser,
      });
    } catch (err) {
      // The shared browser may be the cause — it died, or the connection
      // dropped. Drop it so the next render opens a fresh one instead of
      // inheriting a dead browser.
      sharedBrowser.invalidate();
      throw err;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Mime type for an image asset extension. Falls back to jpeg — the
 * browser sniffs anyway, but an explicit type keeps data URLs honest. */
function imageMime(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

/**
 * Convert ImageBackground scene `src` file paths to base64 data URLs.
 * Remotion's bundler serves the entry over HTTP, so file:// and
 * relative paths won't resolve in the headless browser. Data URLs
 * bypass that entirely. Non-existent files leave the src unchanged
 * (the dark background renders instead of crashing) — but the silence
 * is reported through `warn` so the render outcome can surface it.
 *
 * The same pass binds the SCENE BACKGROUND for every other component:
 * when `assets/images/scene_N.jpg` exists it becomes `scene.backgroundSrc`,
 * so each component draws on the generated scene art instead of a flat
 * theme fill. `video make` already writes that image for every scene, so
 * this needs no storyboard change — a missing file simply leaves the
 * theme background (never a warning: no image is the normal state for
 * hand-authored projects).
 */
export async function resolveImageSources(
  plan: RenderPlan,
  warn: (message: string) => void = () => {},
): Promise<RenderPlan> {
  const scenes = await Promise.all(
    plan.scenes.map(async (scene) => {
      if (scene.component === "ImageBackground") {
        return resolveComponentSrc(scene, warn);
      }
      const bound = await bindSceneBackground(plan, scene);
      return bound;
    }),
  );
  // Brand watermark icon (branding 2026-10-05): same bundler constraint —
  // the headless browser only renders what the entry embeds, so inline the
  // icon as a data URL too. Missing file → watermark skipped, reported
  // through `warn` instead of silently.
  let brand = plan.style.brand;
  const icon = brand?.icon;
  if (brand && icon && !icon.startsWith("data:")) {
    if (!existsSync(icon)) {
      warn(`brand icon not found: ${icon} — watermark skipped`);
    } else {
      const bytes = await readFile(icon);
      const mime = imageMime(path.extname(icon).toLowerCase());
      brand = {
        ...brand,
        icon: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      };
    }
  }
  return { ...plan, scenes, ...(brand ? { style: { ...plan.style, brand } } : {}) };
}

/** Inlines an ImageBackground scene's own `src` as a data URL. */
async function resolveComponentSrc(
  scene: RenderPlanScene,
  warn: (message: string) => void,
): Promise<RenderPlanScene> {
  const src: unknown = scene.props.src;
  if (typeof src !== "string" || src.startsWith("data:")) return scene;
  if (!existsSync(src)) {
    warn(
      `scene ${scene.id}: ImageBackground src not found: ${src} — rendering the dark background instead`,
    );
    return scene;
  }
  return {
    ...scene,
    props: { ...scene.props, src: await toDataUrl(src) },
  };
}

/** Binds `assets/images/scene_N.jpg` as this scene's background image.
 *  Scene number comes from the scene id (`scene-04`, `scene_4`),
 *  normalized to a bare integer the same way `video make` names its
 *  files — `scene_04` must find `scene_4.jpg`, not `scene_04.jpg`.
 *  Falls back to the 1-based position. Returns the scene unchanged when
 *  there is no project root or no image — the theme background is right. */
async function bindSceneBackground(
  plan: RenderPlan,
  scene: RenderPlanScene,
): Promise<RenderPlanScene> {
  if (!plan.projectRoot) return scene;
  const idNum = scene.id.match(/scene[-_]?(\d+)/)?.[1];
  const n = String(idNum ? parseInt(idNum, 10) : scene.index + 1);
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const file = path.join(plan.projectRoot, "assets", "images", `scene_${n}${ext}`);
    if (!existsSync(file)) continue;
    return { ...scene, backgroundSrc: await toDataUrl(file) };
  }
  return scene;
}

/** File path → `data:<mime>;base64,…` for the headless browser. */
async function toDataUrl(file: string): Promise<string> {
  const bytes = await readFile(file);
  const mime = imageMime(path.extname(file).toLowerCase());
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
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
