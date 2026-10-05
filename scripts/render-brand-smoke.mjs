// Branding smoke render (feature 2026-10-05): one plan with style.brand,
// two stills — inside the intro window (brand band + tint + watermark) and
// after it (watermark only). Output: .omo/tmp/brand-smoke/*.png
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererRequire = createRequire(
  path.join(repoRoot, "packages/video-renderer/package.json"),
);
const { bundle } = await import(rendererRequire.resolve("@remotion/bundler"));
const { renderStill, selectComposition } = await import(
  rendererRequire.resolve("@remotion/renderer")
);

const rendererDir = path.join(repoRoot, "packages/video-renderer/src");
const outDir = path.join(repoRoot, ".omo/tmp/brand-smoke");
await mkdir(outDir, { recursive: true });

// Deterministic placeholder icon: 128px orange disc.
const iconPath = path.join(outDir, "icon.png");
await execFileAsync("ffmpeg", [
  "-y", "-f", "lavfi",
  "-i", "color=c=orange:s=128x128,format=rgba",
  "-frames:v", "1", iconPath,
]);
const iconB64 = Buffer.from(await readFile(iconPath)).toString("base64");

const FPS = 30;
const dur = 5 * FPS;
const scene = (id, i, cursor, props) => ({
  id,
  index: i,
  startFrame: cursor,
  durationInFrames: dur,
  component: "QuoteBlock",
  renderer: "remotion",
  props,
  animation: { entrance: "fade", emphasis: "none", exit: "fade" },
  animations: [],
  transition: null,
  captions: null,
  audio: null,
});

const renderPlan = {
  project: { id: "brand-smoke", language: "zh-CN", fps: FPS, width: 1920, height: 1080 },
  style: {
    theme: "paper-light",
    brand: {
      name: "我的频道",
      icon: `data:image/png;base64,${iconB64}`,
      corner: "bottom-right",
      size_px: 72,
      opacity: 0.85,
      intro: { duration_sec: 4, background: "sunset", show_name: true },
    },
  },
  totalFrames: dur * 2,
  scenes: [
    scene("scene-01", 0, 0, { quote: "开场画面：品牌横幅 + 角标", author: "intro window" }),
    scene("scene-02", 1, dur, { quote: "正片画面：只剩右下角标", author: "after intro" }),
  ],
};

const workDir = await mkdtemp(path.join(tmpdir(), "brand-smoke-"));
const entry = path.join(workDir, "entry.tsx");
await writeFile(
  entry,
  `import { registerRoot, Composition } from "remotion";
import { Root } from "${rendererDir}/Root.tsx";

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
`,
  "utf8",
);

console.log("[brand-smoke] bundling…");
const serveUrl = await bundle({ entryPoint: entry, enableCaching: false });
const composition = await selectComposition({
  serveUrl,
  id: "video-factory",
  inputProps: { renderPlan },
});

for (const [frame, label] of [[30, "intro"], [dur + 30, "after-intro"]]) {
  const out = path.join(outDir, `${label}.png`);
  await renderStill({ composition, serveUrl, inputProps: { renderPlan }, frame, output: out });
  console.log(`[brand-smoke] ${label} → ${out}`);
}
