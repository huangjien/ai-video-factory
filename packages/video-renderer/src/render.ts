import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  await mkdir(path.dirname(outPath), { recursive: true });
  const workDir = await mkdtemp(path.join(tmpdir(), "vf-render-"));
  const entry = path.join(workDir, "entry.tsx");
  await writeFile(entry, renderEntryTemplate(renderPlan), "utf8");
  try {
    const serveUrl = await bundle({ entryPoint: entry });
    const composition = await selectComposition({
      serveUrl,
      id: "video-factory",
      inputProps: { renderPlan },
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps: { renderPlan },
      overwrite: true,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
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
