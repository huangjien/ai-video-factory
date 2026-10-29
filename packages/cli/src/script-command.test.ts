import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

/** The script agent is the boundary under test — the stub keeps the
 *  command's own branches (guards, artifacts) offline. */
const callScript = vi.hoisted(() => vi.fn());
const callScriptError = vi.hoisted(() => vi.fn());

vi.mock("@video/script", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/script")>();
  return { ...actual, callScript: callScript };
});

const { registerScript, runScript } = await import("./script-command.js");

describe("runScript", () => {
  let cwd: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-script-"));
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    callScript.mockResolvedValue({
      script: {
        title: "测试标题",
        hook: "开场一句话。",
        sections: [{ heading: "问题", body: "正文内容。" }],
      },
      usage: { input: 10, output: 20 },
      providerName: "glm",
      messages: [{ role: "user", content: "写个脚本" }],
    });
    callScriptError.mockReturnValue(null);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when --from-research points at a directory without research.md", async () => {
    const code = await runScript({
      topic: "测试主题",
      cwd,
      fromResearch: path.join(cwd, "nowhere"),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("missing research.md");
  });

  it("reports an agent failure", async () => {
    callScript.mockRejectedValue(new Error("provider is down"));
    const code = await runScript({ topic: "测试主题", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("provider is down");
  });

  it("writes the script for a successful run", async () => {
    const code = await runScript({ topic: "测试主题", cwd });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("script");
  });
});

describe("registerScript", () => {
  it("registers the script command with its flags", () => {
    const program = new Command();
    registerScript(program);
    const cmd = program.commands.find((c) => c.name() === "script");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--cwd");
    expect(longs).toContain("--from-research");
  });

  it("runs the script command through the commander wiring", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-script-cmd-"));
    try {
      const program = new Command();
      registerScript(program);
      await program.parseAsync(
        [
          "script",
          "主题",
          "--cwd",
          cwd,
          "--from-research",
          path.join(cwd, "nope"),
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
