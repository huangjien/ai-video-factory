import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const outDir = path.resolve("../../.omo/tmp");
const raw = path.join(outDir, "hello-raw.mp4");
const out = path.join(outDir, "hello.mp4");

await mkdir(outDir, { recursive: true });

console.log("[render:hello] bundling…");
const serveUrl = await bundle({
  entryPoint: path.resolve("src/index.ts"),
});

console.log("[render:hello] selecting composition…");
const composition = await selectComposition({
  serveUrl,
  id: "hello",
  inputProps: {},
});

console.log("[render:hello] rendering…");
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: raw,
  inputProps: {},
  overwrite: true,
});

console.log("[render:hello] ffmpeg faststart re-encode…");
execFileSync(
  "ffmpeg",
  ["-y", "-i", raw, "-c:v", "libx264", "-movflags", "+faststart", "-an", out],
  { stdio: "inherit" },
);

console.log("[render:hello] done →", out);
