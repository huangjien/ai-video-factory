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

/**
 * Demo 2 — AI Concept (plan §35/T7.3): renders the committed 60s
 * hand-drawn example end to end and verifies §35's acceptance:
 * hand-drawn style present (luminance spread on the paper scenes) and
 * beat-sync active (stroke onsets quantized to the 100 BPM grid —
 * asserted at the logic level in doodleLogic.test.ts).
 */

const EXAMPLE_DIR = fileURLToPath(
  new URL("../../../examples/ai-concept", import.meta.url),
);
const SCENE_SECONDS = 10;

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

describe("Demo 2 — AI Concept end to end (T7.3, plan §35)", () => {
  let cwd: string;
  let projectDir: string;

  afterAll(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("renders the committed 60s hand-drawn example through the pipeline", async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "vf-demo-ai-"));
    await runNew({ projectId: "ai-concept", cwd });
    projectDir = path.join(cwd, "projects", "ai-concept");
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

    expect(await runApprove("ai-concept", "storyboard", cwd)).toBe(0);
    expect(await runPreview("ai-concept", cwd)).toBe(0);

    // §35 acceptance: 60s total, QA green.
    const qaReport = JSON.parse(
      readFileSync(path.join(projectDir, "qa", "render-report.json"), "utf8"),
    ) as { ok: boolean; checks: { duration: { actualSec: number } } };
    expect(qaReport.ok).toBe(true);
    expect(Math.abs(qaReport.checks.duration.actualSec - 60)).toBeLessThan(2);

    // Hand-drawn style present: paper scenes are bright with ink spread.
    // Sample the LAST scene (star + check on paper).
    const stats = execFileSync(
      "ffmpeg",
      [
        "-ss", "55",
        "-i", path.join(projectDir, "output", "preview-faststart.mp4"),
        "-frames:v", "1",
        "-vf", "signalstats,metadata=print:file=-",
        "-f", "null", "-",
      ],
      { encoding: "utf8" },
    );
    const ymin = Number(stats.match(/YMIN=([\d.]+)/)?.[1]);
    const ymax = Number(stats.match(/YMAX=([\d.]+)/)?.[1]);
    // paper is bright; ink strokes are dark — the spread IS the drawing
    expect(ymax).toBeGreaterThan(150);
    expect(ymax - ymin).toBeGreaterThan(60);

    // QA-gated final reaches FINAL_APPROVED.
    expect(await runApprove("ai-concept", "review", cwd)).toBe(0);
    expect(await runFinal({ projectName: "ai-concept", cwd })).toBe(0);
    expect(
      existsSync(path.join(projectDir, "output", "final-faststart.mp4")),
    ).toBe(true);
    const state = readFileSync(path.join(projectDir, "state.yaml"), "utf8");
    expect(state).toContain("FINAL_APPROVED");
  }, 900_000);
});
