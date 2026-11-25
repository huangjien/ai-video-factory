import { execFile } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readdir,
  stat,
  readFile,
  copyFile,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { isTitleStyle, TITLE_FONTS } from "@video/video-components";
import { sharedBrowser, type BrowserPool } from "./browser.js";
import { resolveRootSourcePath } from "./root-source.js";
import { RENDERER_REVISION } from "./scene-cache.js";
import {
  slicePlanScene,
  type RenderPlan,
  type RenderPlanScene,
} from "@video/vdsl";

const execFileAsync = promisify(execFile);

const rendererFile = fileURLToPath(import.meta.url);
const rendererDir = path.dirname(rendererFile);
const rootSrcPath = resolveRootSourcePath(rendererFile);

/** Remotion's bundler leaks a ~26MB `remotion-webpack-bundle-*` dir in
 * os.tmpdir() per render (plus `remotion-v*-assets*` dirs) and never
 * removes them — hundreds of renders accumulate tens of GB. This sweep
 * removes entries older than `maxAgeMs`. Fire-and-forget; never throws. */
async function sweepRemotionTemp(maxAgeMs: number = 3600_000): Promise<number> {
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

/** The Remotion entry. It is byte-identical for every scene and every
 *  film — the render plan arrives as `inputProps`, never as source — so
 *  its webpack bundle is built once and reused (`cachedBundle`).
 *  Measured 2026-11-25: bundling was 3.4 s of an 8.9 s scene render. */
function staticEntry(): string {
  if (rootSrcPath === null) {
    throw new Error(
      "Remotion Root source not found — the published package vendors it under vendor/Root.js; reinstall @video/cli, or run `pnpm run build` in the workspace",
    );
  }
  return `import { registerRoot, Composition } from "remotion";
import { Root } from "${rootSrcPath}";

// staticFile() resolves against this base; the bundler copies the
// publicDir into the bundle as ./public (see renderPlanToVideo).
// Without it, OffthreadVideo requests bundle-root paths and 404s.
window.remotion_staticBase = "/public";

const App = () => (
  <Composition
    id="video-factory"
    component={Root}
    durationInFrames={1}
    fps={30}
    width={1920}
    height={1080}
    calculateMetadata={async ({ props }) => {
      const plan = props.renderPlan;
      return {
        durationInFrames: plan.totalFrames,
        fps: plan.project.fps,
        width: plan.project.width,
        height: plan.project.height,
      };
    }}
  />
);

registerRoot(App);
`;
}

/** Where reused bundles live. `~/.cache` rather than os.tmpdir(): the OS
 *  cleans temp files piecemeal, and a half-deleted bundle is a render that
 *  fails on a missing chunk. Override with `VIDEO_BUNDLE_CACHE=<dir>`. */
function bundleCacheRoot(): string {
  const explicit = process.env["VIDEO_BUNDLE_CACHE"];
  return explicit !== undefined && explicit !== ""
    ? path.resolve(explicit)
    : path.join(homedir(), ".cache", "video-renderer", "bundles");
}

async function hashTree(dir: string, hash: Hash): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await hashTree(full, hash);
    else if (entry.isFile()) {
      hash.update(entry.name);
      hash.update(await readFile(full));
    }
  }
}

