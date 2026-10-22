import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runNew } from "./new-command.js";
import { runApprove } from "./workflow-commands.js";
import { runPreview, runFinal } from "./render-command.js";
import { runQa } from "./qa-command.js";

/**
 * Demo 3 — DevOps Architecture (plan §35/T7.4): 90s, five FlowChart
 * diagram scenes with mixed transitions, plus a hand-drawn canvas
 * closer. §35 acceptance: Diagram / Transitions / Timeline.
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
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      String(SCENE_SECONDS),
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
    cwd = mkdtempSync(path.join(tmpdir(), "video-demo-devops-"));
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
    for (const sceneId of [
      "scene-01",
      "scene-02",
      "scene-03",
      "scene-04",
      "scene-05",
      "scene-06",
    ]) {
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

    expect(await runApprove("devops-architecture", "review", cwd)).toBe(0);
    expect(await runFinal({ projectName: "devops-architecture", cwd })).toBe(0);
    expect(
      existsSync(path.join(projectDir, "output", "final-faststart.mp4")),
    ).toBe(true);
    const state = readFileSync(path.join(projectDir, "state.yaml"), "utf8");
    expect(state).toContain("FINAL_APPROVED");
  }, 900_000);
});
