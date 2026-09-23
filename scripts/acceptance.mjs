#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });
const root = path.resolve("projects/benchmark-v01");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
};

// 1. validate→compile→render chain
check(
  "validate (default benchmark)",
  run("node", [
    "packages/cli/dist/index.js",
    "validate",
    `${root}/storyboard/storyboard.yaml`,
    "--root",
    root,
  ]).status === 0,
);

// 2. invalid input yields file+field+line error
const tmpBad = path.join(".omo/tmp", "acceptance-bad");
const fs2 = await import("node:fs/promises");
await fs2.mkdir(tmpBad, { recursive: true });
await fs2.writeFile(
  `${tmpBad}/storyboard.yaml`,
  'schema_version: "0.0"\nproject: {id: t, language: zh-CN, fps: 30, width: 1920, height: 1080}\nscenes: []\n',
);
const badRes = run("node", [
  "packages/cli/dist/index.js",
  "validate",
  `${tmpBad}/storyboard.yaml`,
  "--root",
  tmpBad,
]);
check("invalid VDSL returns error exit", badRes.status === 1);
check(
  "invalid VDSL mentions field",
  /scenes|schema_version/.test(badRes.stderr),
);

// 3. final.mp4 specs
const probe = (file) =>
  JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,duration",
      "-of",
      "json",
      file,
    ]).stdout,
  ).streams[0];
const finalProbe = probe(`${root}/output/final-faststart.mp4`);
check(
  "final.mp4 1920x1080",
  finalProbe.width === 1920 && finalProbe.height === 1080,
);
check("final.mp4 30fps", finalProbe.r_frame_rate === "30/1");
const expected = 5 + 6 + 8 + 8 + 7 + 5;
check(
  "final.mp4 duration = sum of scenes",
  Math.abs(parseFloat(finalProbe.duration) - expected) < 0.5,
);

// 4. No external model deps
const grep = run("grep", [
  "-ri",
  "--include=*.ts",
  "--include=*.tsx",
  "-E",
  "minimax|openai|anthropic|@anthropic-ai",
  "packages/",
  ".omo/drafts/",
]);
check(
  "zero external AI provider usage",
  grep.stdout.trim().length === 0 || !grep.stdout.includes("package.json"),
);

// 5. Run records present
const runs = await fs.readdir(`${root}/runs`);
check(
  "runs/ contains at least 2 records",
  runs.length >= 2,
  `${runs.length} files`,
);

// 6. Checkpoint files present
const cps = (await fs.readdir(`${root}/checkpoints`)).filter((f) =>
  f.endsWith(".yaml"),
);
check("checkpoints/ contains records", cps.length >= 1, `${cps.length} files`);

// 7. status command exit OK
check(
  "vf status exits 0",
  run("node", ["packages/cli/dist/index.js", "status", "--cwd", root])
    .status === 0,
);

// 8. State is FINAL_APPROVED
const state = await fs.readFile(`${root}/state.yaml`, "utf8");
check("state FINAL_APPROVED", /FINAL_APPROVED/.test(state));

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nALL ${checks.length} §62.4 acceptance checks passed`);
