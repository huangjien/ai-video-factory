// One-off smoke render: one still per v0.4.2 component, mid-animation,
// via the real Root composition. Output: .omo/tmp/visual-smoke/*.png
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// @remotion/* is a dependency of @video/video-renderer, not the root — resolve
// through that package so the script can live anywhere.
const rendererRequire = createRequire(
  path.join(repoRoot, "packages/video-renderer/package.json"),
);
const { bundle } = await import(rendererRequire.resolve("@remotion/bundler"));
const { renderStill, selectComposition } = await import(
  rendererRequire.resolve("@remotion/renderer")
);

const rendererDir = path.join(repoRoot, "packages/video-renderer/src");
const outDir = path.join(repoRoot, ".omo/tmp/visual-smoke");
await mkdir(outDir, { recursive: true });

const SCENES = [
  ["QuoteBlock", { quote: "想象力比知识更重要", author: "爱因斯坦" }],
  [
    "StatGrid",
    {
      stats: [
        { value: "95%", label: "准确率提升" },
        { value: "3.5x", label: "推理速度" },
        { value: "20%", label: "成本下降" },
        { value: "12亿", label: "覆盖用户" },
      ],
    },
  ],
  [
    "BarChart",
    {
      title: "训练语料构成",
      bars: [
        { label: "中文网页", value: 45, display: "45%" },
        { label: "英文网页", value: 35, display: "35%" },
        { label: "代码", value: 12, display: "12%" },
        { label: "书籍", value: 8, display: "8%" },
      ],
    },
  ],
  [
    "Leaderboard",
    {
      title: "推理榜单 Top 3",
      entries: [
        { name: "模型 Alpha", score: "96.2" },
        { name: "模型 Beta", score: "94.8" },
        { name: "模型 Gamma", score: "93.1" },
      ],
    },
  ],
  [
    "Checklist",
    {
      title: "上线前检查",
      items: [
        { text: "全量测试通过" },
        { text: "灰度方案确认" },
        { text: "回滚脚本就绪" },
      ],
    },
  ],
  ["BigIdea", { text: "简单优于复杂", kicker: "核心观点" }],
  ["PyramidDiagram", { levels: ["顶层结论", "方法路径", "基础事实"] }],
  ["VennDiagram", { sets: ["AI", "教育", "数据"], center: "个性化" }],
  ["CycleDiagram", { stages: ["计划", "执行", "检查", "改进"], title: "闭环" }],
];

const SECONDS_PER_SCENE = 3;
const FPS = 30;
const dur = SECONDS_PER_SCENE * FPS;
let cursor = 0;
const scenes = SCENES.map(([component, props], i) => {
  const scene = {
    id: `scene-${String(i + 1).padStart(2, "0")}`,
    index: i,
    startFrame: cursor,
    durationInFrames: dur,
    component,
    renderer: "remotion",
    props,
    animation: { entrance: "fade", emphasis: "none", exit: "fade" },
    animations: [],
    transition: null,
    captions: null,
    audio: null,
  };
  cursor += dur;
  return scene;
});

const renderPlan = {
  project: { id: "visual-smoke", language: "zh-CN", fps: FPS, width: 1920, height: 1080 },
  style: { theme: "paper-light" },
  totalFrames: cursor,
  scenes,
};

const workDir = await mkdtemp(path.join(tmpdir(), "video-smoke-"));
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

console.log("[smoke] bundling…");
const serveUrl = await bundle({ entryPoint: entry, enableCaching: false });
const composition = await selectComposition({
  serveUrl,
  id: "video-factory",
  inputProps: { renderPlan },
});

for (const scene of scenes) {
  // Mid-scene frame — entrance animations finished, exit fade not started.
  const frame = scene.startFrame + Math.round(dur * 0.55);
  const out = path.join(outDir, `${scene.component}.png`);
  await renderStill({
    composition,
    serveUrl,
    inputProps: { renderPlan },
    frame,
    output: out,
    overwrite: true,
  });
  console.log("[smoke]", scene.component, "→", out);
}
console.log("[smoke] done");
