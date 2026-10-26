import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import type { Provider } from "@video/llm";
import {
  preserveFrontmatterKeys,
  runDraft,
  writeAudioConfigIfAbsent,
} from "./draft-command.js";
import { parseArticle } from "@video/draft";

const DRAFT_JSON = {
  title: "演示文章",
  hook: "开场一句话。",
  sections: [{ heading: "问题", body: "正文内容。" }],
  scenes: [
    {
      id: "scene_1",
      duration: 6,
      caption: "一",
      visual: "图标",
      narration: "第一场旁白。",
    },
  ],
};

let server: Server;
let baseUrl: string;
let projectsRoot: string;
let savedEnv: Record<string, string | undefined> = {};

/** Env keys the v0.7 agent-ask gate keys on. This suite pins "today's
 * path" (pre-ask behavior), but the vitest process itself runs inside
 * zcode — save/strip them like agent-ask.test.ts does. */
const AGENT_ENV_KEYS = [
  "ZCODE_APP_VERSION",
  "CLAUDECODE",
  "VIDEO_ASK_ENV",
  "VIDEO_ASK",
] as const;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(DRAFT_JSON) } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  savedEnv = {
    GLM_API_KEY: process.env["GLM_API_KEY"],
    GLM_BASE_URL: process.env["GLM_BASE_URL"],
  };
  for (const k of AGENT_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env["GLM_API_KEY"] = "test-key";
  process.env["GLM_BASE_URL"] = baseUrl;

  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-draft-cmd-"));
  const proj = path.join(projectsRoot, "projects", "dr-demo");
  await mkdir(path.join(proj, "storyboard"), { recursive: true });
  await writeProjectState(proj, initState("dr-demo"));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise<void>((r) => server.close(() => r()));
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

describe("runDraft — flag validation", () => {
  it("rejects --file and --from together", async () => {
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      ideaFile: "a.md",
      from: "b.md",
      noWeb: true,
    });
    expect(code).toBe(1);
  });

  it("rejects a missing --from file", async () => {
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      from: path.join(projectsRoot, "nope.md"),
      noWeb: true,
    });
    expect(code).toBe(1);
  });

  it("rejects a missing --file", async () => {
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      ideaFile: path.join(projectsRoot, "nope.md"),
      noWeb: true,
    });
    expect(code).toBe(1);
  });

  it("rejects an empty --file", async () => {
    const emptyIdea = path.join(projectsRoot, "empty.md");
    await writeFile(emptyIdea, "   \n", "utf8");
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      ideaFile: emptyIdea,
      noWeb: true,
    });
    expect(code).toBe(1);
  });

  it("rejects an unresolvable project topic", async () => {
    const code = await runDraft({
      topic: "never-created-project",
      cwd: projectsRoot,
      noWeb: true,
    });
    expect(code).toBe(1);
  });
});

describe("runDraft — end to end against a fake LLM", () => {
  it("writes article.md + derived storyboard.yaml, exits 0", async () => {
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      model: "glm",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
    });
    expect(code).toBe(0);

    const proj = path.join(projectsRoot, "projects", "dr-demo");
    const article = await readFile(path.join(proj, "article.md"), "utf8");
    expect(article).toContain("# 演示文章");
    expect(article).toContain("language: zh-CN");
    expect(article).toContain("voice: zh-CN-YunjianNeural");
    // zh drafts bake the f5tts default (2026-10-26) unless a value won
    expect(article).toContain("tts_provider: f5tts");

    const storyboard = await readFile(
      path.join(proj, "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(storyboard).toContain("schema_version");
    expect(storyboard).toContain("scene-01");
  });

  it("keeps a hand-set tts_provider across a re-draft (default is absent-only)", async () => {
    const articlePath = path.join(
      projectsRoot,
      "projects",
      "dr-demo",
      "article.md",
    );
    const before = await readFile(articlePath, "utf8");
    expect(before).toContain("tts_provider: f5tts");
    await writeFile(
      articlePath,
      before.replace("tts_provider: f5tts", "tts_provider: voicebox"),
      "utf8",
    );
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      model: "glm",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
    });
    expect(code).toBe(0);
    const after = await readFile(articlePath, "utf8");
    expect(after).toContain("tts_provider: voicebox");
    expect(after).not.toContain("tts_provider: f5tts");
  });

  it("leaves en-US drafts unstamped (Edge stays the runtime default)", async () => {
    const proj = path.join(projectsRoot, "projects", "dr-en");
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeProjectState(proj, initState("dr-en"));
    const code = await runDraft({
      topic: "dr-en",
      cwd: projectsRoot,
      model: "glm",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
      lang: "en-US",
    });
    expect(code).toBe(0);
    const article = await readFile(path.join(proj, "article.md"), "utf8");
    expect(article).not.toContain("tts_provider:");
  });

  it("stamps --style into the derived storyboard theme", async () => {
    const code = await runDraft({
      topic: "dr-demo",
      cwd: projectsRoot,
      model: "glm",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
      style: "ocean-deep",
    });
    expect(code).toBe(0);
    const storyboard = await readFile(
      path.join(
        projectsRoot,
        "projects",
        "dr-demo",
        "storyboard",
        "storyboard.yaml",
      ),
      "utf8",
    );
    expect(storyboard).toContain('"ocean-deep"');
  });
});

