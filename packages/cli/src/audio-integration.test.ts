import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAudio } from "./audio-command.js";

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "vf-audio-"));
}

function writeProject(
  cwd: string,
  project: string,
  storyboardYaml: string,
  scriptMd: string,
): string {
  const root = path.join(cwd, "projects", project);
  mkdirSync(path.join(root, "storyboard"), { recursive: true });
  mkdirSync(path.join(root, "script"), { recursive: true });
  mkdirSync(path.join(root, "assets", "audio"), { recursive: true });
  mkdirSync(path.join(root, "captions"), { recursive: true });
  writeFileSync(
    path.join(root, "storyboard", "storyboard.yaml"),
    storyboardYaml,
  );
  writeFileSync(path.join(root, "script", "script.zh-CN.md"), scriptMd);
  return root;
}

const STORYBOARD = `schema_version: "0.1"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 5
    narration:
      text: "你好世界"
    visual:
      component: Title
      props:
        text: "hello"
`;

const SCRIPT = `# Script

## Hook
你好世界

## Problem
这是问题

## Explanation
这是解释
`;

describe("vf audio (todo 2) — FakeTTSProvider integration", () => {
  it("writes assets/audio/scene-01.wav + captions/zh-CN.srt + a run record", async () => {
    const cwd = tmpRoot();
    const root = writeProject(cwd, "demo", STORYBOARD, SCRIPT);
    const code = await runAudio({ cwd, project: "demo", fake: true });
    expect(code).toBe(0);
    const wav = readFileSync(
      path.join(root, "assets", "audio", "scene-01.wav"),
    );
    expect(wav.byteLength).toBeGreaterThan(0);
    // Sanity-check it's a real WAV (RIFF header)
    expect(wav.slice(0, 4).toString()).toBe("RIFF");
    expect(wav.slice(8, 12).toString()).toBe("WAVE");

    const srt = readFileSync(path.join(root, "captions", "zh-CN.srt"), "utf8");
    expect(srt).toContain("00:00:00,000 --> 00:00:05,000");
    expect(srt).toContain("你好世界");

    const runs = execFileSync("ls", [path.join(root, "runs")], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(runs.length).toBe(1);
    const record = readFileSync(path.join(root, "runs", runs[0] ?? ""), "utf8");
    expect(record).toContain("stage: audio");
    expect(record).toContain("provider: fake");
  });

  it("exits 1 with helpful error when storyboard missing", async () => {
    const cwd = tmpRoot();
    const code = await runAudio({ cwd, project: "missing", fake: true });
    expect(code).toBe(1);
  });

  it("exits 1 with helpful error when script missing", async () => {
    const cwd = tmpRoot();
    writeProject(cwd, "no-script", STORYBOARD, "");
    // Remove the script file
    unlinkSync(
      path.join(cwd, "projects", "no-script", "script", "script.zh-CN.md"),
    );
    const code = await runAudio({ cwd, project: "no-script", fake: true });
    expect(code).toBe(1);
  });
});
