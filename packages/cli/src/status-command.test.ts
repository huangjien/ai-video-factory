import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { Command } from "commander";
import { registerStatus, runStatus } from "./status-command.js";

describe("runStatus", () => {
  let root: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-status-"));
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errors.push(String(m));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  async function makeProject(name: string): Promise<string> {
    const proj = path.join(root, "projects", name);
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState(name));
    return proj;
  }

  it("prints the stage checklist for a named project", async () => {
    await makeProject("st-demo");
    const code = await runStatus("st-demo", root);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("Pipeline");
    expect(out).toContain("init");
    expect(out).toContain("Status: DRAFT");
  });

  it("auto-discovers the only project when no name is given", async () => {
    await makeProject("st-solo");
    const code = await runStatus(undefined, root);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("Pipeline");
  });

  it("fails when no project can be resolved", async () => {
    const code = await runStatus(undefined, root);
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project at/);
  });

  it("fails when the project directory carries no state.yaml", async () => {
    const proj = path.join(root, "projects", "st-nostate");
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeFile(
      path.join(proj, "storyboard", "storyboard.yaml"),
      "scenes: []\n",
      "utf8",
    );
    const code = await runStatus("st-nostate", root);
    expect(code).toBe(1);
  });

  it("summarizes the QA findings from the render report", async () => {
    await makeProject("st-qa");
    const proj = path.join(root, "projects", "st-qa");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      JSON.stringify({
        findings: [
          { level: "error", message: "black frame" },
          { level: "warn", message: "low contrast" },
          { level: "warn", message: "slow fade" },
        ],
      }),
      "utf8",
    );
    const code = await runStatus("st-qa", root);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("1 error,");
    expect(out).toContain("2 warnings");
    // Blocking errors point at the override escape hatch.
    expect(out).toContain("video qa <project>");
  });

  it("keeps the singular form for a single finding", async () => {
    await makeProject("st-qa1");
    const proj = path.join(root, "projects", "st-qa1");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      JSON.stringify({ findings: [{ level: "error" }] }),
      "utf8",
    );
    const code = await runStatus("st-qa1", root);
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("1 error,");
    expect(out).toContain("0 warnings");
  });

  it("flags a corrupt render report instead of printing nothing", async () => {
    await makeProject("st-corrupt");
    const proj = path.join(root, "projects", "st-corrupt");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      "findings: [unclosed\n",
      "utf8",
    );
    const code = await runStatus("st-corrupt", root);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("report unreadable");
  });
});

describe("registerStatus", () => {
  it("registers the status command with an optional project argument", () => {
    const program = new Command();
    registerStatus(program);
    const cmd = program.commands.find((c) => c.name() === "status");
    expect(cmd).toBeDefined();
    expect(cmd?.options.map((o) => o.long)).toContain("--cwd");
  });

  it("runs the status command through the commander wiring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vf-status-cmd-"));
    try {
      const proj = path.join(root, "projects", "st-cmd");
      await mkdir(proj, { recursive: true });
      await writeProjectState(proj, initState("st-cmd"));
      const program = new Command();
      registerStatus(program);
      await program.parseAsync(["status", "st-cmd", "--cwd", root], {
        from: "user",
      });
      expect(process.exitCode).toBe(0);
      process.exitCode = undefined;
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});
