import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

/** The motion agent is the boundary under test — the stub keeps the
 *  command's own branches offline. */
const callMotionAgent = vi.hoisted(() => vi.fn());

vi.mock("@video/motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/motion")>();
  return { ...actual, callMotionAgent: callMotionAgent };
});

const { registerMotion, runMotion } = await import("./motion-command.js");

const STORYBOARD = `schema_version: "0.1"

project:
  id: motion-demo
  language: zh-CN
  fps: 30
  width: 640
  height: 360

scenes:
  - id: scene-01
    duration: 4
    narration:
      text: "第一段"
    visual:
      component: Title
      props:
        text: "hello"
`;

describe("runMotion", () => {
  let cwd: string;
  let project: string;
  let logs: string[];
  let warnings: string[];
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-motion-"));
    project = path.join(cwd, "projects", "motion-demo");
    await mkdir(path.join(project, "storyboard"), { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: motion-demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    await writeFile(
      path.join(project, "storyboard", "storyboard.yaml"),
      STORYBOARD,
      "utf8",
    );
    logs = [];
    warnings = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "warn").mockImplementation((m?: unknown) => {
      warnings.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    callMotionAgent.mockResolvedValue({
      spec: { animations: [], transition: null, kenBurnsScale: 0 },
      usage: { input: 5, output: 5 },
      providerName: "glm",
      messages: [{ role: "user", content: "plan motion" }],
    });
  });

  afterEach(async () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when the project cannot be resolved", async () => {
    const code = await runMotion({ project: "ghost", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
  });

  it("fails when the project has no storyboard", async () => {
    const bare = path.join(cwd, "projects", "bare");
    await mkdir(bare, { recursive: true });
    await writeFile(
      path.join(bare, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: bare-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    const code = await runMotion({ project: "bare", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no storyboard");
  });

  it("fails when the storyboard does not validate", async () => {
    await writeFile(
      path.join(project, "storyboard", "storyboard.yaml"),
      'schema_version: "0.1"\nscenes: []\n',
      "utf8",
    );
    const code = await runMotion({ project: "motion-demo", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("storyboard invalid");
  });

  it("falls back to the deterministic baseline when the agent fails", async () => {
    callMotionAgent.mockRejectedValue(new Error("provider is down"));
    const code = await runMotion({ project: "motion-demo", cwd });
    expect(code).toBe(0);
    expect(warnings.join("\n")).toContain("agent failed");
  });
});

describe("registerMotion", () => {
  it("registers the motion command with its flags", () => {
    const program = new Command();
    registerMotion(program);
    const cmd = program.commands.find((c) => c.name() === "motion");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--baseline");
    expect(longs).toContain("--bpm");
    expect(longs).toContain("--scene");
  });

  it("runs the motion command through the commander wiring", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-motion-cmd-"));
    try {
      const program = new Command();
      registerMotion(program);
      await program.parseAsync(["motion", "ghost", "--cwd", cwd], {
        from: "user",
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
