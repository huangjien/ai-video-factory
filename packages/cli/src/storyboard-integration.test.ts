import { execFileSync } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStoryboard } from "./storyboard-command.js";

const VALID_YAML = `schema_version: "0.1"
project:
  id: ai-memory
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
style:
  theme: dark-tech
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
    visual:
      component: Title
      props:
        text: "AI Agent 为什么需要 Memory？"
    animation:
      entrance: fade
    captions:
      source: narration
`;

describe("vf storyboard end-to-end (todo 6) — mock MiniMax", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuth: string | undefined;
  let lastBody: string | undefined;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastAuth = req.headers["authorization"] as string | undefined;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: { content: "```yaml\n" + VALID_YAML + "\n```" },
                index: 0,
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 90 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => new Promise<void>((r) => server.close(() => r())));

  it("writes a draft storyboard that validateStoryboard accepts", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sb-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runStoryboard({ topic: "AI 思维链", cwd });
    expect(code).toBe(0);
    const draft = readFileSync(
      path.join(cwd, "projects", "ai-思维链", "storyboard", "storyboard.yaml"),
      "utf8",
    );
    expect(draft).toContain("schema_version");
    expect(draft).toContain("AI Agent 为什么需要 Memory");
    expect(lastAuth).toBe("Bearer test-key-do-not-leak");
  });

  it("records provider/model/prompt_hash/tokens in runs/<id>.yaml", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sb-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runStoryboard({ topic: "测试", cwd });
    expect(code).toBe(0);
    const runsDir = path.join(cwd, "projects", "测试", "runs");
    const files = execFileSync("ls", [runsDir], { encoding: "utf8" })
      .trim()
      .split("\n");
    expect(files.length).toBe(1);
    const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
    expect(record).toContain("provider: minimax");
    expect(record).toContain("model: MiniMax-M3");
    expect(record).toContain("prompt_hash: sha256:");
    expect(record).toMatch(/input: 200/);
    expect(record).toMatch(/output: 90/);
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sb-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    await runStoryboard({ topic: "leak-check", cwd });
    const tree = execFileSync(
      "find",
      [path.join(cwd, "projects"), "-type", "f"],
      { encoding: "utf8" },
    );
    expect(tree.includes("test-key-do-not-leak")).toBe(false);
    expect(lastBody?.includes("test-key-do-not-leak")).toBe(false);
  });

  it("injects research context when --from-research points at a real research dir", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sb-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    // Set up a fake research/ dir at the project root
    const projectRoot = path.join(cwd, "projects", "demo");
    const { promises: fs } = await import("node:fs");
    await fs.mkdir(path.join(projectRoot, "research"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "research", "research.md"),
      "# Research\n\nThis is a unique research marker STRING-ABC-123 about Chain-of-Thought.",
      "utf8",
    );
    await fs.writeFile(
      path.join(projectRoot, "research", "claims.yaml"),
      "claims:\n  - claim: CoT improves reasoning accuracy\n    status: fact\n    sources: [s1]\n",
      "utf8",
    );
    const code = await runStoryboard({
      topic: "demo",
      cwd,
      fromResearch: path.join(projectRoot, "research"),
    });
    expect(code).toBe(0);
    // The mock server captured the request body in lastBody — the research
    // marker should appear there because the storyboard prompt includes it.
    expect(lastBody).toContain("STRING-ABC-123");
  });
});
