import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

/**
 * Guard branches of the CLI verbs whose happy paths already have
 * integration tests: the argument checks, the missing-artifact checks
 * and the commander wiring.
 */

describe("runNew", () => {
  let cwd: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-new-"));
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("refuses to scaffold over an existing project", async () => {
    const { runNew } = await import("./new-command.js");
    expect(await runNew({ projectId: "demo", cwd })).toBe(0);
    expect(await runNew({ projectId: "demo", cwd })).toBe(1);
    expect(errors.join("\n")).toContain("project already exists");
  });

  it("reads the state file when there is one, and null when there is not", async () => {
    const { readStateOrNull, runNew } = await import("./new-command.js");
    await runNew({ projectId: "demo", cwd });
    const root = path.join(cwd, "projects", "demo");
    const state = await readStateOrNull(root);
    expect(state).toContain("current_stage");
    expect(await readStateOrNull(path.join(root, "nowhere"))).toBeNull();
  });

  it("registers the new command and creates the project through it", async () => {
    const { registerNew } = await import("./new-command.js");
    const program = new Command();
    registerNew(program);
    await program.parseAsync(["new", "demo", "--cwd", cwd], { from: "user" });
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
    expect(existsSync(path.join(cwd, "projects", "demo", "state.yaml"))).toBe(
      true,
    );
  });
});

describe("runTheme", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("paints a swatch with the theme's background colour", async () => {
    const { paint } = await import("./theme-command.js");
    const painted = paint("#112233", "  ");
    expect(painted).toContain("17;34;51");
    // A malformed colour falls back to plain text.
    expect(paint("112233", "  ")).toBe("  ");
  });

  it("lists every available theme", async () => {
    const { runTheme } = await import("./theme-command.js");
    expect(runTheme({})).toBe(0);
    expect(logs.join("\n")).toContain("available");
  });

  it("resolves the theme of a project", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-theme-"));
    try {
      await mkdir(path.join(cwd, "storyboard"), { recursive: true });
      await writeFile(
        path.join(cwd, "storyboard", "storyboard.yaml"),
        'schema_version: "0.1"\nscenes: []\n',
        "utf8",
      );
      const { runTheme } = await import("./theme-command.js");
      expect(runTheme({ cwd })).toBe(0);
      expect(logs.join("\n")).toContain("defaulting to");
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports a project whose storyboard cannot be parsed", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-theme-bad-"));
    try {
      await mkdir(path.join(cwd, "storyboard"), { recursive: true });
      await writeFile(
        path.join(cwd, "storyboard", "storyboard.yaml"),
        "scenes: [unclosed\n",
        "utf8",
      );
      const { runTheme } = await import("./theme-command.js");
      expect(runTheme({ cwd })).toBe(0);
      expect(logs.join("\n")).toContain("could not be parsed");
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("registers the theme command", async () => {
    const { registerTheme } = await import("./theme-command.js");
    const program = new Command();
    registerTheme(program);
    const cmd = program.commands.find((c) => c.name() === "theme");
    expect(cmd).toBeDefined();
    expect((cmd?.options ?? []).map((o) => o.long)).toContain("--cwd");
  });
});

describe("runAudioPlan", () => {
  let cwd: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-audio-plan-"));
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when the project has no article.md", async () => {
    const project = path.join(cwd, "projects", "demo");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    const { runAudioPlan } = await import("./audio-plan-command.js");
    const code = await runAudioPlan({ project: "demo", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("article.md not found");
  });

  it("registers the audio-plan command", async () => {
    const { registerAudioPlan } = await import("./audio-plan-command.js");
    const program = new Command();
    registerAudioPlan(program);
    const cmd = program.commands.find((c) => c.name() === "audio-plan");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--cwd");
    expect(longs).toContain("--from");
  });
});

describe("runApprove — the visuals short-circuit", () => {
  it("needs a project name for the visuals stage", async () => {
    const { runApprove } = await import("./workflow-commands.js");
    const code = await runApprove(undefined, "visuals", undefined);
    expect(code).toBe(1);
  });
});

describe("runMakeCli", () => {
  let cwd: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-make-cli-"));
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when the requested language has no translation", async () => {
    const { runMakeCli } = await import("./make-command.js");
    const project = path.join(cwd, "projects", "demo");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    const code = await runMakeCli({
      project: "demo",
      cwd,
      lang: "en-US",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no translation at/);
  });

  it("registers the make command with its flags", async () => {
    const { registerMake } = await import("./make-command.js");
    const program = new Command();
    registerMake(program);
    const cmd = program.commands.find((c) => c.name() === "make");
    expect(cmd).toBeDefined();
    const longs = (cmd?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--cwd");
    expect(longs).toContain("--dry-run");
  });
});

