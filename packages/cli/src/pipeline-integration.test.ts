import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPreview, runFinal } from "./render-command.js";
import { runStatus } from "./status-command.js";
import {
  runApprove,
  runReject,
  runRollback,
  runResume,
} from "./workflow-commands.js";

/**
 * These tests exercise the CLI command pipeline at the function level
 * (not the binary). They seed a tmp project with storyboard + TTS audio
 * WAVs, then call runPreview / runApprove / runFinal / runStatus / runReject
 * / runRollback / runResume and verify the state machine + file artifacts.
 *
 * The pipeline depends on a real Remotion/ffmpeg invocation in runPreview /
 * runFinal — those tests take a few seconds each.
 */

async function seedProject(root: string): Promise<string> {
  // runNew's cwd is the BASE dir; the project lands at ${cwd}/projects/<projectId>.
  const projectId = path.basename(root);
  const { runNew } = await import("./new-command.js");
  await runNew({ projectId, cwd: root });
  const projectDir = path.join(root, "projects", projectId);
  const storyboard = `schema_version: "0.1"
project:
  id: ${projectId}
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 5
    narration:
      text: "测试"
    visual:
      component: Title
      props:
        text: "hello"
  - id: scene-02
    duration: 5
    narration:
      text: "世界"
    visual:
      component: Title
      props:
        text: "world"
`;
  writeFileSync(path.join(projectDir, "storyboard", "storyboard.yaml"), storyboard);
  // Seed tiny valid TTS wav files (silent 5s at 8kHz mono)
  for (const scene of ["scene-01", "scene-02"]) {
    writeFileSync(
      path.join(projectDir, "assets", "audio", `${scene}.wav`),
      makeSilentWav(5),
    );
  }
  return projectDir;
}

function makeSilentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds;
  const fileSize = 36 + dataSize;
  const buf = Buffer.alloc(8 + fileSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(fileSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(0x80, 44);
  return buf;
}

function readState(root: string): {
  status: string;
  current_stage: string;
} {
  const text = readFileSync(path.join(root, "state.yaml"), "utf8");
  // tiny YAML parser is overkill — just extract first status and stage lines
  const statusMatch = text.match(/^status:\s*(\S+)/m);
  const stageMatch = text.match(/^current_stage:\s*(\S+)/m);
  return {
    status: statusMatch?.[1] ?? "",
    current_stage: stageMatch?.[1] ?? "",
  };
}

function gitInit(root: string): void {
  // Need git so safeGitHead in the CLI returns a real hash, not "unknown".
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
}

describe("CLI pipeline integration — runPreview / runFinal / runStatus / workflow verbs", () => {
  let cwd: string;
  let projectDir: string;
  // seedProject calls runNew({projectId: path.basename(cwd)}) which
  // creates the project at cwd/projects/<basename(cwd)>. So projectName
  // matches the projectId used at scaffold time.
  let projectName: string;
  let projectCwd: string;

  beforeEach(async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "vf-cli-pipeline-"));
    projectDir = await seedProject(cwd);
    projectName = path.basename(cwd);
    projectCwd = cwd;
    gitInit(projectDir);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  // ----- runPreview -----

  it("runPreview renders preview.mp4 from a seed project", async () => {
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(0);
    expect(existsSync(path.join(projectDir, "output", "preview-faststart.mp4"))).toBe(true);
    const state = readState(projectDir);
    expect(state.status).toBe("WAITING_REVIEW");
    expect(state.current_stage).toBe("review");
  }, 120_000);

  it("runPreview exits 1 when storyboard is missing", async () => {
    rmSync(path.join(projectDir, "storyboard", "storyboard.yaml"));
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(1);
  });

  // ----- runStatus -----

  it("runStatus prints the per-stage checklist for a freshly scaffolded project", async () => {
    const code = await runStatus(projectName, projectCwd);
    expect(code).toBe(0);
  });

  it("runStatus exits 1 when no state.yaml exists (not a project root)", async () => {
    const code = await runStatus("/tmp");
    expect(code).toBe(1);
  });

  // ----- runApprove / runReject -----

  it("runApprove advances review to APPROVED and writes checkpoint", async () => {
    await runPreview(projectName, projectCwd); // produce the WAITING_REVIEW state
    const code = await runApprove(projectName, "review", projectCwd);
    expect(code).toBe(0);
    const state = readState(projectDir);
    expect(state.status).toBe("APPROVED");
    expect(existsSync(path.join(projectDir, "checkpoints", "review.yaml"))).toBe(true);
  }, 120_000);

  it("runReject writes feedback to the checkpoint + transitions to GENERATING", async () => {
    await runPreview(projectName, projectCwd);
    // runReject only appends feedback when the stage checkpoint file
    // exists — preview writes state.yaml but not the checkpoint. Create it.
    mkdirSync(path.join(projectDir, "checkpoints"), { recursive: true });
    writeFileSync(
      path.join(projectDir, "checkpoints", "review.yaml"),
      "id: review-v1\nstage: review\nstatus: in_progress\ncreated_at: '2026-01-01'\nhuman_changes: []\nnotes: ''\n",
    );
    const code = await runReject(projectName, "wrong-pacing", projectCwd);
    expect(code).toBe(0);
    const cp = readFileSync(path.join(projectDir, "checkpoints", "review.yaml"), "utf8");
    expect(cp).toContain("wrong-pacing");
  }, 120_000);

  // ----- runFinal -----

  it("runFinal exits 1 when review is not yet APPROVED", async () => {
    await runPreview(projectName, projectCwd);
    // review is WAITING_REVIEW — runFinal should refuse
    const code = await runFinal({ projectName, cwd: projectCwd });
    expect(code).toBe(1);
  }, 120_000);

  it("runFinal produces final-faststart.mp4 + FINAL_APPROVED state after approval", async () => {
    await runPreview(projectName, projectCwd);
    await runApprove(projectName, "review", projectCwd);
    const code = await runFinal({ projectName, cwd: projectCwd });
    expect(code).toBe(0);
    expect(existsSync(path.join(projectDir, "output", "final-faststart.mp4"))).toBe(true);
    const state = readState(projectDir);
    expect(state.status).toBe("FINAL_APPROVED");
    expect(state.current_stage).toBe("final");
  }, 120_000);

  // ----- runRollback -----

  it("runRollback declines when the confirmation answer is not 'y'", async () => {
    await runPreview(projectName, projectCwd);
    // runRollback reads a confirmation from process.stdin via readline —
    // swap in a PassThrough that answers "n" so the test never blocks.
    const { PassThrough } = await import("node:stream");
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });
    fakeStdin.write("n\n");
    try {
      const code = await runRollback(projectName, "checkpoint-x", projectCwd);
      expect(code).toBe(0);
      const state = readState(projectDir);
      expect(state.status).toBe("WAITING_REVIEW");
    } finally {
      Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
      fakeStdin.destroy();
    }
  }, 120_000);

  // ----- runResume -----

  it("runResume prints a resume summary", async () => {
    await runPreview(projectName, projectCwd);
    const code = await runResume(projectName, projectCwd);
    expect(code).toBe(0);
  }, 60_000);
});