/** The package directory behind a resolved entry file. */
async function packageDirOf(entryFile: string): Promise<string> {
  let dir = path.dirname(entryFile);
  for (let hops = 0; hops < 8; hops++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(entryFile);
}

/** Identity of everything the static entry compiles: the Root, the
 *  component and theme packages' BUILT output, and the remotion and react
 *  versions. A bundle cached under any other key is a different program.
 *  The two workspace packages are content-hashed because their version
 *  (0.1.0) does not move when their code does. Computed once per process. */
let bundleKeyPromise: Promise<string> | null = null;
function bundleCacheKey(): Promise<string> {
  bundleKeyPromise ??= (async () => {
    const hash = createHash("sha256");
    hash.update(staticEntry());
    hash.update(RENDERER_REVISION);
    if (rootSrcPath !== null) {
      hash.update(await readFile(rootSrcPath));
      // Resolved the way webpack resolves them: the Root's own import from
      // the Root, and the component package's imports from that package —
      // pnpm does not hoist `@video/theme` to the renderer.
      const resolveFromRoot = createRequire(rootSrcPath);
      const componentsDir = await packageDirOf(
        resolveFromRoot.resolve("@video/video-components"),
      );
      const resolveFromComponents = createRequire(
        path.join(componentsDir, "package.json"),
      );
      const inputs: [string, string][] = [
        ["@video/video-components", componentsDir],
        [
          "@video/theme",
          await packageDirOf(resolveFromComponents.resolve("@video/theme")),
        ],
        [
          "remotion",
          await packageDirOf(resolveFromComponents.resolve("remotion")),
        ],
        ["react", await packageDirOf(resolveFromComponents.resolve("react"))],
      ];
      for (const [name, dir] of inputs) {
        const manifest = JSON.parse(
          await readFile(path.join(dir, "package.json"), "utf8"),
        ) as { version?: string };
        hash.update(`${name}@${manifest.version ?? ""}`);
        const dist = path.join(dir, "dist");
        if (name.startsWith("@video/") && existsSync(dist)) {
          await hashTree(dist, hash);
        }
      }
    }
    return hash.digest("hex").slice(0, 16);
  })().catch((error: unknown) => {
    bundleKeyPromise = null;
    throw error;
  });
  return bundleKeyPromise;
}

/** The static entry's webpack bundle, built once per `bundleCacheKey`.
 *  Single-flight per process: the scene pool's workers all arrive here
 *  together on a cold start. Returns the bundle directory to serve.
 *
 *  The completeness marker is written INSIDE the build directory, before
 *  the atomic rename — a bundle at its final path is therefore always
 *  whole, and a concurrent builder that loses the rename simply reuses
 *  the winner's. */
let bundlePromise: Promise<string> | null = null;
function cachedBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const key = await bundleCacheKey();
    const root = bundleCacheRoot();
    const finalDir = path.join(root, `bundle-${key}`);
    if (existsSync(path.join(finalDir, ".complete"))) return finalDir;
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(path.join(root, "build-"));
    try {
      const outDir = path.join(workDir, "out");
      const publicDir = path.join(workDir, "public");
      const entry = path.join(workDir, "entry.tsx");
      await mkdir(publicDir, { recursive: true });
      await writeFile(entry, staticEntry(), "utf8");
      await bundle({
        entryPoint: entry,
        outDir,
        // Remotion's default public dir resolves from the process cwd —
        // meaningless in a render pipeline. The static bundle serves no
        // files of its own (a footage clip gets a private bundle).
        publicDir,
        // Webpack's persistent cache writes a 250–575MB snapshot per
        // build (69GB observed in node_modules/.cache/webpack) and can
        // never hit across machines. NOTE: cache:false inside
        // webpackOverride does NOT work — Remotion's
        // computeHashAndFinalConfig assigns `cache` AFTER the override
        // runs; enableCaching is the option that actually reaches it.
        enableCaching: false,
      });
      await writeFile(path.join(outDir, ".complete"), key, "utf8");
      try {
        await rename(outDir, finalDir);
      } catch {
        // The slot is taken by a complete bundle (another process, or an
        // earlier run) — the marker-inside-then-rename rule guarantees
        // it is whole. Use it.
        if (!existsSync(path.join(finalDir, ".complete"))) {
          throw new Error(
            `bundle cache slot is not a complete bundle: ${finalDir}`,
          );
        }
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
    // Another process may still be serving bundles from older keys.
    return finalDir;
  })().finally(() => {
    // Recheck the marker on the next call and allow a failed build to retry.
    bundlePromise = null;
  });
  return bundlePromise;
}

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
  opts: { browserPool?: BrowserPool } = {},
): Promise<void> {
  const { plan } = slicePlanScene(renderPlan, sceneId);
  await renderPlanToVideo(plan, outPath, opts);
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
  opts: { browserPool?: BrowserPool } = {},
): Promise<void> {
  assertPlanRenderable(renderPlan);
  void sweepRemotionTemp().catch(() => {});
  await mkdir(path.dirname(outPath), { recursive: true });
  const resolvedPlan = await resolveImageSources(renderPlan);
  // A footage clip is served from its bundle's public dir, so a scene that
  // carries one gets a private bundle; every other scene reuses the
  // cached static bundle (3.4 s of webpack per scene, saved).
  // `VIDEO_BUNDLE_CACHE=off` forces a private bundle for every scene —
  // the escape hatch when the reused bundle is under suspicion.
  const hasClip = resolvedPlan.scenes.some(
    (scene) => scene.component === "VideoBackground",
  );
  const workDir =
    hasClip || process.env["VIDEO_BUNDLE_CACHE"] === "off"
      ? await mkdtemp(path.join(tmpdir(), "video-render-"))
      : null;
  let planWithVideo = resolvedPlan;
  let serveUrl: string;
  try {
    if (workDir === null) {
      serveUrl = await cachedBundle();
    } else {
      // Remotion's bundler serves `<entryDir>/public` — the entry lives at
      // the workDir root, so clips copied here resolve via staticFile().
      const publicDir = path.join(workDir, "public");
      if (hasClip) {
        planWithVideo = await resolveVideoSources(resolvedPlan, publicDir);
      }
      const entry = path.join(workDir, "entry.tsx");
      await writeFile(entry, staticEntry(), "utf8");
      serveUrl = await bundle({
        entryPoint: entry,
        // Remotion's default public dir resolves from the process cwd —
        // meaningless in a render pipeline. Point it at the workDir copy
        // resolveVideoSources made; the bundler copies it into the bundle
        // so staticFile()/OffthreadVideo can serve the clips.
        publicDir,
        enableCaching: false,
      });
    }
    // Per-worker browser pool when called from the parallel scene pool;
    // the module singleton (serial pipeline default) otherwise. Sharing
    // one Chrome across concurrent renderMedia calls was never designed
    // here — browser.ts assumes one scene at a time.
    const pool = opts.browserPool ?? sharedBrowser;
    const browser = await pool.get();
    try {
      const composition = await selectComposition({
        serveUrl,
        id: "video-factory",
        inputProps: { renderPlan: planWithVideo },
        puppeteerInstance: browser,
      });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: outPath,
        inputProps: { renderPlan: planWithVideo },
        overwrite: true,
        puppeteerInstance: browser,
      });
    } catch (err) {
      // The shared browser may be the cause — it died, or the connection
      // dropped. Drop it so the next render opens a fresh one instead of
      // inheriting a dead browser.
      pool.invalidate();
      throw err;
    }
  } finally {
    if (workDir !== null) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
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
        // A hand-placed or video-sources-retrieved PD clip replaces the
        // full-bleed still (design: docs/plans/2026-11-21-public-domain-
        // video-scenes-design.md). Captions ride the overlay track, so
        // the swap touches only the background layer; resolveVideoSources
        // then copies the clip into the bundler's public dir.
        const clip = findSceneVideo(plan, scene);
        if (clip !== null) {
          return {
            ...scene,
            component: "VideoBackground",
            props: { videoSrc: clip },
          };
        }
        const withSrc = await resolveComponentSrc(
          scene,
          plan.projectRoot,
          warn,
        );
        return resolveTextOverlay(withSrc, plan.projectRoot, warn);
      }
      // The title card paints its own art: it needs the picture's
      // pixels to choose an ink that reads on them, so the art arrives
      // as a prop instead of as the scene background layer.
      if (scene.component === "Title") {
        return resolveTitleCard(plan, scene);
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
  return {
    ...plan,
    scenes,
    ...(brand ? { style: { ...plan.style, brand } } : {}),
  };
}

