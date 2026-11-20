import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Stub the package so the happy path runs without a network, an API key,
// or an ffmpeg call.
const callDouyin = vi.fn();
const renderChecklist = vi.fn(() => "## 手动上传\n1. 打开创作者中心\n");
const cutVertical = vi.fn(async (opts: { out: string }) => {
  writeFileSync(opts.out, "vertical video");
  return opts.out;
});
const verticalCutIsFresh = vi.fn(() => false);
const uploadDouyin = vi.fn();
vi.mock("@video/douyin", () => ({
  callDouyin: (...a: unknown[]) =>
    (callDouyin as (...x: unknown[]) => unknown)(...a),
  renderChecklist: (...a: unknown[]) =>
    (renderChecklist as (...x: unknown[]) => unknown)(...a),
  cutVertical: (...a: unknown[]) =>
    (cutVertical as (...x: unknown[]) => unknown)(...a),
  verticalCutIsFresh: (...a: unknown[]) =>
    (verticalCutIsFresh as (...x: unknown[]) => unknown)(...a),
  uploadDouyin: (...a: unknown[]) =>
    (uploadDouyin as (...x: unknown[]) => unknown)(...a),
}));

import { runDouyin } from "./douyin-command.js";

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
let fixtureRoot: string | undefined;
const origToken = process.env["DOUYIN_ACCESS_TOKEN"];

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  callDouyin.mockReset();
  renderChecklist.mockReset();
  renderChecklist.mockImplementation(
    () => "## 手动上传\n1. 打开创作者中心\n",
  );
  cutVertical.mockClear();
  verticalCutIsFresh.mockReset();
  verticalCutIsFresh.mockReturnValue(false);
  uploadDouyin.mockReset();
  delete process.env["DOUYIN_ACCESS_TOKEN"];
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  if (origToken !== undefined) process.env["DOUYIN_ACCESS_TOKEN"] = origToken;
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
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "video-douyin-"));
  const proj = path.join(fixtureRoot, "projects", "demo");
  mkdirSync(path.join(proj, "output"), { recursive: true });
  mkdirSync(path.join(proj, "storyboard"), { recursive: true });
  writeFileSync(path.join(proj, "output", "final-mixed.mp4"), "master");
  writeFileSync(
    path.join(proj, "article.md"),
    "---\nproject: demo\nlanguage: zh-CN\nduration_target_sec: 60\nvoice: zh-CN-YunjianNeural\n---\n\n# 面部重建：一张脸有多少是证据\n\n> **Hook** (≤20s): 一张流传千年的肖像，可能比真实头骨更会骗人。\n\n## 1. 颅骨\n\n从骨骼标志点开始。\n\n## Scenes\n\n```yaml\nscenes:\n  - id: scene_1\n    duration: 30\n    caption: 段落 1\n    visual: 颅骨模型\n    narration: |\n      第一段旁白。\n```\n",
  );
  writeFileSync(path.join(proj, "state.yaml"), "status: DRAFT\n");
  return { root: fixtureRoot, proj };
}

const FAKE_RESULT = {
  douyin: {
    title: "流传千年的肖像，可能比头骨更会骗人",
    description: "summary here",
    topics: ["面部重建", "考古"],
    cover_prompt: "a portrait reconstructed from a skull",
  },
  source: "agent",
  providerName: "minimax",
};

describe("runDouyin — argument validation", () => {
  it("returns 1 when the project does not exist", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runDouyin({ project: "no-such", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(
      /no such project|not found|no project matching|video new/,
    );
  });

  it("returns 1 when the project has no article.md", async () => {
    const { root, proj } = mkFixture();
    rmSync(path.join(proj, "article.md"));
    captureConsole();
    const code = await runDouyin({ project: "demo", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/missing article\.md|video draft/);
  });

  it("returns 1 when the master video is missing", async () => {
    const { root, proj } = mkFixture();
    rmSync(path.join(proj, "output", "final-mixed.mp4"));
    captureConsole();
    const code = await runDouyin({ project: "demo", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/missing rendered video|video make/);
  });
});

describe("runDouyin — packaging", () => {
  it("cuts the vertical video and writes the package files", async () => {
    const { root, proj } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    const code = await runDouyin({ project: "demo", cwd: root });
    expect(code).toBe(0);
    expect(callDouyin).toHaveBeenCalledTimes(1);
    // The 16:9 master is cut into 9:16 before anything else happens.
    expect(cutVertical).toHaveBeenCalledTimes(1);
    const cutArgs = cutVertical.mock.calls[0]?.[0] as {
      source: string;
      out: string;
      mode?: string;
    };
    expect(cutArgs.source).toContain("final-mixed.mp4");
    expect(cutArgs.out).toContain(path.join("douyin", "video.mp4"));

    const douyinDir = path.join(proj, "douyin");
    expect(existsSync(path.join(douyinDir, "package.yaml"))).toBe(true);
    expect(existsSync(path.join(douyinDir, "cover-prompt.txt"))).toBe(true);
    expect(existsSync(path.join(douyinDir, "CHECKLIST.md"))).toBe(true);
    expect(
      readFileSync(path.join(douyinDir, "cover-prompt.txt"), "utf8"),
    ).toBe(FAKE_RESULT.douyin.cover_prompt + "\n");
  });

  it("surfaces the title and topics in the stdout summary", async () => {
    const { root } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    await runDouyin({ project: "demo", cwd: root });
    const out = consoleOutput.join("\n");
    expect(out).toMatch(/title : 流传千年的肖像/);
    expect(out).toMatch(/topics: #面部重建 #考古/);
  });

  it("writes a run record", async () => {
    const { root, proj } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    await runDouyin({ project: "demo", cwd: root });
    const runs = path.join(proj, "runs");
    const files = existsSync(runs)
      ? readFileSync(path.join(runs, `${readdirFirst(runs)}`), "utf8")
      : "";
    expect(files).toContain("stage: douyin");
    expect(files).toContain("tool: video-douyin");
  });
});

describe("runDouyin — the upload", () => {
  it("does not upload without --upload", async () => {
    const { root } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    await runDouyin({ project: "demo", cwd: root });
    expect(uploadDouyin).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/add --upload/);
  });

  it("says why the upload did not run when there is no access token", async () => {
    const { root } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    captureConsole();
    await runDouyin({ project: "demo", cwd: root, upload: true });
    expect(uploadDouyin).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/DOUYIN_ACCESS_TOKEN/);
  });

  it("publishes and records the item id when the API accepts it", async () => {
    process.env["DOUYIN_ACCESS_TOKEN"] = "token-1";
    const { root, proj } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    uploadDouyin.mockResolvedValue({ item_id: "item-9" });
    captureConsole();
    const code = await runDouyin({ project: "demo", cwd: root, upload: true });
    expect(code).toBe(0);
    expect(uploadDouyin).toHaveBeenCalledTimes(1);
    expect(
      readFileSync(path.join(proj, "douyin", "item_id.txt"), "utf8"),
    ).toContain("item-9");
    expect(consoleOutput.join("\n")).toMatch(/published/);
  });

  it("falls back to the checklist when the API rejects the post", async () => {
    process.env["DOUYIN_ACCESS_TOKEN"] = "token-1";
    const { root } = mkFixture();
    callDouyin.mockResolvedValue(FAKE_RESULT);
    uploadDouyin.mockRejectedValue(new Error("capability not approved"));
    captureConsole();
    const code = await runDouyin({ project: "demo", cwd: root, upload: true });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/capability not approved/);
  });
});

/** The first file in a directory — the run records are timestamped. */
function readdirFirst(dir: string): string {
  return readdirSync(dir)[0] ?? "";
}
