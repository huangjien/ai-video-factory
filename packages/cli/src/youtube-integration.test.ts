import { execFileSync } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runYouTube } from "./youtube-command.js";

const STORYBOARD = `schema_version: "0.1"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "测试文本"
    visual:
      component: Title
      props:
        text: "hello"
`;

const SCRIPT = `# Script

## Hook
测试
`;

const RESEARCH = "# Research\n\nSome content.\n";

const goodYaml = `title: "AI 思维链有什么用？"
description: |
  本视频讲解 CoT。
chapters:
  - timestamp: "00:00"
    title: Hook
  - timestamp: "00:05"
    title: Problem
thumbnail_prompt: "Dark blue background with bold text"
shorts_hook: "60-second intro to CoT"`;

describe("vf youtube end-to-end (todo 2) — mock MiniMax", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: "```yaml\n" + goodYaml + "\n```" },
              index: 0,
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 350, completion_tokens: 220 },
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => new Promise<void>((r) => server.close(() => r())));

  function seedProject(root: string) {
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    mkdirSync(path.join(root, "script"), { recursive: true });
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD);
    writeFileSync(path.join(root, "script", "script.zh-CN.md"), SCRIPT);
    writeFileSync(path.join(root, "research", "research.md"), RESEARCH);
  }

  it("writes title/description/chapters.vtt/package + run record", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-yt-"));
    const root = path.join(cwd, "projects", "demo");
    seedProject(root);
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runYouTube({ project: "demo", cwd, model: "minimax" });
    expect(code).toBe(0);

    const title = readFileSync(path.join(root, "youtube", "title.txt"), "utf8");
    expect(title).toContain("思维链");
    const description = readFileSync(
      path.join(root, "youtube", "description.md"),
      "utf8",
    );
    expect(description).toContain("CoT");
    const vtt = readFileSync(
      path.join(root, "youtube", "chapters.vtt"),
      "utf8",
    );
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:00 --> 00:00:05");
    expect(vtt).toContain("Hook");
    expect(vtt).toContain("Problem");
    const pkg = readFileSync(
      path.join(root, "youtube", "package.yaml"),
      "utf8",
    );
    expect(pkg).toContain("title:");
    expect(pkg).toContain("thumbnail_prompt:");

    const runsDir = path.join(root, "runs");
    const files = execFileSync("ls", [runsDir], { encoding: "utf8" })
      .trim()
      .split("\n");
    expect(files.length).toBe(1);
    const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
    expect(record).toContain("provider: minimax");
    expect(record).toContain("stage: youtube");
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-yt-"));
    const root = path.join(cwd, "projects", "leak");
    seedProject(root);
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    await runYouTube({ project: "leak", cwd, model: "minimax" });
    const tree = execFileSync(
      "find",
      [path.join(cwd, "projects"), "-type", "f"],
      { encoding: "utf8" },
    );
    expect(tree.includes("test-key-do-not-leak")).toBe(false);
  });
});
