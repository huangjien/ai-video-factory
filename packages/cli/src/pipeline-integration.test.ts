import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
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
  // runNew slugifies projectId (lowercase, non-alnum → '-'), so the directory
  // name on disk is the slug, NOT the raw basename. On case-sensitive CI
  // filesystems (Linux ext4) reading/writing the raw mixed-case name will
  // ENOENT because mkdtempSync suffixes are mixed case. Match what runNew
  // actually wrote.
  const { slugifyProjectName } = await import("./project-path.js");
  const projectId = slugifyProjectName(path.basename(root));
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
  writeFileSync(
    path.join(projectDir, "storyboard", "storyboard.yaml"),
    storyboard,
  );
  // The preview gate (doc §58: never auto-approve) requires an approved
  // storyboard checkpoint before rendering — approve as the human step.
  const { runApprove } = await import("./workflow-commands.js");
  const approved = await runApprove(projectId, "storyboard", root);
  if (approved !== 0) throw new Error("seed approve storyboard failed");
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
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
}

describe("CLI pipeline integration — runPreview / runFinal / runStatus / workflow verbs", () => {
  let cwd: string;
  let projectDir: string;
  // seedProject slugifies the basename before passing it to runNew, so the
  // project directory on disk is the lowercase slug. projectName must match
  // it — on case-sensitive CI filesystems (Linux ext4) the raw mixed-case
  // basename will not resolve.
  let projectName: string;
  let projectCwd: string;

  beforeEach(async () => {
    cwd = mkdtempSync(path.join(tmpdir(), "vf-cli-pipeline-"));
    projectDir = await seedProject(cwd);
    projectName = path.basename(projectDir);
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
    expect(
      existsSync(path.join(projectDir, "output", "preview-faststart.mp4")),
    ).toBe(true);
    // QA groundwork (plan §28/T3.3): report + contact sheet after render.
    const qaDir = path.join(projectDir, "qa");
    expect(existsSync(path.join(qaDir, "render-report.json"))).toBe(true);
    expect(existsSync(path.join(qaDir, "contact-sheet.png"))).toBe(true);
    const report = JSON.parse(
      readFileSync(path.join(qaDir, "render-report.json"), "utf8"),
    ) as { ok: boolean; checks: { duration: { actualSec: number } } };
    expect(report.checks.duration.actualSec).toBeGreaterThan(9);
    const state = readState(projectDir);
    expect(state.status).toBe("WAITING_REVIEW");
    expect(state.current_stage).toBe("review");
  }, 120_000);

  it("writes vdsl.yaml, caches per-scene renders, versions scenes, restores (§6/§26/Principle 1)", async () => {
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(0);

    // vdsl.yaml is a real artifact now, compiled from the storyboard.
    const vdslPath = path.join(projectDir, "vdsl", "vdsl.yaml");
    expect(existsSync(vdslPath)).toBe(true);
    const vdsl = readFileSync(vdslPath, "utf8");
    expect(vdsl).toContain("scene-01");
    expect(vdsl).toContain("scene-02");

    // First preview records v1 for every scene (plan §26).
    const { listSceneVersions } = await import("@vf/workflow");
    expect(
      (await listSceneVersions(projectDir, "scene-01")).map((v) => v.version),
    ).toEqual([1]);

    // Per-scene cache files exist; an unchanged re-render reuses them.
    const scenesDir = path.join(projectDir, "scenes");
    const f1 = path.join(scenesDir, "00-scene-01.mp4");
    const f2 = path.join(scenesDir, "01-scene-02.mp4");
    expect(existsSync(f1)).toBe(true);
    expect(existsSync(f2)).toBe(true);
    const m1 = statSync(f1).mtimeMs;
    const m2 = statSync(f2).mtimeMs;
    rmSync(path.join(projectDir, "output", "preview.mp4"), { force: true });
    expect(await runPreview(projectName, projectCwd)).toBe(0);
    expect(statSync(f1).mtimeMs).toBe(m1);
    expect(statSync(f2).mtimeMs).toBe(m2);
    expect(existsSync(path.join(projectDir, "output", "preview.mp4"))).toBe(
      true,
    );

    // A pure mtime touch must NOT invalidate — content is what matters.
    const sbPath = path.join(projectDir, "storyboard", "storyboard.yaml");
    const future = new Date(Date.now() + 5000);
    utimesSync(sbPath, future, future);
    expect(await runPreview(projectName, projectCwd)).toBe(0);
    expect(statSync(f1).mtimeMs).toBe(m1);

    // Editing ONE scene re-renders only that scene and records v2.
    const edited = readFileSync(sbPath, "utf8").replace(
      'text: "world"',
      'text: "world v2"',
    );
    writeFileSync(sbPath, edited);
    expect(await runPreview(projectName, projectCwd)).toBe(0);
    expect(statSync(f1).mtimeMs).toBe(m1); // sibling cached
    const m2b = statSync(f2).mtimeMs;
    expect(m2b).not.toBe(m2); // edited scene re-rendered
    expect(
      (await listSceneVersions(projectDir, "scene-02")).map((v) => v.version),
    ).toEqual([1, 2]);

    // Restore v1: splices the old fragment back; only scene-02 re-renders.
    const { runSceneRestore } = await import("./scene-command.js");
    expect(await runSceneRestore(projectName, "scene-02", 1, projectCwd)).toBe(
      0,
    );
    const m1c = statSync(f1).mtimeMs;
    expect(await runPreview(projectName, projectCwd)).toBe(0);
    expect(statSync(f1).mtimeMs).toBe(m1c);
    expect(statSync(f2).mtimeMs).not.toBe(m2b);
    const restored = readFileSync(sbPath, "utf8");
    expect(restored).toContain('text: "world"');
    expect(restored).not.toContain("world v2");
  }, 300_000);

  it("runPreview --draft renders 960x540@15 (plan §27)", async () => {
    const code = await runPreview(projectName, projectCwd, false, {
      draft: true,
    });
    expect(code).toBe(0);
    expect(existsSync(path.join(projectDir, "scenes-draft"))).toBe(true);
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate",
        "-of",
        "json",
        path.join(projectDir, "output", "preview.mp4"),
      ],
      { encoding: "utf8" },
    );
    const s = JSON.parse(out).streams[0];
    expect(s.width).toBe(960);
    expect(s.height).toBe(540);
    expect(s.r_frame_rate).toBe("15/1");
  }, 180_000);

  it("runPreview exits 1 when storyboard is missing", async () => {
    rmSync(path.join(projectDir, "storyboard", "storyboard.yaml"));
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(1);
  });

  it("runPreview refuses to render without an approved storyboard checkpoint", async () => {
    rmSync(path.join(projectDir, "checkpoints"), {
      recursive: true,
      force: true,
    });
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(1);
    expect(
      existsSync(path.join(projectDir, "output", "preview-faststart.mp4")),
    ).toBe(false);
  }, 60_000);

  it("runPreview --force renders without approval and lands in WAITING_REVIEW", async () => {
    rmSync(path.join(projectDir, "checkpoints"), {
      recursive: true,
      force: true,
    });
    const code = await runPreview(projectName, projectCwd, true);
    expect(code).toBe(0);
    const state = readState(projectDir);
    expect(state.status).toBe("WAITING_REVIEW");
  }, 120_000);

  it("runPreview refuses a FINAL_APPROVED project (terminal state)", async () => {
    const { writeProjectState } = await import("@vf/workflow");
    await writeProjectState(projectDir, {
      status: "FINAL_APPROVED",
      current_stage: "final",
      checkpoint: { id: "seed-final", status: "FINAL_APPROVED" },
      history_tail: [],
    });
    const code = await runPreview(projectName, projectCwd);
    expect(code).toBe(1);
  }, 60_000);

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
    expect(
      existsSync(path.join(projectDir, "checkpoints", "review.yaml")),
    ).toBe(true);
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
    const cp = readFileSync(
      path.join(projectDir, "checkpoints", "review.yaml"),
      "utf8",
    );
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
    expect(
      existsSync(path.join(projectDir, "output", "final-faststart.mp4")),
    ).toBe(true);
    const state = readState(projectDir);
    expect(state.status).toBe("FINAL_APPROVED");
    expect(state.current_stage).toBe("final");
  }, 120_000);

  // ----- runRollback -----

  function readCheckpointId(stage: string): string {
    const text = readFileSync(
      path.join(projectDir, "checkpoints", `${stage}.yaml`),
      "utf8",
    );
    return text.match(/^id:\s*(\S+)/m)?.[1] ?? "";
  }

  it("runRollback declines when the confirmation answer is not 'y'", async () => {
    await runPreview(projectName, projectCwd);
    const id = readCheckpointId("storyboard");
    const { PassThrough } = await import("node:stream");
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
    });
    fakeStdin.write("n\n");
    try {
      const code = await runRollback(projectName, id, projectCwd);
      expect(code).toBe(0);
      const state = readState(projectDir);
      expect(state.status).toBe("WAITING_REVIEW");
    } finally {
      Object.defineProperty(process, "stdin", {
        value: realStdin,
        configurable: true,
      });
      fakeStdin.destroy();
    }
  }, 120_000);

  it("runRollback rejects unknown checkpoint ids", async () => {
    await runPreview(projectName, projectCwd);
    const { PassThrough } = await import("node:stream");
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
    });
    fakeStdin.write("y\n");
    try {
      const code = await runRollback(projectName, "checkpoint-x", projectCwd);
      expect(code).toBe(1);
      const state = readState(projectDir);
      expect(state.status).toBe("WAITING_REVIEW"); // untouched
    } finally {
      Object.defineProperty(process, "stdin", {
        value: realStdin,
        configurable: true,
      });
      fakeStdin.destroy();
    }
  }, 120_000);

  it("runRollback invalidates downstream checkpoints and lands at DRAFT/target", async () => {
    await runPreview(projectName, projectCwd); // WAITING_REVIEW
    // A downstream checkpoint to invalidate (as vf approve review would write).
    mkdirSync(path.join(projectDir, "checkpoints"), { recursive: true });
    writeFileSync(
      path.join(projectDir, "checkpoints", "review.yaml"),
      "id: review-v1\nstage: review\nstatus: approved\ncreated_at: '2026-01-01'\nhuman_changes: []\nnotes: ''\n",
    );
    const id = readCheckpointId("storyboard");
    const { PassThrough } = await import("node:stream");
    const fakeStdin = new PassThrough();
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: fakeStdin,
      configurable: true,
    });
    fakeStdin.write("y\n");
    try {
      // One-argument form: checkpoint id only, project auto-discovered.
      const code = await runRollback(undefined, id, projectCwd);
      expect(code).toBe(0);
      const state = readState(projectDir);
      expect(state.status).toBe("DRAFT");
      expect(state.current_stage).toBe("storyboard");
      const review = readFileSync(
        path.join(projectDir, "checkpoints", "review.yaml"),
        "utf8",
      );
      expect(review).toContain("invalidated");
      expect(review).toContain("id: review-v1"); // history preserved
      // Audit trail: a rollback run record exists.
      expect(existsSync(path.join(projectDir, "runs"))).toBe(true);
    } finally {
      Object.defineProperty(process, "stdin", {
        value: realStdin,
        configurable: true,
      });
      fakeStdin.destroy();
    }
  }, 120_000);

  // ----- runResume -----

  it("runResume prints a resume summary", async () => {
    await runPreview(projectName, projectCwd);
    const code = await runResume(projectName, projectCwd);
    expect(code).toBe(0);
  }, 60_000);

  it("runQa passes on a healthy project and re-uses the rendered preview", async () => {
    await runPreview(projectName, projectCwd);
    const { runQa } = await import("./qa-command.js");
    const code = await runQa({ project: projectName, cwd: projectCwd });
    expect(code).toBe(0);
  }, 120_000);

  it("runResume no-ops on a FINAL_APPROVED project", async () => {
    const { writeProjectState } = await import("@vf/workflow");
    await writeProjectState(projectDir, {
      status: "FINAL_APPROVED",
      current_stage: "final",
      checkpoint: { id: "seed-final", status: "FINAL_APPROVED" },
      history_tail: [],
    });
    const code = await runResume(projectName, projectCwd);
    expect(code).toBe(0);
  }, 60_000);
});
