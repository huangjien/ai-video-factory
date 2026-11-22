import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
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

// Dynamic import is required: the vi.mock factory above must register
// before the module under test is loaded, or the real MiniMax provider
// ships into the tests.
const { registerShorts, runShorts, selectShortsWindow } = await import(
  "./shorts-command.js"
);

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

  it("keeps the whole vertical master by default (remux, no re-encode)", async () => {
    const outDir = path.join(project, "output");
    await mkdir(outDir, { recursive: true });
    // Portrait 4 s master with audio — h > w so the remux branch fires.
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=4:size=144x256:rate=15",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        path.join(outDir, "final-mixed.mp4"),
      ],
      { stdio: "ignore" },
    );
    const code = await runShorts({ project: "demo", cwd: root });
    expect(code).toBe(0);
    const dur = parseFloat(
      execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
        path.join(project, "youtube", "shorts.mp4"),
      ]).toString().trim(),
    );
    expect(dur).toBeGreaterThan(3.8);
    expect(logs.join("\n")).toMatch(/full@0/);
  });

  it("preserves both side edges when adapting a landscape master to vertical", async () => {
    const outDir = path.join(project, "output");
    await mkdir(outDir, { recursive: true });
    const source = path.join(outDir, "final-mixed.mp4");
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=4:r=15",
      "-vf", "drawbox=x=0:y=0:w=150:h=1080:color=red:t=fill,drawbox=x=1770:y=0:w=150:h=1080:color=red:t=fill",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source,
    ], { stdio: "ignore" });

    const code = await runShorts({ project: "demo", cwd: root });
    expect(code).toBe(0);
    const output = path.join(project, "youtube", "shorts.mp4");
    for (const x of [20, 1060]) {
      const pixel = execFileSync("ffmpeg", [
        "-v", "error", "-i", output, "-frames:v", "1",
        "-vf", `format=rgb24,crop=1:1:${x}:960`, "-f", "rawvideo", "-",
      ]);
      expect(pixel[0] ?? 0).toBeGreaterThan((pixel[2] ?? 0) * 1.5);
    }
  });

  it("cuts a scene-aligned teaser that keeps the hook when --duration is given", async () => {
    const outDir = path.join(project, "output");
    await mkdir(outDir, { recursive: true });
    await mkdir(path.join(project, "storyboard"), { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=4:size=144x256:rate=15",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        path.join(outDir, "final-mixed.mp4"),
      ],
      { stdio: "ignore" },
    );
    // Boundaries at 1.0 / 2.5 / 4.0 — a 2 s teaser must end at 1.0,
    // not chop scene-02 mid-narration.
    await writeFile(
      path.join(project, "storyboard", "storyboard.yaml"),
      "scenes:\n  - id: scene-01\n    duration: 1.0\n  - id: scene-02\n    duration: 1.5\n  - id: scene-03\n    duration: 1.5\n",
      "utf8",
    );
    const code = await runShorts({
      project: "demo",
      cwd: root,
      durationSec: 2,
    });
    expect(code).toBe(0);
    const dur = parseFloat(
      execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
        path.join(project, "youtube", "shorts.mp4"),
      ]).toString().trim(),
    );
    expect(dur).toBeGreaterThan(0.75);
    expect(dur).toBeLessThan(1.3);
  });
});

describe("selectShortsWindow", () => {
  const timings = [
    { duration: 10 },
    { duration: 9 },
    { duration: 11.5 },
  ];

  it("defaults to the whole film", () => {
    const w = selectShortsWindow(timings, 30.5);
    expect(w).toEqual({ start: 0, end: 30.5, full: true });
  });

  it("treats a request >= the master as full", () => {
    expect(selectShortsWindow(timings, 30.5, 60).full).toBe(true);
    expect(selectShortsWindow(timings, 30.5, 30.5).full).toBe(true);
  });

  it("ends a teaser on the last scene boundary that fits", () => {
    // Boundaries at 10 / 19 / 30.5 — a 20 s teaser ends at 19, mid-list
    // never happens.
    expect(selectShortsWindow(timings, 30.5, 20)).toEqual({
      start: 0,
      end: 19,
      full: false,
    });
  });

  it("falls back to the raw request without timings", () => {
    expect(selectShortsWindow([], 30.5, 12)).toEqual({
      start: 0,
      end: 12,
      full: false,
    });
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
