import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import {
  l10nRootOrThrow,
  registerTranslate,
  runTranslate,
} from "./translate-command.js";
import { Command } from "commander";

const CANONICAL = `---
project: translate-demo
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
image_style: editorial
---

# 翻译演示

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: 标题场景
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      第一段的旁白内容。
\`\`\`
`;

/** A translation that keeps the scene id but rewrites the prose — the
 *  visual line may be mangled, the pipeline pins it back. */
const TRANSLATED = `---
project: translate-demo
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Translation demo

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    visual: a totally different picture
    narration: |
      Narration for the first scene.
\`\`\`
`;

/** Two scenes where the canonical has one — a structural violation. */
const TRANSLATED_BROKEN = `---
project: translate-demo
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Translation demo

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      Narration for the first scene.
  - id: scene_2
    duration: 10
    caption: Extra scene
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      Narration for the second scene.
\`\`\`
`;

async function makeProject(
  root: string,
  name: string,
  article = CANONICAL,
): Promise<string> {
  const proj = path.join(root, "projects", name);
  await mkdir(proj, { recursive: true });
  // A real project always has the canonical image store — the l10n
  // workdir symlinks to it.
  await mkdir(path.join(proj, "assets", "images"), { recursive: true });
  await writeFile(
    path.join(proj, "state.yaml"),
    `status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: ${name}-init-v1\n  status: DRAFT\nhistory_tail: []\n`,
    "utf8",
  );
  await writeFile(path.join(proj, "article.md"), article, "utf8");
  return proj;
}

