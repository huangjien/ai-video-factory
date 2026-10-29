import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { Command } from "commander";

/** The renderer package is the boundary under test: the CLI only asks it
 *  for a workspace and then spawns the Remotion CLI itself. Stubbing it
 *  keeps the test off the real Remotion binary. */
const loadOrCompileStoryboard = vi.fn();
const prepareStudioWorkspace = vi.fn();

vi.mock("@video/video-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/video-renderer")>();
  return {
    ...actual,
    loadOrCompileStoryboard: loadOrCompileStoryboard,
    prepareStudioWorkspace: prepareStudioWorkspace,
  };
});

const { runStudio } = await import("./studio-command.js");
const { registerStudio } = await import("./studio-command.js");

describe("runStudio — launching the Remotion CLI", () => {
  let root: string;
  let workdir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-studio-launch-"));
    workdir = await mkdtemp(path.join(tmpdir(), "vf-studio-ws-"));
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errors.push(String(m));
    });
    loadOrCompileStoryboard.mockResolvedValue({
      renderPlan: { scenes: [] },
      storyboardText: "scenes: []\n",
      compiledFromVdsl: false,
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  });

  async function makeProject(name: string): Promise<string> {
    const proj = path.join(root, "projects", name);
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState(name));
    return proj;
  }

  /** A stand-in for the Remotion CLI: records its args, exits `code`. */
  async function fakeCli(code: number): Promise<string> {
    const bin = path.join(workdir, "fake-remotion");
    await writeFile(
      bin,
      `#!/bin/sh\necho "$@" > "${path.join(workdir, "args.txt")}"\nexit ${code}\n`,
      "utf8",
    );
    await chmod(bin, 0o755);
    return bin;
  }

  it("spawns the Remotion CLI in the prepared workspace", async () => {
    await makeProject("st-launch");
    const bin = await fakeCli(0);
    prepareStudioWorkspace.mockResolvedValue({
      bin,
      cwd: workdir,
      workspaceDir: workdir,
    });
    const code = await runStudio({ project: "st-launch", cwd: root });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain(`Studio workspace: ${workdir}`);
    expect(out).toContain("Starting Remotion Studio");
  });

  it("passes the requested port through to the CLI", async () => {
    await makeProject("st-port");
    const bin = await fakeCli(0);
    prepareStudioWorkspace.mockResolvedValue({
      bin,
      cwd: workdir,
      workspaceDir: workdir,
    });
    await runStudio({ project: "st-port", cwd: root, port: 4321 });
    const args = await readFile(path.join(workdir, "args.txt"), "utf8");
    expect(args.trim().split(/\s+/)).toEqual(["studio", "--port", "4321"]);
  });

  it("omits the port flag when no port is requested", async () => {
    await makeProject("st-noport");
    const bin = await fakeCli(0);
    prepareStudioWorkspace.mockResolvedValue({
      bin,
      cwd: workdir,
      workspaceDir: workdir,
    });
    await runStudio({ project: "st-noport", cwd: root });
    const args = await readFile(path.join(workdir, "args.txt"), "utf8");
    expect(args.trim()).toBe("studio");
  });

  it("propagates the CLI exit code", async () => {
    await makeProject("st-exit");
    const bin = await fakeCli(7);
    prepareStudioWorkspace.mockResolvedValue({
      bin,
      cwd: workdir,
      workspaceDir: workdir,
    });
    const code = await runStudio({ project: "st-exit", cwd: root });
    expect(code).toBe(7);
  });

  it("reports a failure to start the Remotion CLI", async () => {
    await makeProject("st-nobin");
    prepareStudioWorkspace.mockResolvedValue({
      bin: path.join(workdir, "does-not-exist"),
      cwd: workdir,
      workspaceDir: workdir,
    });
    const code = await runStudio({ project: "st-nobin", cwd: root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("failed to start Remotion CLI");
  });
});

describe("registerStudio", () => {
  it("registers the studio command with the cwd and port options", () => {
    const program = new Command();
    registerStudio(program);
    const cmd = program.commands.find((c) => c.name() === "studio");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--cwd");
    expect(longs).toContain("--port");
  });

  it("runs the studio command through the commander wiring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vf-studio-cmd-"));
    const workdir = await mkdtemp(path.join(tmpdir(), "vf-studio-cmd-ws-"));
    try {
      const proj = path.join(root, "projects", "st-cmd");
      await mkdir(proj, { recursive: true });
      await writeProjectState(proj, initState("st-cmd"));
      const bin = path.join(workdir, "fake-remotion");
      await writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(bin, 0o755);
      loadOrCompileStoryboard.mockResolvedValue({
        renderPlan: { scenes: [] },
        storyboardText: "scenes: []\n",
        compiledFromVdsl: false,
      });
      prepareStudioWorkspace.mockResolvedValue({
        bin,
        cwd: workdir,
        workspaceDir: workdir,
      });
      const program = new Command();
      registerStudio(program);
      await program.parseAsync(
        ["studio", "st-cmd", "--cwd", root, "--port", "4321"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(0);
      process.exitCode = undefined;
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
