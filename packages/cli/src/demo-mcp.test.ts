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
import { runMotion } from "./motion-command.js";
import { listSceneVersions } from "@video/workflow";

/**
 * Demo 1 — MCP Explainer (plan §35/T7.2): renders the committed example
 * END TO END with real Remotion/ffmpeg renders and checks the §36 DoD
 * items that can be verified mechanically:
 *   storyboard → motion → approve gate → preview (incremental) → QA ok →
 *   excalidraw assets → approve review → QA-gated final → FINAL_APPROVED.
 * Deterministic: hand-authored storyboard, silent narration WAVs.
 */

const EXAMPLE_DIR = fileURLToPath(
  new URL("../../../examples/mcp-explainer", import.meta.url),
);
const SCENE_SECONDS = 9;

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

describe("Demo 1 — MCP Explainer end to end (T7.2, plan §35)", () => {
  let cwd: string;
  let projectDir: string;

  afterAll(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("renders the committed example through the full pipeline", async () => {
    // §36: storyboard can be human-authored and validated.
    const storyboard = readFileSync(path.join(EXAMPLE_DIR, "storyboard.yaml"), "utf8");
    expect(storyboard).toContain("SvgScene");

    cwd = mkdtempSync(path.join(tmpdir(), "video-demo-mcp-"));
    await runNew({ projectId: "mcp-explainer", cwd });
    projectDir = path.join(cwd, "projects", "mcp-explainer");
    copyFileSync(
      path.join(EXAMPLE_DIR, "storyboard.yaml"),
      path.join(projectDir, "storyboard", "storyboard.yaml"),
    );
    mkdirSync(path.join(projectDir, "captions"), { recursive: true });
    copyFileSync(
      path.join(EXAMPLE_DIR, "captions", "zh-CN.srt"),
      path.join(projectDir, "captions", "zh-CN.srt"),
    );
    for (const sceneId of ["scene-01", "scene-02", "scene-03", "scene-04", "scene-05"]) {
      makeSilentWav(projectDir, sceneId);
    }

    // Motion first (generation step, pre-approval): baseline plans motion
    // for the scenes that don't declare animations[] (T4.2).
    expect(
      await runMotion({ project: "mcp-explainer", cwd, baseline: true }),
    ).toBe(0);

    // Human gate: preview refuses without an approved storyboard (§36:
    // approval is persisted state).
    const unapproved = await runPreview("mcp-explainer", cwd);
    expect(unapproved).toBe(1);
    expect(await runApprove("mcp-explainer", "storyboard", cwd)).toBe(0);

    // Preview renders all five scenes (svg + canvas + remotion families)
    // and produces the QA report + contact sheet.
    expect(await runPreview("mcp-explainer", cwd)).toBe(0);
    expect(existsSync(path.join(projectDir, "qa", "render-report.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "qa", "contact-sheet.png"))).toBe(true);

    // Scene versions exist (§26) — recorded at preview.
    expect(
      (await listSceneVersions(projectDir, "scene-03")).length,
    ).toBeGreaterThanOrEqual(1);

    // QA passes on the healthy demo (§36: QA automated).
    const qaReport = JSON.parse(
      readFileSync(path.join(projectDir, "qa", "render-report.json"), "utf8"),
    ) as { ok: boolean; checks: { duration: { actualSec: number } } };
    expect(qaReport.ok).toBe(true);
    // 5 × 9s narration, synced durations ≈ 45s total.
    expect(Math.abs(qaReport.checks.duration.actualSec - 45)).toBeLessThan(2);

    // The canvas scene actually painted: frame at t≈40s (scene-05) must
    // have luminance spread (paper + ink), not a flat frame.
    const stats = execFileSync(
      "ffmpeg",
      [
        "-ss", "40",
        "-i", path.join(projectDir, "output", "preview-faststart.mp4"),
        "-frames:v", "1",
        "-vf", "signalstats,metadata=print:file=-",
        "-f", "null", "-",
      ],
      { encoding: "utf8" },
    );
    const ymin = Number(stats.match(/YMIN=([\d.]+)/)?.[1]);
    const ymax = Number(stats.match(/YMAX=([\d.]+)/)?.[1]);
    expect(ymax - ymin).toBeGreaterThan(30);

    // Excalidraw assets for the three diagram scenes (T7.1).
    expect(await runExcalidraw({ project: "mcp-explainer", cwd })).toBe(0);
    for (const sceneId of ["scene-02", "scene-03", "scene-04"]) {
      expect(
        existsSync(path.join(projectDir, "assets", "excalidraw", `${sceneId}.excalidraw`)),
      ).toBe(true);
    }

    // Final render is QA-gated (T6.2) and reaches FINAL_APPROVED.
    expect(await runApprove("mcp-explainer", "review", cwd)).toBe(0);
    expect(await runFinal({ projectName: "mcp-explainer", cwd })).toBe(0);
    expect(
      existsSync(path.join(projectDir, "output", "final-faststart.mp4")),
    ).toBe(true);
    const state = readFileSync(path.join(projectDir, "state.yaml"), "utf8");
    expect(state).toContain("FINAL_APPROVED");
  }, 900_000);
});
