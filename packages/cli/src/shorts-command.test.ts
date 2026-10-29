import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

/** The MiniMax video API is the boundary under test — the stub keeps the
 *  command's own branch logic (thumbnail, hook, run record) offline. */
const generate = vi.hoisted(() => vi.fn());
const generateError = vi.hoisted(() => vi.fn());

vi.mock("@video/media-generators", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@video/media-generators")>();
  class FakeMiniMaxVideoProvider {
    readonly name = "minimax-video";
    async generate(req: Parameters<typeof generate>[0]) {
      const err = generateError();
      if (err) throw err;
      return generate(req);
    }
  }
  return { ...actual, MiniMaxVideoProvider: FakeMiniMaxVideoProvider };
});

const { registerShorts, runShorts } = await import("./shorts-command.js");

describe("runShorts", () => {
  let root: string;
  let project: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-shorts-"));
    project = path.join(root, "projects", "demo");
    await mkdir(path.join(project, "youtube"), { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    generate.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "video/mp4",
    });
    generateError.mockReturnValue(null);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when the project cannot be resolved", async () => {
    const code = await runShorts({ project: "ghost", cwd: root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
  });

  it("fails when the minimax path has no thumbnail", async () => {
    const code = await runShorts({
      project: "demo",
      cwd: root,
      providerName: "minimax",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("missing thumbnail");
  });

  it("fails when the minimax path has no shorts hook", async () => {
    await writeFile(path.join(project, "youtube", "thumbnail.jpg"), "x");
    const code = await runShorts({
      project: "demo",
      cwd: root,
      providerName: "minimax",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("missing shorts hook");
  });

  it("writes the generated short and the run record", async () => {
    await writeFile(path.join(project, "youtube", "thumbnail.jpg"), "x");
    await writeFile(
      path.join(project, "youtube", "shorts-hook.txt"),
      "a person leans toward camera\n",
      "utf8",
    );
    const code = await runShorts({
      project: "demo",
      cwd: root,
      providerName: "minimax",
      durationSec: 7,
    });
    expect(code).toBe(0);
    expect(existsSync(path.join(project, "youtube", "shorts.mp4"))).toBe(true);
    // The hook text is the prompt the model was asked to render.
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      prompt: "a person leans toward camera",
      durationSec: 7,
    });
    expect(existsSync(path.join(project, "runs"))).toBe(true);
  });

  it("reports a video generation failure", async () => {
    await writeFile(path.join(project, "youtube", "thumbnail.jpg"), "x");
    await writeFile(
      path.join(project, "youtube", "shorts-hook.txt"),
      "hook\n",
      "utf8",
    );
    generateError.mockReturnValue(new Error("quota exhausted"));
    const code = await runShorts({
      project: "demo",
      cwd: root,
      providerName: "minimax",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("quota exhausted");
  });

  it("fails when the mock path has no rendered mp4 to cut", async () => {
    const code = await runShorts({ project: "demo", cwd: root });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("missing final mp4");
  });
});

describe("registerShorts", () => {
  it("registers the shorts command with its flags", () => {
    const program = new Command();
    registerShorts(program);
    const cmd = program.commands.find((c) => c.name() === "shorts");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--duration");
    expect(longs).toContain("--start");
    expect(longs).toContain("--provider");
  });

  it("runs the shorts command through the commander wiring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vf-shorts-cmd-"));
    try {
      const program = new Command();
      registerShorts(program);
      await program.parseAsync(["shorts", "ghost", "--cwd", root], {
        from: "user",
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});