/**
 * Copy VideoBackground clips into the bundler's public dir and point
 * `videoSrc` at the served name (the Remotion `staticFile()` contract).
 *
 * Video cannot ride the data-URL path that images use — the bundler
 * serves the public dir over HTTP and `OffthreadVideo` needs a real
 * URL to extract frames from. Identical source paths copy once and
 * share the served name. A missing file warns and leaves the scene on
 * the dark background (same silence-with-a-warning policy as
 * `resolveImageSources`) — a film never fails because a clip vanished.
 */
export async function resolveVideoSources(
  plan: RenderPlan,
  publicDir: string,
  warn: (message: string) => void = () => {},
): Promise<RenderPlan> {
  const servedByName = new Map<string, string>();
  const scenes = await Promise.all(
    plan.scenes.map(async (scene) => {
      if (scene.component !== "VideoBackground") return scene;
      const src: unknown = scene.props.videoSrc;
      if (typeof src !== "string" || src === "" || src.startsWith("data:")) {
        return scene;
      }
      let served = servedByName.get(src);
      if (served === undefined) {
        const abs = path.isAbsolute(src)
          ? src
          : path.join(plan.projectRoot ?? process.cwd(), src);
        if (!existsSync(abs)) {
          warn(
            `scene ${scene.id}: VideoBackground videoSrc not found: ${abs} — rendering the dark background instead`,
          );
          return scene;
        }
        const safeId = scene.id.replace(/[^a-zA-Z0-9_-]/g, "_");
        served = `scene-video-${safeId}${path.extname(abs) || ".mp4"}`;
        // Claim the slot before awaiting the copy — concurrent scenes
        // sharing one clip must not each schedule their own copy.
        servedByName.set(src, served);
        await mkdir(publicDir, { recursive: true });
        await copyFile(abs, path.join(publicDir, served));
      }
      return { ...scene, props: { ...scene.props, videoSrc: served } };
    }),
  );
  return { ...plan, scenes };
}

