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
  const root = mkdtempSync(path.join(tmpdir(), "video-cli-"));
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

describe("video validate (end command)", () => {
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

  describe("unknown theme hint", () => {
    /** Capture console.error / console.log for a single invocation so the
     *  hint assertions can match strings without polluting stdout. */
    async function captureAndValidate(yamlText: string): Promise<{
      stdout: string;
      stderr: string;
      exit: number;
    }> {
      const root = makeProject("scene-01.wav");
      writeFileSync(
        path.join(root, "storyboard", "storyboard.yaml"),
        yamlText,
      );
      const orig = { log: console.log, error: console.error };
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      console.log = (...chunks: unknown[]) =>
        stdoutChunks.push(chunks.map(stringify).join(" "));
      console.error = (...chunks: unknown[]) =>
        stderrChunks.push(chunks.map(stringify).join(" "));
      try {
        const exit = await runValidate(
          path.join(root, "storyboard", "storyboard.yaml"),
          root,
        );
        return {
          stdout: stdoutChunks.join("\n"),
          stderr: stderrChunks.join("\n"),
          exit,
        };
      } finally {
        console.log = orig.log;
        console.error = orig.error;
      }
    }
    const stringify = (v: unknown) =>
      typeof v === "string" ? v : JSON.stringify(v);

    /** Insert `style:` as a top-level sibling of `project:` and `scenes:`
     *  by anchoring before the `scenes:` line. Naive `.replace("  id: ...")`
     *  breaks YAML indentation because `style:` becomes zero-indented and
     *  the remaining project fields reparent to it. */
    function withStyle(themeName: string): string {
      return storyboardYaml.replace(
        /^(scenes:)/m,
        `style:\n  theme: ${themeName}\n$1`,
      );
    }

    it("hints when style.theme names an unknown palette (exit 0)", async () => {
      const { stdout, stderr, exit } = await captureAndValidate(
        withStyle("youtube-red-replaced"), // post-rename typo
      );
      expect(exit).toBe(0);
      expect(stderr).toContain("hint: style.theme");
      expect(stderr).toContain("youtube-red-replaced");
      expect(stdout).toContain("valid");
    });

    it("stays silent when style.theme names a known palette", async () => {
      const { stderr, exit } = await captureAndValidate(withStyle("ai-red"));
      expect(exit).toBe(0);
      expect(stderr).not.toContain("hint: style.theme");
    });

    it("stays silent when style.theme is missing entirely (default is paper-light)", async () => {
      const { stderr, exit } = await captureAndValidate(storyboardYaml);
      expect(exit).toBe(0);
      expect(stderr).not.toContain("hint: style.theme");
    });
  });
});