describe("l10nRootOrThrow", () => {
  it("resolves the l10n workdir when the translated article exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vidl10n-"));
    await mkdir(path.join(root, "l10n", "en-US"), { recursive: true });
    await writeFile(
      path.join(root, "article.md"),
      "---\nproject: t\nlanguage: zh-CN\nduration_target_sec: 30\nvoice: narrator-zh\n---\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "l10n", "en-US", "article.md"),
      "---\nproject: t\nlanguage: en-US\nduration_target_sec: 30\nvoice: en-US-ChristopherNeural\n---\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
      "utf8",
    );
    try {
      expect(l10nRootOrThrow(root, "en-US")).toBe(
        path.join(root, "l10n", "en-US"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("errors with the translate hint when the workdir is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vidl10n-"));
    await mkdir(path.join(root, "l10n", "en-US"), { recursive: true });
    await writeFile(
      path.join(root, "article.md"),
      "---\nproject: t\nlanguage: zh-CN\nduration_target_sec: 30\nvoice: narrator-zh\n---\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
      "utf8",
    );
    try {
      expect(() => l10nRootOrThrow(root, "zh-CN")).toThrow(/video translate/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runTranslate", () => {
  let server: Server;
  let baseUrl: string;
  let projectsRoot: string;
  let savedEnv: { key: string | undefined; base: string | undefined };
  /** Response the fake GLM server hands back for the next call. */
  let nextContent: string;
  let nextStatus: number;
  let logs: string[];
  let errors: string[];

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.statusCode = nextStatus;
      res.setHeader("Content-Type", "application/json");
      if (nextStatus !== 200) {
        res.end("provider is down");
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { content: nextContent } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    savedEnv = {
      key: process.env["GLM_API_KEY"],
      base: process.env["GLM_BASE_URL"],
    };
    process.env["GLM_API_KEY"] = "test-key";
    process.env["GLM_BASE_URL"] = baseUrl;
    projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-translate-"));
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((r) => server.close(() => r()));
    await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    nextContent = TRANSLATED;
    nextStatus = 200;
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errors.push(String(m));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unsupported languages before touching the project", async () => {
    const code = await runTranslate({
      project: "whatever",
      lang: "fr-FR",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain('unsupported language "fr-FR"');
  });

  it("fails when the project cannot be resolved", async () => {
    const code = await runTranslate({
      project: "ghost",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
  });

  it("fails when the project is already in the target language", async () => {
    await makeProject(
      projectsRoot,
      "tr-same",
      CANONICAL.replace("language: zh-CN", "language: en-US"),
    );
    const code = await runTranslate({
      project: "tr-same",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/already en-US/);
  });

  it("translates the article into a language workdir and prints the next step", async () => {
    await makeProject(projectsRoot, "tr-ok");
    const code = await runTranslate({
      project: "tr-ok",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("translate zh-CN → en-US");
    expect(out).toContain("translated article");
    expect(out).toContain("next: video approve storyboard");
    // The l10n workdir is a full project root — it carries its own
    // article, storyboard and state.
    const l10n = path.join(projectsRoot, "projects", "tr-ok", "l10n", "en-US");
    expect(existsSync(path.join(l10n, "article.md"))).toBe(true);
    expect(existsSync(path.join(l10n, "storyboard", "storyboard.yaml"))).toBe(
      true,
    );
    expect(existsSync(path.join(l10n, "state.yaml"))).toBe(true);
    // The canonical visual line is pinned back byte-for-byte.
    expect(readFileSync(path.join(l10n, "article.md"), "utf8")).toContain(
      "深蓝会议桌上的一份提案卡片，冷白顶灯",
    );
  });

  it("reports the structural violations when the translation breaks the contract", async () => {
    nextContent = TRANSLATED_BROKEN;
    await makeProject(projectsRoot, "tr-broken");
    const code = await runTranslate({
      project: "tr-broken",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(code).toBe(1);
    const err = errors.join("\n");
    expect(err).toContain("translate failed:");
    expect(err).toMatch(/scene count/);
  });

  it("reports a provider failure without the violation list", async () => {
    nextStatus = 500;
    await makeProject(projectsRoot, "tr-500");
    const code = await runTranslate({
      project: "tr-500",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("translate failed:");
  });

  it("refuses to overwrite an existing translation unless --force is passed", async () => {
    await makeProject(projectsRoot, "tr-force");
    const first = await runTranslate({
      project: "tr-force",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(first).toBe(0);
    const second = await runTranslate({
      project: "tr-force",
      lang: "en-US",
      cwd: projectsRoot,
    });
    expect(second).toBe(1);
    expect(errors.join("\n")).toMatch(/pass --force/);
    const forced = await runTranslate({
      project: "tr-force",
      lang: "en-US",
      cwd: projectsRoot,
      force: true,
    });
    expect(forced, errors.join("\n")).toBe(0);
  });

  it("uses the minimax provider when the model option asks for it", async () => {
    const savedKey = process.env["MINIMAX_API_KEY"];
    const savedHost = process.env["MINIMAX_API_HOST"];
    process.env["MINIMAX_API_KEY"] = "test-key";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    try {
      await makeProject(projectsRoot, "tr-minimax");
      const code = await runTranslate({
        project: "tr-minimax",
        lang: "en-US",
        cwd: projectsRoot,
        model: "minimax",
      });
      expect(code).toBe(0);
      expect(
        existsSync(
          path.join(
            projectsRoot,
            "projects",
            "tr-minimax",
            "l10n",
            "en-US",
            "article.md",
          ),
        ),
      ).toBe(true);
    } finally {
      if (savedKey === undefined) delete process.env["MINIMAX_API_KEY"];
      else process.env["MINIMAX_API_KEY"] = savedKey;
      if (savedHost === undefined) delete process.env["MINIMAX_API_HOST"];
      else process.env["MINIMAX_API_HOST"] = savedHost;
    }
  });

  describe("registerTranslate", () => {
    it("registers the translate command with the language argument and flags", () => {
      const program = new Command();
      registerTranslate(program);
      const cmd = program.commands.find((c) => c.name() === "translate");
      expect(cmd).toBeDefined();
      const longs = (cmd?.options ?? []).map((o) => o.long);
      expect(longs).toContain("--cwd");
      expect(longs).toContain("--model");
      expect(longs).toContain("--voice");
      expect(longs).toContain("--force");
    });

    it("runs the translate command through the commander wiring", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "vf-translate-cmd-"));
      try {
        await makeProject(root, "tr-cmd");
        const program = new Command();
        registerTranslate(program);
        await program.parseAsync(
          ["translate", "tr-cmd", "en-US", "--cwd", root],
          { from: "user" },
        );
        expect(process.exitCode).toBe(0);
        process.exitCode = undefined;
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