/** Inlines an ImageBackground scene's own `src` as a data URL. */
async function resolveComponentSrc(
  scene: RenderPlanScene,
  projectRoot: string | undefined,
  warn: (message: string) => void,
): Promise<RenderPlanScene> {
  const src: unknown = scene.props.src;
  if (typeof src !== "string" || src.startsWith("data:")) return scene;
  const absolute = path.isAbsolute(src)
    ? src
    : projectRoot
      ? path.join(projectRoot, src)
      : src;
  if (!existsSync(absolute)) {
    warn(
      `scene ${scene.id}: ImageBackground src not found: ${absolute} — rendering the dark background instead`,
    );
    return scene;
  }
  return {
    ...scene,
    props: { ...scene.props, src: await toDataUrl(absolute) },
  };
}

/** v0.12: inlines the ImageBackground `textOverlaySrc` (a transparent PNG
 *  produced by `scripts/pillow-text-overlay.py`) as a data URL so the
 *  headless browser can fetch it. Relative paths are resolved against
 *  the plan's project root — same convention the `src` resolver uses
 *  upstream, kept consistent by passing the same warnings handle. */
async function resolveTextOverlay(
  scene: RenderPlanScene,
  projectRoot: string | undefined,
  warn: (message: string) => void,
): Promise<RenderPlanScene> {
  const overlay = scene.props.textOverlaySrc;
  if (typeof overlay !== "string" || overlay.length === 0) return scene;
  if (overlay.startsWith("data:")) return scene;
  const absolute = path.isAbsolute(overlay)
    ? overlay
    : projectRoot
      ? path.join(projectRoot, overlay)
      : overlay;
  if (!existsSync(absolute)) {
    warn(
      `scene ${scene.id}: textOverlaySrc not found: ${absolute} — rendering without key-info title`,
    );
    return scene;
  }
  return {
    ...scene,
    props: { ...scene.props, textOverlaySrc: await toDataUrl(absolute) },
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
  const file = findSceneImage(plan, scene);
  if (file === null) return scene;
  return { ...scene, backgroundSrc: await toDataUrl(file) };
}

/** The generated art for a scene, by the naming convention `video make`
 *  writes (`assets/images/scene_N.jpg`). Null when the project has no
 *  image for this scene — hand-authored projects legitimately have none. */
function findSceneImage(
  plan: RenderPlan,
  scene: RenderPlanScene,
): string | null {
  if (!plan.projectRoot) return null;
  const idNum = scene.id.match(/scene[-_]?(\d+)/)?.[1];
  const n = String(idNum ? parseInt(idNum, 10) : scene.index + 1);
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const file = path.join(
      plan.projectRoot,
      "assets",
      "images",
      `scene_${n}${ext}`,
    );
    if (existsSync(file)) return file;
  }
  return null;
}

