#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { spawnSync } from "node:child_process";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve("projects/benchmark-v01");
const outDir = path.resolve(".omo/tmp/verify");
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

const probe = async (file) => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration",
    "-of",
    "json",
    file,
  ]);
  return JSON.parse(stdout).streams[0];
};

const renderInto = async (sub) => {
  const target = path.join(outDir, sub);
  await fs.mkdir(target, { recursive: true });
  const r = run("node", [
    "packages/cli/dist/index.js",
    "preview",
    "--cwd",
    projectRoot,
  ]);
  if (r.status !== 0) throw new Error(`vf preview failed: ${r.stderr}`);
  await fs.cp(
    path.join(projectRoot, "output", "preview-faststart.mp4"),
    path.join(target, "preview.mp4"),
  );
  return target;
};

const report = { runs: [], structuralIdentity: null };
for (const sub of ["r1", "r2"]) {
  const t = await renderInto(sub);
  const p = await probe(path.join(t, "preview.mp4"));
  report.runs.push({
    sub,
    width: p.width,
    height: p.height,
    fps: p.r_frame_rate,
    duration: parseFloat(p.duration),
  });
}
report.structuralIdentity =
  report.runs[0].width === report.runs[1].width &&
  report.runs[0].height === report.runs[1].height &&
  report.runs[0].fps === report.runs[1].fps &&
  Math.abs(report.runs[0].duration - report.runs[1].duration) < 0.1;

await fs.mkdir(".omo/evidence", { recursive: true });
await fs.writeFile(
  ".omo/evidence/task-16-verify.json",
  JSON.stringify(report, null, 2),
);
if (!report.structuralIdentity) {
  console.error("FAIL: render-twice structural identity violated");
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log("OK render-twice structural identity:");
console.log(JSON.stringify(report, null, 2));
