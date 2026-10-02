import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runNew } from "./new-command.js";
import { runApprove } from "./workflow-commands.js";
import { runPreview, runFinal } from "./render-command.js";
import { runQa } from "./qa-command.js";
import { runExcalidraw } from "./excalidraw-command.js";

/**
 * Demo 3 — DevOps Architecture (plan §35/T7.4): 90s, five SVG diagram
 * scenes with target-driven camera moves, mixed transitions, and
 * excalidraw asset generation. §35 acceptance: Diagram / Camera /
 * Transitions / Timeline — camera verified mechanically in
 * svgSceneLogic.test.ts and by a before/hold pixel-diff here.
 */

const EXAMPLE_DIR = fileURLToPath(
  new URL("../../../examples/devops-architecture", import.meta.url),
);
const SCENE_SECONDS = 15;

function makeSilentWav(projectDir: string, sceneId: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", String(SCENE_SECONDS),
      path.join(projectDir, "assets", "audio", `${sceneId}.wav`),
    ],
    { stdio: "ignore" },
  );
}

describe("Demo 3 — DevOps Architecture end to end (T7.4, plan §35)", () => {
  let cwd: string;
  let projectDir: string;

  afterAll(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("renders the committed 90s diagram example through the pipeline", async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "vf-demo-devops-"));
    await runNew({ projectId: "devops-architecture", cwd });
    projectDir = path.join(cwd, "projects", "devops-architecture");
    copyFileSync(
      path.join(EXAMPLE_DIR, "storyboard.yaml"),
      path.join(projectDir, "storyboard", "storyboard.yaml"),
    );
    mkdirSync(path.join(projectDir, "captions"), { recursive: true });
    copyFileSync(
      path.join(EXAMPLE_DIR, "captions", "zh-CN.srt"),
      path.join(projectDir, "captions", "zh-CN.srt"),
    );
    for (const sceneId of ["scene-01", "scene-02", "scene-03", "scene-04", "scene-05", "scene-06"]) {
      makeSilentWav(projectDir, sceneId);
    }

    expect(await runApprove("devops-architecture", "storyboard", cwd)).toBe(0);
    expect(await runPreview("devops-architecture", cwd)).toBe(0);

    // §35 acceptance: 90s total, QA green.
    const qaReport = JSON.parse(
      readFileSync(path.join(projectDir, "qa", "render-report.json"), "utf8"),
    ) as { ok: boolean; checks: { duration: { actualSec: number } } };
    expect(qaReport.ok).toBe(true);
    expect(Math.abs(qaReport.checks.duration.actualSec - 90)).toBeLessThan(2);

    // CAMERA: scene-03 (starts at 30s). Before the camera (t=33s) the
    // test-env node is small; at camera hold (t=36s) it fills more of the
    // frame — the CENTER crop flips from background to node fill.
    const video = path.join(projectDir, "output", "preview-faststart.mp4");
    // Bright (stroke/text) pixel count in the center 300x300 box:
    // before the camera the box holds at most the thin arrow + its small
    // label; at camera hold the focused node's thick stroke frame and
    // scaled-up text fill it — 2.5x+ more bright structure.
    const brightInCenter = (t: string): number => {
      const png = path.join(projectDir, "qa", `cam-${t.replace(".", "_")}.png`);
      execFileSync(
        "ffmpeg",
        ["-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", "crop=300:300", png],
        { stdio: "ignore" },
      );
      const rgb = execFileSync(
        "ffmpeg",
        ["-i", png, "-vf", "format=rgb24", "-f", "rawvideo", "-"],
        { encoding: "buffer", maxBuffer: 1e8 },
      );
      let bright = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        const luma = 0.2126 * rgb[i]! + 0.7152 * rgb[i + 1]! + 0.0722 * rgb[i + 2]!;
        if (luma > 200) bright += 1;
      }
      return bright;
    };
    const before = brightInCenter("33.5");
    const hold = brightInCenter("37.5");
    expect(hold).toBeGreaterThan(before * 2.5);

    // Excalidraw assets for the four diagram scenes (T7.1).
    expect(await runExcalidraw({ project: "devops-architecture", cwd })).toBe(0);
    for (const sceneId of ["scene-02", "scene-03", "scene-04", "scene-05"]) {
      expect(
        existsSync(path.join(projectDir, "assets", "excalidraw", `${sceneId}.excalidraw`)),
      ).toBe(true);
    }

    expect(await runApprove("devops-architecture", "review", cwd)).toBe(0);
    expect(await runFinal({ projectName: "devops-architecture", cwd })).toBe(0);
    expect(
      existsSync(path.join(projectDir, "output", "final-faststart.mp4")),
    ).toBe(true);
    const state = readFileSync(path.join(projectDir, "state.yaml"), "utf8");
    expect(state).toContain("FINAL_APPROVED");
  }, 900_000);
});