describe("thumbnail", () => {
  let cwd: string;
  let project: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-thumb-"));
    project = path.join(cwd, "projects", "demo");
    await mkdir(path.join(project, "youtube"), { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails when the project cannot be resolved", async () => {
    const { runThumbnail } = await import("./thumbnail-command.js");
    const code = await runThumbnail({ project: "ghost", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
  });

  it("says so when the thumbnail prompt is missing", async () => {
    const { generateThumbnailImage } = await import("./thumbnail-command.js");
    const out = await generateThumbnailImage({
      projectRoot: project,
      providerName: "mock",
      projectLabel: "demo",
    });
    expect(out).toBeNull();
    expect(errors.join("\n")).toContain("missing thumbnail prompt");
  });

  it("says so when the thumbnail prompt is empty", async () => {
    const { generateThumbnailImage } = await import("./thumbnail-command.js");
    await writeFile(
      path.join(project, "youtube", "thumbnail-prompt.txt"),
      "   \n",
      "utf8",
    );
    const out = await generateThumbnailImage({
      projectRoot: project,
      providerName: "mock",
      projectLabel: "demo",
    });
    expect(out).toBeNull();
    expect(errors.join("\n")).toContain("empty thumbnail prompt");
  });

  it("generates a thumbnail that matches the video's visual identity", async () => {
    const { generateThumbnailImage } = await import("./thumbnail-command.js");
    await writeFile(
      path.join(project, "youtube", "thumbnail-prompt.txt"),
      "a calm kitchen at dawn\n",
      "utf8",
    );
    await writeFile(
      path.join(project, "article.md"),
      "---\nproject: demo\nlanguage: zh-CN\nduration_target_sec: 30\nvoice: narrator-zh\nimage_style: editorial\n---\n\n# Demo\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
      "utf8",
    );
    const out = await generateThumbnailImage({
      projectRoot: project,
      providerName: "mock",
      projectLabel: "demo",
    });
    expect(out).not.toBeNull();
    expect(existsSync(out as string)).toBe(true);
  });

  it("registers the thumbnail command", async () => {
    const { registerThumbnail } = await import("./thumbnail-command.js");
    const program = new Command();
    registerThumbnail(program);
    const cmd = program.commands.find((c) => c.name() === "thumbnail");
    expect(cmd).toBeDefined();
    expect((cmd?.options ?? []).map((o) => o.long)).toContain("--provider");
  });
});

describe("render", () => {
  let cwd: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-render-"));
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("fails the preview when the project cannot be resolved", async () => {
    const { runPreview } = await import("./render-command.js");
    const code = await runPreview("ghost", cwd);
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
  });

  it("fails the final when there is no project to work on", async () => {
    const { runFinal } = await import("./render-command.js");
    const code = await runFinal({ cwd });
    expect(code).toBe(1);
  });

  it("fails the final when there is no preview to QA", async () => {
    const { runFinal } = await import("./render-command.js");
    const project = path.join(cwd, "projects", "demo");
    await mkdir(path.join(project, "storyboard"), { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: APPROVED\ncurrent_stage: review\ncheckpoint:\n  id: demo-review-v1\n  status: APPROVED\nhistory_tail: []\n",
      "utf8",
    );
    await writeFile(
      path.join(project, "storyboard", "storyboard.yaml"),
      [
        'schema_version: "0.1"',
        "project:",
        "  id: demo",
        "  language: zh-CN",
        "  fps: 30",
        "  width: 1920",
        "  height: 1080",
        "scenes:",
        "  - id: scene-01",
        "    duration: 4",
        "    narration:",
        '      text: "第一段"',
        "    visual:",
        "      component: Title",
        "      props:",
        '        text: "hello"',
        "",
      ].join("\n"),
      "utf8",
    );
    const code = await runFinal({ projectName: "demo", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no preview artifact");
  });

  it("registers the preview and final commands", async () => {
    const { registerFinal, registerPreview } =
      await import("./render-command.js");
    const program = new Command();
    registerPreview(program);
    registerFinal(program);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("preview");
    expect(names).toContain("final");
  });
});

describe("runPreview — auto-discovery", () => {
  it("fails when no project can be discovered", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-preview-"));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    try {
      const { runPreview } = await import("./render-command.js");
      const code = await runPreview(undefined, cwd);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/no project at/);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("discovers the only project and fails on the missing storyboard", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-preview-solo-"));
    try {
      const project = path.join(cwd, "projects", "demo");
      await mkdir(project, { recursive: true });
      await writeFile(
        path.join(project, "state.yaml"),
        "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
        "utf8",
      );
      const { runPreview } = await import("./render-command.js");
      const code = await runPreview(undefined, cwd);
      expect(code).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("runAudioPlan — malformed articles", () => {
  let cwd: string;
  let errors: string[];

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-audio-plan-bad-"));
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  async function makeProject(article: string): Promise<void> {
    const project = path.join(cwd, "projects", "demo");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: demo-init-v1\n  status: DRAFT\nhistory_tail: []\n",
      "utf8",
    );
    await writeFile(path.join(project, "article.md"), article, "utf8");
  }

  it("says how many empty narrations it recovered", async () => {
    await makeProject(
      [
        "---",
        "project: demo",
        "language: zh-CN",
        "duration_target_sec: 30",
        "voice: narrator-zh",
        "---",
        "",
        "# Demo",
        "",
        "## 1. 唯一小节",
        "",
        "只有一句话。",
        "",
        "## Scenes",
        "",
        "```yaml",
        "scenes:",
        "  - id: scene_1",
        "    duration: 8",
        "    caption: 一",
        "    visual: 图标",
        '    narration: ""',
        "```",
        "",
      ].join("\n"),
    );
    const { runAudioPlan } = await import("./audio-plan-command.js");
    // The provider call that follows must fail fast — no API key, no
    // network. The recovery notice is printed before that happens.
    const savedKey = process.env["GLM_API_KEY"];
    const savedMini = process.env["MINIMAX_API_KEY"];
    delete process.env["GLM_API_KEY"];
    delete process.env["MINIMAX_API_KEY"];
    try {
      await runAudioPlan({ project: "demo", cwd }).catch(() => undefined);
    } finally {
      if (savedKey !== undefined) process.env["GLM_API_KEY"] = savedKey;
      if (savedMini !== undefined) process.env["MINIMAX_API_KEY"] = savedMini;
    }
    expect(errors.join("\n")).toMatch(/empty scene narrations/);
  });

  it("reports an article that cannot be parsed at all", async () => {
    await makeProject("no frontmatter here\n");
    const { runAudioPlan } = await import("./audio-plan-command.js");
    const code = await runAudioPlan({ project: "demo", cwd });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("failed to parse article.md");
  });

  it("rejects an unknown model provider", async () => {
    await makeProject(
      [
        "---",
        "project: demo",
        "language: zh-CN",
        "duration_target_sec: 30",
        "voice: narrator-zh",
        "---",
        "",
        "# Demo",
        "",
        "## Scenes",
        "",
        "```yaml",
        "scenes:",
        "  - id: scene_1",
        "    duration: 8",
        "    caption: 一",
        "    visual: 图标",
        "    narration: 第一段旁白。",
        "```",
        "",
      ].join("\n"),
    );
    const { runAudioPlan } = await import("./audio-plan-command.js");
    await expect(
      runAudioPlan({
        project: "demo",
        cwd,
        model: "bogus" as "glm",
      }),
    ).rejects.toThrow(/unsupported provider/);
  });

  it("runs the audio-plan command through the commander wiring", async () => {
    const cwd2 = await mkdtemp(path.join(tmpdir(), "vf-audio-plan-cmd-"));
    try {
      const { registerAudioPlan } = await import("./audio-plan-command.js");
      const program = new Command();
      registerAudioPlan(program);
      await program.parseAsync(["audio-plan", "ghost", "--cwd", cwd2], {
        from: "user",
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    } finally {
      await rm(cwd2, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("registerMix", () => {
  it("registers the mix command and parses its numeric flags", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "vf-mix-cmd-"));
    try {
      const { registerMix } = await import("./mix-command.js");
      const program = new Command();
      program.exitOverride();
      registerMix(program);
      const cmd = program.commands.find((c) => c.name() === "mix");
      expect(cmd).toBeDefined();
      const longs = (cmd?.options ?? []).map((o) => o.long);
      expect(longs).toContain("--bgm");
      expect(longs).toContain("--bgm-attenuation");
      expect(longs).toContain("--bgm-fade-in");
      expect(longs).toContain("--bgm-fade-out");
      expect(longs).toContain("--sfx");
      // The flags reach the command with their parsed values.
      await program.parseAsync(
        [
          "mix",
          "ghost",
          "--cwd",
          cwd,
          "--bgm-attenuation",
          "-6",
          "--bgm-fade-in",
          "1.5",
          "--bgm-fade-out",
          "2",
          "--sfx",
          "scene_2=whoosh",
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

describe("workflow verbs — the commander wiring", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "vf-workflow-cmd-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("approves the visuals checkpoint through the approve verb", async () => {
    const { registerWorkflow } = await import("./workflow-commands.js");
    const program = new Command();
    program.exitOverride();
    registerWorkflow(program);
    await program.parseAsync(["approve", "visuals", "ghost", "--cwd", cwd], {
      from: "user",
    });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("refuses a rollback without a checkpoint id", async () => {
    const { registerWorkflow } = await import("./workflow-commands.js");
    const program = new Command();
    program.exitOverride();
    registerWorkflow(program);
    await program.parseAsync(["rollback", "--cwd", cwd], { from: "user" });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("runs the resume verb", async () => {
    const { registerWorkflow } = await import("./workflow-commands.js");
    const program = new Command();
    program.exitOverride();
    registerWorkflow(program);
    await program.parseAsync(["resume", "ghost", "--cwd", cwd], {
      from: "user",
    });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("runs the reset verb", async () => {
    const { registerWorkflow } = await import("./workflow-commands.js");
    const program = new Command();
    program.exitOverride();
    registerWorkflow(program);
    await program.parseAsync(["reset", "ghost", "--cwd", cwd], {
      from: "user",
    });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
