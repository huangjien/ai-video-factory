import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { runAudioPlan } from "./audio-plan-command.js";

const PLAN_JSON = {
  voice: "zh-CN-YunjianNeural",
  bgm: "calm",
  bgm_fade_in_sec: 1.5,
  bgm_fade_out_sec: 2,
  sfx: { scene_1: "whoosh" },
};

let server: Server;
let baseUrl: string;
let projectsRoot: string;
let savedEnv: { key: string | undefined; base: string | undefined };

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(PLAN_JSON) } }],
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

  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-audio-plan-"));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise<void>((r) => server.close(() => r()));
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

const ARTICLE = `---
project: ap-demo
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
`;

describe("runAudioPlan", () => {
  it("fails on an unknown project", async () => {
    const code = await runAudioPlan({
      project: "ghost",
      cwd: projectsRoot,
      model: "glm",
    });
    expect(code).toBe(1);
  });

  it("fails when the project has no article.md", async () => {
    const proj = path.join(projectsRoot, "projects", "ap-empty");
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeProjectState(proj, initState("ap-empty"));
    const code = await runAudioPlan({
      project: "ap-empty",
      cwd: projectsRoot,
      model: "glm",
    });
    expect(code).toBe(1);
  });

  it("drafts audio-config.yaml from the article via the LLM", async () => {
    const proj = path.join(projectsRoot, "projects", "ap-demo");
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeProjectState(proj, initState("ap-demo"));
    await writeFile(path.join(proj, "article.md"), ARTICLE, "utf8");

    const code = await runAudioPlan({
      project: "ap-demo",
      cwd: projectsRoot,
      model: "glm",
    });
    expect(code).toBe(0);

    const out = path.join(proj, "audio-config.yaml");
    expect(existsSync(out)).toBe(true);
    const yaml = await readFile(out, "utf8");
    expect(yaml).toContain("calm");
    expect(yaml).toContain("whoosh");
  });

  it("strict mode fails on a malformed article instead of recovering", async () => {
    const proj = path.join(projectsRoot, "projects", "ap-strict");
    await mkdir(path.join(proj, "storyboard"), { recursive: true });
    await writeProjectState(proj, initState("ap-strict"));
    // Empty narrations: strict parseArticle throws, lenient recovers.
    await writeFile(
      path.join(proj, "article.md"),
      ARTICLE.replace("    narration: n", "    narration: \"\""),
      "utf8",
    );
    const code = await runAudioPlan({
      project: "ap-strict",
      cwd: projectsRoot,
      model: "glm",
      strict: true,
    });
    expect(code).toBe(1);
  });
});
