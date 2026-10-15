import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderAudioConfig, type AudioConfig } from "@video/audio-plan";
import type { Provider } from "@video/llm";
import { parseArticle, type ParsedArticle } from "@video/draft";
import { initState, writeProjectState } from "@video/workflow";
import { runDraft, writeAudioConfigIfAbsent } from "./draft-command.js";

/**
 * Tests for the `--bgm` flag's audio-config stamping (v0.7 plan §6
 * "--bgm semantics" + §11 items 6–8, ticket A3). `callAudioPlan` is
 * mocked to return a fixed fixture; `renderAudioConfig` is the real
 * package serializer, so the assertions pin the exact bytes the
 * audio-plan package itself would write — including the fade keys.
 */

/** Mock only callAudioPlan; keep every real export (renderAudioConfig). */
const mocks = vi.hoisted(() => ({ callAudioPlan: vi.fn() }));
vi.mock("@video/audio-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/audio-plan")>();
  return { ...actual, callAudioPlan: mocks.callAudioPlan };
});

/** What the audio-plan LLM "chose" — including non-default fade values
 *  so the tests prove --bgm leaves them byte-identical. */
const FIXTURE_CONFIG: AudioConfig = {
  voice: "zh-CN-YunjianNeural",
  bgm: "calm",
  bgm_fade_in_sec: 1.2,
  bgm_fade_out_sec: 2.5,
  sfx: { scene_1: "whoosh" },
};
/** Exactly what the package would write with no --bgm flag. */
const FIXTURE_YAML = renderAudioConfig(FIXTURE_CONFIG);

/** The LLM provider is never reached (callAudioPlan is mocked). */
const unusedProvider = {} as Provider;

let projectsRoot: string;

beforeEach(async () => {
  mocks.callAudioPlan.mockResolvedValue({
    config: FIXTURE_CONFIG,
    yaml: FIXTURE_YAML,
    usage: { input: 3, output: 4 },
  });
  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-bgm-stamp-"));
});

afterEach(async () => {
  mocks.callAudioPlan.mockReset();
  vi.restoreAllMocks();
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

async function articleFixture(): Promise<ParsedArticle> {
  return parseArticle(
    `---
project: bgm-demo
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

async function readAudioConfig(): Promise<string> {
  return readFile(path.join(projectsRoot, "audio-config.yaml"), "utf8");
}

describe("writeAudioConfigIfAbsent — --bgm stamping (fresh write)", () => {
  it("stamps --bgm guofeng over the LLM pick; voice, sfx and fades byte-identical", async () => {
    const step = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      unusedProvider,
      null,
      { bgm: "guofeng" },
    );
    expect(step.status).toBe("written");
    if (step.status !== "written") return;
    // The returned config echoes what is on disk (runDraft prints it).
    expect(step.config.bgm).toBe("guofeng");
    expect(await readAudioConfig()).toBe(
      "voice: zh-CN-YunjianNeural\n" +
        'bgm: "guofeng"\n' +
        "bgm_fade_in_sec: 1.2\n" +
        "bgm_fade_out_sec: 2.5\n" +
        "sfx:\n" +
        '  scene_1: "whoosh"\n',
    );
  });

  it("stamps --bgm none as bgm: null (unquoted)", async () => {
    const step = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      unusedProvider,
      null,
      { bgm: "none" },
    );
    expect(step.status).toBe("written");
    if (step.status !== "written") return;
    expect(step.config.bgm).toBeNull();
    expect(await readAudioConfig()).toBe(
      "voice: zh-CN-YunjianNeural\n" +
        "bgm: null\n" +
        "bgm_fade_in_sec: 1.2\n" +
        "bgm_fade_out_sec: 2.5\n" +
        "sfx:\n" +
        '  scene_1: "whoosh"\n',
    );
  });

  it("without --bgm, writes the fixture yaml byte-identical", async () => {
    const step = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      unusedProvider,
      null,
    );
    expect(step.status).toBe("written");
    expect(await readAudioConfig()).toBe(FIXTURE_YAML);
  });

  it("accepts a free-form tag (promptForTag mood-text fallback is legal)", async () => {
    const step = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      unusedProvider,
      null,
      { bgm: "lofi-beats" },
    );
    expect(step.status).toBe("written");
    const onDisk = await readAudioConfig();
    expect(onDisk).toContain('bgm: "lofi-beats"');
    // Only the bgm line changed.
    expect(onDisk).toBe(FIXTURE_YAML.replace('bgm: "calm"', 'bgm: "lofi-beats"'));
  });

  it("with skip (--no-audio-plan), never attempts stamping", async () => {
    const step = await writeAudioConfigIfAbsent(
      projectsRoot,
      await articleFixture(),
      unusedProvider,
      null,
      { skip: true, bgm: "guofeng" },
    );
    expect(step).toEqual({ status: "skipped", reason: "--no-audio-plan" });
    expect(mocks.callAudioPlan).not.toHaveBeenCalled();
    await expect(readAudioConfig()).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("runDraft — --bgm with an existing audio-config.yaml (§11 item 7)", () => {
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
  let savedEnv: Record<string, string | undefined> = {};

  /** Agent-ask gate keys: this suite pins the proceed path, but the
   *  vitest process runs inside zcode — strip them like
   *  draft-command.test.ts / agent-ask.test.ts do. */
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
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("prints the not-applied warning to stderr and keeps the file byte-identical", async () => {
    const proj = path.join(projectsRoot, "projects", "bgm-warn-demo");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("bgm-warn-demo"));
    const existing = path.join(proj, "audio-config.yaml");
    await writeFile(existing, "voice: keep-me\n", "utf8");

    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const code = await runDraft({
        topic: "bgm-warn-demo",
        cwd: projectsRoot,
        model: "glm",
        noWeb: true,
        noReview: true,
        bgm: "guofeng",
      });
      expect(code).toBe(0);
      expect(mocks.callAudioPlan).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        "bgm answer not applied — audio-config.yaml kept; run 'video audio-plan' to regenerate",
      );
      // Hand-edits invariant: the file is byte-identical, always.
      expect(await readFile(existing, "utf8")).toBe("voice: keep-me\n");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
