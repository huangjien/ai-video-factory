import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  appendCheckpoint,
  initState,
  writeProjectState,
} from "@video/workflow";
import {
  registerWorkflow,
  runApprove,
  runReject,
  runResume,
  runReset,
  runRollback,
} from "./workflow-commands.js";

let projectsRoot: string;

beforeAll(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-wf-cli-"));
});

afterAll(async () => {
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
  vi.restoreAllMocks();
});

async function makeProject(name: string): Promise<string> {
  const proj = path.join(projectsRoot, "projects", name);
  await mkdir(path.join(proj, "storyboard"), { recursive: true });
  await writeProjectState(proj, initState(name));
  return proj;
}

async function atReviewGate(proj: string): Promise<void> {
  const state = initState(path.basename(proj));
  state.status = "WAITING_REVIEW";
  state.current_stage = "storyboard";
  await writeProjectState(proj, state);
  await writeFile(
    path.join(proj, "storyboard", "storyboard.yaml"),
    'schema_version: "0.1"\n',
    "utf8",
  );
  await appendCheckpoint(proj, {
    id: "storyboard-test",
    stage: "storyboard",
    status: "approved",
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    human_changes: [],
    notes: "",
  });
}

describe("workflow verb wrappers — resolution failures", () => {
  it("runApprove / runReject / runRollback / runResume fail on an unknown project", async () => {
    for (const fn of [
      (cwd: string) => runApprove("ghost", "storyboard", cwd, false),
      (cwd: string) => runReject("ghost", "wrong-content", cwd),
      (cwd: string) => runRollback("ghost", "some-id", cwd),
      (cwd: string) => runResume("ghost", cwd),
      (cwd: string) => runReset("ghost", "init", cwd, false),
    ]) {
      expect(await fn(projectsRoot)).toBe(1);
    }
  });
});

describe("workflow verb wrappers — happy paths", () => {
  it("runApprove approves a WAITING_REVIEW storyboard gate", async () => {
    const proj = await makeProject("wf-approve");
    await atReviewGate(proj);
    expect(await runApprove("wf-approve", "storyboard", projectsRoot)).toBe(0);
  });

  it("runReject records the reason on the checkpoint", async () => {
    const proj = await makeProject("wf-reject");
    await atReviewGate(proj);
    expect(await runReject("wf-reject", "wrong-pacing", projectsRoot)).toBe(0);
  });

  it("runReset rewinds to DRAFT", async () => {
    const proj = await makeProject("wf-reset");
    await atReviewGate(proj);
    await runApprove("wf-reset", "storyboard", projectsRoot);
    expect(await runReset("wf-reset", "storyboard", projectsRoot)).toBe(0);
  });

  it("runRollback rejects an unknown checkpoint id via the wrapper", async () => {
    await makeProject("wf-rb");
    expect(await runRollback("wf-rb", "no-such-checkpoint", projectsRoot)).toBe(
      1,
    );
  });
});

describe("runResume — cli-flow branches", () => {
  it("prints the next-command hint for a storyboard-stage project", async () => {
    const proj = await makeProject("wf-resume");
    const state = initState("wf-resume");
    state.current_stage = "storyboard";
    await writeProjectState(proj, state);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    expect(await runResume("wf-resume", projectsRoot)).toBe(0);
    expect(logs.join("\n")).toContain("video audio");
  });

  it("reports nothing to resume for a FINAL_APPROVED project", async () => {
    const proj = await makeProject("wf-final");
    const state = initState("wf-final");
    state.status = "FINAL_APPROVED";
    await writeProjectState(proj, state);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    expect(await runResume("wf-final", projectsRoot)).toBe(0);
    expect(logs.join("\n")).toContain("nothing to resume");
  });
});

describe("registerWorkflow — commander one-argument forms", () => {
  // The one-arg forms auto-discover the project, so each test gets its own
  // isolated root holding exactly one project.
  async function soloRoot(name: string): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), `vf-wf-solo-${name}-`));
    const proj = path.join(root, "projects", name);
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeProjectState(proj, initState(name));
    await atReviewGate(proj);
    return root;
  }

  function program(): Command {
    const p = new Command();
    p.exitOverride(); // never process.exit on help/errors
    registerWorkflow(p);
    return p;
  }

  it("`video reject <reason>` shuffles the arg into the reason slot", async () => {
    const root = await soloRoot("solo");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const p = program();
    await p.parseAsync([
      "node",
      "video",
      "reject",
      "wrong-content",
      "--cwd",
      root,
    ]);
    expect(process.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("rejected: wrong-content");
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("`video reject` without any argument errors", async () => {
    const err = vi
      .spyOn(console, "error")
      .mockImplementation((m?: unknown) => void String(m));
    const p = program();
    await p.parseAsync(["node", "video", "reject", "--cwd", projectsRoot]);
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("missing reason");
    process.exitCode = 0;
  });

  it("`video rollback <id>` shuffles the arg into the checkpoint slot", async () => {
    const root = await soloRoot("solorb");
    const err = vi
      .spyOn(console, "error")
      .mockImplementation((m?: unknown) => void String(m));
    const p = program();
    await p.parseAsync([
      "node",
      "video",
      "rollback",
      "definitely-missing",
      "--cwd",
      root,
    ]);
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain(
      'unknown checkpoint "definitely-missing"',
    );
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });
});
