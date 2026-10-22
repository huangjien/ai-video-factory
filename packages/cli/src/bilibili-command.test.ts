import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Stub the LLM call so the happy path runs without a network or API key.
const callBilibili = vi.fn();
const renderChecklist = vi.fn(() => "## manual upload\n1. open bilibili.com\n");
vi.mock("@video/bilibili", () => ({
  callBilibili: (...a: unknown[]) => callBilibili(...a),
  renderChecklist: (...a: unknown[]) => renderChecklist(...a),
}));

import { runBilibili } from "./bilibili-command.js";

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
let fixtureRoot: string | undefined;
beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  callBilibili.mockReset();
  renderChecklist.mockReset();
  renderChecklist.mockImplementation(
    () => "## manual upload\n1. open bilibili.com\n",
  );
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});
function captureConsole() {
  console.log = (...a: unknown[]) => {
    consoleOutput.push(a.join(" "));
  };
  console.error = (...a: unknown[]) => {
    consoleErrors.push(a.join(" "));
  };
}

function mkFixture() {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "video-bilibili-"));
  const proj = path.join(fixtureRoot, "projects", "demo");
  mkdirSync(proj, { recursive: true });
  writeFileSync(
    path.join(proj, "article.md"),
    "---\nproject: demo\nlanguage: zh-CN\nduration_target_sec: 60\nvoice: zh-CN-YunjianNeural\n---\n\n# From Prompt Engineer to Agent Engineer\n\n> **Hook** (≤20s): A Jenkins pipeline is red, and an agent now has to find the bug.\n\n## 1. The End of the Prompt Era\n\nText of section 1.\n\n## Scenes\n\n```yaml\nscenes:\n  - id: scene_1\n    duration: 30\n    caption: 段落 1\n    visual: 清单 (要点)\n    narration: |\n      这是第一段叙事。\n  - id: scene_2\n    duration: 30\n    caption: 段落 2\n    visual: 清单 (要点)\n    narration: |\n      这是第二段叙事。\n```\n",
  );
  writeFileSync(path.join(proj, "state.yaml"), "status: DRAFT\n");
  return { root: fixtureRoot, proj };
}

const FAKE_RESULT = {
  bilibili: {
    title: "从 Prompt Engineering 到 Agentic Engineering",
    description: "summary here",
    tags: ["AI", "工程"],
    suggested_category: "知识·科学·探索",
    cover_prompt: "a paper-cut narrative scene",
  },
  source: "agent",
  providerName: "minimax",
};

describe("runBilibili — argument validation", () => {
  it("returns 1 when the project does not exist", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runBilibili({ project: "no-such", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(
      /no such project|not found|no project matching|video new/,
    );
  });

  it("returns 1 when the project has no article.md", async () => {
    const { root } = mkFixture();
    rmSync(path.join(root, "projects", "demo", "article.md"));
    captureConsole();
    const code = await runBilibili({ project: "demo", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/missing article\.md|video draft/);
  });
});

describe("runBilibili — happy path", () => {
  it("writes package.yaml, cover-prompt.txt, CHECKLIST.md and exits 0", async () => {
    const { root, proj } = mkFixture();
    callBilibili.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    const code = await runBilibili({ project: "demo", cwd: root });
    expect(code).toBe(0);
    expect(callBilibili).toHaveBeenCalledTimes(1);
    const bilibiliDir = path.join(proj, "bilibili");
    expect(existsSync(path.join(bilibiliDir, "package.yaml"))).toBe(true);
    expect(existsSync(path.join(bilibiliDir, "cover-prompt.txt"))).toBe(true);
    expect(existsSync(path.join(bilibiliDir, "CHECKLIST.md"))).toBe(true);
    const cover = readFileSync(
      path.join(bilibiliDir, "cover-prompt.txt"),
      "utf8",
    );
    expect(cover).toBe(FAKE_RESULT.bilibili.cover_prompt + "\n");
  });

  it("surfaces the agent title and tags in the stdout summary", async () => {
    const { root } = mkFixture();
    callBilibili.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    await runBilibili({ project: "demo", cwd: root });
    const out = consoleOutput.join("\n");
    expect(out).toMatch(/title: 从 Prompt Engineering 到 Agentic Engineering/);
    expect(out).toMatch(/tags : AI、工程/);
    expect(out).toMatch(/分区 : 知识·科学·探索/);
  });

  it("reuses a YouTube cover brief when youtube/package.yaml exists", async () => {
    const { root, proj } = mkFixture();
    const ytDir = path.join(proj, "youtube");
    mkdirSync(ytDir, { recursive: true });
    writeFileSync(
      path.join(ytDir, "package.yaml"),
      "title: x\ndescription: y\nthumbnail_prompt: a hero shot of a robot in a clean room\n",
    );
    callBilibili.mockImplementation(
      async (
        _input: unknown,
        _provider: unknown,
        _fallback: unknown,
        coverReuse?: { youtubeCoverPrompt?: string },
      ) => {
        return {
          ...FAKE_RESULT,
          bilibili: {
            ...FAKE_RESULT.bilibili,
            cover_prompt: coverReuse?.youtubeCoverPrompt ?? "default",
          },
        };
      },
    );
    captureConsole();
    await runBilibili({ project: "demo", cwd: root });
    const callArgs = callBilibili.mock.calls[0]?.[3] as
      { youtubeCoverPrompt?: string } | undefined;
    expect(callArgs?.youtubeCoverPrompt).toMatch(/hero shot/);
  });

  it("prints a degradation warning when the result came from the fallback", async () => {
    const { root } = mkFixture();
    callBilibili.mockResolvedValue({
      ...FAKE_RESULT,
      source: "fallback",
      warning: "LLM down, metadata derived from article",
    });
    captureConsole();
    await runBilibili({ project: "demo", cwd: root });
    const out = consoleOutput.join("\n");
    expect(out).toMatch(/⚠ degraded to the deterministic fallback/);
    expect(out).toMatch(/LLM down/);
  });
});
