import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runValidate } from "./validate-command.js";

const storyboardYaml = `schema_version: "0.1"
project:
  id: cli-test
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "测试"
      audio: assets/audio/scene-01.wav
    visual:
      component: Title
      props:
        text: "测试"
`;

function makeProject(audioFile: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "vf-cli-"));
  mkdirSync(path.join(root, "storyboard"), { recursive: true });
  mkdirSync(path.join(root, "assets", "audio"), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "3",
      path.join(root, "assets", "audio", audioFile),
    ],
    { stdio: "ignore" },
  );
  writeFileSync(
    path.join(root, "storyboard", "storyboard.yaml"),
    storyboardYaml,
  );
  return root;
}

describe("vf validate (end command)", () => {
  it("exits 0 on a valid project", async () => {
    const root = makeProject("scene-01.wav");
    const code = await runValidate(
      path.join(root, "storyboard", "storyboard.yaml"),
      root,
    );
    expect(code).toBe(0);
  });

  it("exits 1 naming the missing audio file and field", async () => {
    const root = makeProject("scene-01.wav");
    const yamlText = storyboardYaml.replace(
      "assets/audio/scene-01.wav",
      "assets/audio/missing.wav",
    );
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), yamlText);
    const code = await runValidate(
      path.join(root, "storyboard", "storyboard.yaml"),
      root,
    );
    expect(code).toBe(1);
  });
});
