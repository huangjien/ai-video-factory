import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import type { Provider } from "@video/llm";
import {
  frontmatterValue,
  preserveFrontmatterKeys,
  resolveNarrationConfig,
  runDraft,
  stampFrontmatterKey,
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
    expect(article).toContain("voice: Chinese (Mandarin)_Male_Announcer");
    // drafts bake the minimax default (2026-10-28) unless a value won
    expect(article).toContain("tts_provider: minimax");

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
    expect(before).toContain("tts_provider: minimax");
    await writeFile(
      articlePath,
      before.replace("tts_provider: minimax", "tts_provider: voicebox"),
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
    expect(after).not.toContain("tts_provider: minimax");
  });

  it("stamps en-US drafts with the minimax default too", async () => {
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
    expect(article).toContain("tts_provider: minimax");
    expect(article).toContain("voice: English_expressive_narrator");
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

/**
 * The narration backend and the voice id are ONE decision — a voice id
 * only means something to the backend that owns it. These tests pin the
 * precedence between the explicit answer, a carried key, a hand-pinned
 * Edge voice, and the default (MiniMax speech-2.8-hd).
 */
describe("resolveNarrationConfig", () => {
  it("defaults to MiniMax with the language's system narrator", () => {
    expect(
      resolveNarrationConfig({ language: "zh-CN" }),
    ).toEqual({
      provider: "minimax",
      voice: "Chinese (Mandarin)_Male_Announcer",
    });
    expect(resolveNarrationConfig({ language: "en-US" })).toEqual({
      provider: "minimax",
      voice: "English_expressive_narrator",
    });
  });

  it("lets --tts win over everything", () => {
    expect(
      resolveNarrationConfig({
        ttsChoice: "minimax-system",
        language: "zh-CN",
        carriedProvider: "edge",
      }),
    ).toEqual({
      provider: "minimax",
      voice: "Chinese (Mandarin)_Male_Announcer",
    });
    expect(
      resolveNarrationConfig({ ttsChoice: "edge", language: "zh-CN" }),
    ).toEqual({ provider: "edge", voice: "zh-CN-YunjianNeural" });
  });

  it("keeps a carried provider, and repairs a voice that belongs elsewhere", () => {
    // The carried provider is durable project config — it outranks the
    // default. But the carried EDGE voice id cannot be spoken by
    // MiniMax, so it is replaced by the MiniMax narrator.
    expect(
      resolveNarrationConfig({
        language: "zh-CN",
        carriedProvider: "minimax",
        draftVoice: "zh-CN-XiaoxiaoNeural",
      }),
    ).toEqual({
      provider: "minimax",
      voice: "Chinese (Mandarin)_Male_Announcer",
    });
    expect(
      resolveNarrationConfig({
        language: "zh-CN",
        carriedProvider: "edge",
        draftVoice: "Chinese (Mandarin)_Male_Announcer",
      }),
    ).toEqual({ provider: "edge", voice: "zh-CN-YunjianNeural" });
  });

  it("reads a hand-pinned Edge voice as a request for the Edge backend", () => {
    // A human who wrote zh-CN-XiaoxiaoNeural meant that narrator — the
    // Edge backend is the only one that can speak it.
    expect(
      resolveNarrationConfig({
        language: "zh-CN",
        draftVoice: "zh-CN-XiaoxiaoNeural",
      }),
    ).toEqual({ provider: "edge", voice: "zh-CN-XiaoxiaoNeural" });
  });

  it("leaves a voicebox profile name alone", () => {
    expect(
      resolveNarrationConfig({
        language: "zh-CN",
        carriedProvider: "voicebox",
        draftVoice: "narrator-zh",
      }),
    ).toEqual({ provider: "voicebox", voice: "narrator-zh" });
  });
});

describe("draft frontmatter helpers — malformed input", () => {
  it("frontmatterValue returns undefined without frontmatter", () => {
    expect(frontmatterValue("no frontmatter here", "voice")).toBeUndefined();
  });

  it("frontmatterValue returns undefined when the block never closes", () => {
    expect(
      frontmatterValue("---\nvoice: narrator-zh\n", "voice"),
    ).toBeUndefined();
  });

  it("stampFrontmatterKey leaves a document without a closed block alone", () => {
    const md = "---\nvoice: narrator-zh\n";
    expect(stampFrontmatterKey(md, "style", "dark-tech")).toBe(md);
  });
});

describe("runDraft — the --from path and the provider guard", () => {
  async function scaffold(name: string): Promise<void> {
    const proj = path.join(projectsRoot, "projects", name);
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState(name));
  }

  it("revises an existing file when --from points at one", async () => {
    await scaffold("dr-from-demo");
    const from = path.join(projectsRoot, "previous.md");
    await writeFile(from, "# 旧文章\n\n旧正文。\n", "utf8");
    const code = await runDraft({
      topic: "dr-from-demo",
      cwd: projectsRoot,
      from,
      model: "glm",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
    });
    expect(code).toBe(0);
    const article = await readFile(
      path.join(projectsRoot, "projects", "dr-from-demo", "article.md"),
      "utf8",
    );
    expect(article).toContain("演示文章");
  }, 20_000);

  it("rejects an unknown model provider", async () => {
    await scaffold("dr-bad-provider");
    await expect(
      runDraft({
        topic: "dr-bad-provider",
        cwd: projectsRoot,
        model: "bogus" as "glm",
        noWeb: true,
      }),
    ).rejects.toThrow(/unsupported provider/);
  });
});

describe("runDraft — the judge/generator collision warning", () => {
  it("warns when the judge is the same provider as the generator", async () => {
    const proj = path.join(projectsRoot, "projects", "dr-self-judge");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("dr-self-judge"));
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errors.push(String(m));
    });
    try {
      const code = await runDraft({
        topic: "dr-self-judge",
        cwd: projectsRoot,
        model: "glm",
        judgeModel: "glm",
        noWeb: true,
        noReview: true,
        noAudioPlan: true,
      });
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).toContain("self-judged scores");
  }, 20_000);
});

describe("runDraft — the channel profile stamp", () => {
  it("stamps the channel profile into the article frontmatter", async () => {
    const proj = path.join(projectsRoot, "projects", "dr-profile");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("dr-profile"));
    const code = await runDraft({
      topic: "dr-profile",
      cwd: projectsRoot,
      model: "glm",
      channelProfile: "chinese-storybook",
      noWeb: true,
      noReview: true,
      noAudioPlan: true,
    });
    expect(code).toBe(0);
    const article = await readFile(
      path.join(proj, "article.md"),
      "utf8",
    );
    expect(article).toContain("channel_profile: chinese-storybook");
  }, 20_000);
});