describe("writeAudioConfigIfAbsent", () => {
  const goodProvider: Provider = {
    name: "fake",
    async chat() {
      return {
        content: JSON.stringify({
          voice: "zh-CN-YunjianNeural",
          bgm: "calm",
          sfx: { scene_1: "whoosh" },
        }),
        usage: { input: 1, output: 2 },
      };
    },
  };

  async function articleFixture() {
    return parseArticle(
      `---
project: ap
language: zh-CN
duration_target_sec: 10
voice: zh-CN-YunjianNeural
---

# T

> **Hook** (≤10s): h。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 5
    caption: c
    visual: v
    narration: n
\`\`\`
`,
    );
  }

  it("skips with the flag reason", async () => {
    const r = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      goodProvider,
      null,
      { skip: true },
    );
    expect(r).toEqual({ status: "skipped", reason: "--no-audio-plan" });
  });

  it("skips when audio-config.yaml already exists (hand edits win)", async () => {
    const existing = path.join(projectsRoot, "audio-config.yaml");
    await writeFile(existing, "voice: keep-me\n", "utf8");
    const r = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      goodProvider,
      null,
    );
    expect(r).toEqual({ status: "skipped", reason: "exists" });
    await rm(existing, { force: true });
  });

  it("writes the config from the LLM response", async () => {
    const r = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      goodProvider,
      null,
    );
    expect(r.status).toBe("written");
    const onDisk = await readFile(
      path.join(projectsRoot, "audio-config.yaml"),
      "utf8",
    );
    expect(onDisk).toContain("calm");
    await rm(path.join(projectsRoot, "audio-config.yaml"), { force: true });
  });

  it("degrades to failed when the provider throws", async () => {
    // Message must avoid transient keywords ("network", "timeout", …) —
    // chatWithFallback retries those with backoff and would time out.
    const boom: Provider = {
      name: "fake",
      async chat() {
        throw new Error("boom: provider refused");
      },
    };
    const r = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      boom,
      null,
    );
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toContain(
      "boom: provider refused",
    );
  });
});

// v0.10: `video draft` regenerates a fresh four-key frontmatter and wrote it
// over article.md without reading the old file, so every hand-set durable key
// was lost on the next draft. That silently erased the era `setting:` and made
// the era fix worthless.
describe("preserveFrontmatterKeys", () => {
  const fresh = [
    "---",
    "project: xuanwumen",
    "language: zh-CN",
    "duration_target_sec: 300",
    "voice: zh-CN-YunjianNeural",
    "---",
    "",
    "# body",
  ].join("\n");

  it("carries a hand-set `setting` into the new article", () => {
    const prev = [
      "---",
      "project: xuanwumen",
      "language: zh-CN",
      "duration_target_sec: 300",
      "voice: zh-CN-YunjianNeural",
      "setting: Tang-dynasty China, 626 CE",
      "---",
      "",
      "# old body",
    ].join("\n");
    const out = preserveFrontmatterKeys(fresh, prev);
    expect(out).toContain("setting: Tang-dynasty China, 626 CE");
  });

  it("never carries the keys the drafter owns", () => {
    // duration changed in the new run; the old value must not win.
    const prev = [
      "---",
      "project: old-name",
      "language: en-US",
      "duration_target_sec: 120",
      "voice: en-US-AvaNeural",
      "---",
      "",
      "# old",
    ].join("\n");
    const out = preserveFrontmatterKeys(fresh, prev);
    expect(out).toContain("duration_target_sec: 300");
    expect(out).not.toContain("duration_target_sec: 120");
    expect(out).not.toContain("en-US");
    expect(out).toContain("project: xuanwumen");
  });

  it("carries image_style / image_provider too (they were silently lost)", () => {
    const prev = [
      "---",
      "project: x",
      "image_style: editorial",
      "image_provider: minimax",
      "---",
      "",
    ].join("\n");
    const out = preserveFrontmatterKeys(fresh, prev);
    expect(out).toContain("image_style: editorial");
    expect(out).toContain("image_provider: minimax");
  });

  it("an explicit value in the new draft wins", () => {
    const next = fresh.replace(
      "voice: zh-CN-YunjianNeural",
      "voice: zh-CN-YunjianNeural\nsetting: Song-dynasty China, 1100 CE",
    );
    const prev = [
      "---",
      "project: x",
      "setting: Tang-dynasty China, 626 CE",
      "---",
      "",
    ].join("\n");
    const out = preserveFrontmatterKeys(next, prev);
    expect(out).toContain("setting: Song-dynasty China, 1100 CE");
    expect(out).not.toContain("Tang-dynasty");
  });

  it("no previous article is a no-op", () => {
    expect(preserveFrontmatterKeys(fresh, null)).toBe(fresh);
  });

  it("malformed frontmatter on either side is a no-op", () => {
    expect(preserveFrontmatterKeys("no frontmatter", fresh)).toBe(
      "no frontmatter",
    );
    expect(preserveFrontmatterKeys(fresh, "no frontmatter")).toBe(fresh);
    expect(preserveFrontmatterKeys("---\nunterminated", fresh)).toBe(
      "---\nunterminated",
    );
  });

  it("leaves the body untouched", () => {
    const prev = [
      "---",
      "project: x",
      "setting: S",
      "---",
      "",
      "# very old body",
    ].join("\n");
    const out = preserveFrontmatterKeys(fresh, prev);
    expect(out).toContain("# body");
    expect(out).not.toContain("# very old body");
  });
});
