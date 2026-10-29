import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

/** The storyboard agent is the boundary under test — the stub keeps the
 *  command's own branches (guards, artifacts) offline. */
const callAgent = vi.hoisted(() => vi.fn());

vi.mock("@video/agent-storyboard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@video/agent-storyboard")>();
  return { ...actual, callAgent: callAgent };
});

const { registerStoryboard, runStoryboard } =
  await import("./storyboard-command.js");

const STORYBOARD = {
  schema_version: "0.1",
  project: {
    id: "demo",
    language: "zh-CN",
    fps: 30,
    width: 1920,
    height: 1080,
  },
  scenes: [
    {
      id: "scene-01",
      duration: 4,
      narration: { text: "第一段" },
      visual: { component: "Title", props: { text: "hello" } },
    },
  ],
};

describe("runStoryboard", () => {
  let cwd: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-storyboard-"));
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    callAgent.mockResolvedValue({
      storyboard: STORYBOARD,
      usage: { input: 10, output: 20 },
      providerName: "glm",
      messages: [{ role: "user", content: "写个分镜" }],
      repaired: false,
    });
  });

  afterEach(async () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when --from-research has no research.md", async () => {
    const code = await runStoryboard({
      topic: "测试主题",
      cwd,
      fromResearch: path.join(cwd, "nowhere"),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("missing research.md");
  });

  it("fails when --from-script points at a missing file", async () => {
    const code = await runStoryboard({
      topic: "测试主题",
      cwd,
      fromScript: path.join(cwd, "no-script.md"),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("--from-script file not found");
  });

  it("reports an agent failure", async () => {
    callAgent.mockRejectedValue(new Error("provider is down"));
    const code = await runStoryboard({ topic: "测试主题", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("provider is down");
  });

  it("writes the storyboard for a successful run", async () => {
    const code = await runStoryboard({ topic: "测试主题", cwd });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("storyboard");
  });
});

describe("registerStoryboard", () => {
  it("registers the storyboard command with its flags", () => {
    const program = new Command();
    registerStoryboard(program);
    const cmd = program.commands.find((c) => c.name() === "storyboard");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--cwd");
    expect(longs).toContain("--from-research");
    expect(longs).toContain("--from-script");
  });

  it("runs the storyboard command through the commander wiring", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-storyboard-cmd-"));
    try {
      const program = new Command();
      registerStoryboard(program);
      await program.parseAsync(
        [
          "storyboard",
          "主题",
          "--cwd",
          cwd,
          "--from-script",
          path.join(cwd, "no-script.md"),
        ],
        { from: "user" },
      );
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