/** The scene's public-domain clip, by the convention the video-sources
 *  pipeline writes (`assets/video/scene_N.mp4`) — same scene-number rule
 *  as `findSceneImage`. Null when the project carries no clip, which is
 *  the normal state for every film made before the feature. */
function findSceneVideo(
  plan: RenderPlan,
  scene: RenderPlanScene,
): string | null {
  if (!plan.projectRoot) return null;
  const idNum = scene.id.match(/scene[-_]?(\d+)/)?.[1];
  const n = String(idNum ? parseInt(idNum, 10) : scene.index + 1);
  const file = path.join(plan.projectRoot, "assets", "video", `scene_${n}.mp4`);
  return existsSync(file) ? file : null;
}

/**
 * The title card's two assets, inlined as data URLs.
 *
 * The art is the scene's own generated picture. The face is the
 * vendored artistic font for the card's style — the fonts live in the
 * workspace's `assets/fonts/` (shared by every film, like the BGM),
 * and the browser can only read what the entry embeds.
 */
async function resolveTitleCard(
  plan: RenderPlan,
  scene: RenderPlanScene,
): Promise<RenderPlanScene> {
  const artFile = findSceneImage(plan, scene);
  const artSrc = artFile === null ? undefined : await toDataUrl(artFile);
  const style = isTitleStyle(scene.props.style) ? scene.props.style : "kai";
  const fontFile = findFontFile(plan.projectRoot, TITLE_FONTS[style].file);
  const fontSrc = fontFile === null ? undefined : await toFontDataUrl(fontFile);
  return {
    ...scene,
    props: {
      ...scene.props,
      ...(artSrc !== undefined ? { artSrc } : {}),
      ...(fontSrc !== undefined ? { fontSrc } : {}),
    },
  };
}

/** The vendored artistic font, from the workspace's shared `assets/fonts/`
 *  or from the project's own copy. Null when neither has it — the card
 *  then falls back to the theme's type family. */
function findFontFile(
  projectRoot: string | undefined,
  file: string,
): string | null {
  if (!projectRoot) return null;
  const roots = [projectRoot];
  const wsRoot = workspaceRootFor(projectRoot);
  if (wsRoot !== null) roots.unshift(wsRoot);
  for (const root of roots) {
    const candidate = path.join(root, "assets", "fonts", file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** File path → `data:<mime>;base64,…` for the headless browser. */
async function toDataUrl(file: string): Promise<string> {
  const bytes = await readFile(file);
  const mime = imageMime(path.extname(file).toLowerCase());
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** A font file → a data URL the browser can register as a FontFace. */
async function toFontDataUrl(file: string): Promise<string> {
  const bytes = await readFile(file);
  const mime =
    path.extname(file).toLowerCase() === ".otf" ? "font/otf" : "font/ttf";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The workspace root that owns a project directory (`projects/<name>`).
 *  Shared assets — the BGM library, the brand kit, the artistic fonts —
 *  live there, not inside a single project. */
export function workspaceRootFor(projectRoot: string): string | null {
  let dir = path.dirname(projectRoot);
  for (let hops = 0; hops < 8 && dir !== path.dirname(dir); hops++) {
    if (path.basename(dir) === "projects") return path.dirname(dir);
    dir = path.dirname(dir);
  }
  return null;
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
