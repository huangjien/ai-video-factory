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
import { runReview } from "./review-command.js";

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

const CLAIMS = `claims:
  - id: c1
    claim: 事实声明
    status: fact
    sources: [s1]
`;

const goodYaml = `content:
  accuracy: ok
  logic: warn
  unsupported_claims: ["c1 needs more sources"]
  contradictions: []
  repetition: []
  overall: warn
visual:
  readability: ok
  density: ok
  pacing: ok
  visual_hierarchy: ok
  caption_length: ok
  overall: pass
technical:
  resolution: ok
  fps: ok
  audio: ok
  subtitle: ok
  missing_assets: []
  render_errors: []
  overall: pass`;

describe("vf review end-to-end (todo 2) — mock MiniMax", () => {
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
          usage: { prompt_tokens: 400, completion_tokens: 250 },
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => new Promise<void>((r) => server.close(() => r())));

  it("writes 3 review YAMLs + a run record with provider/model/prompt_hash/tokens", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rv-"));
    const project = "demo";
    const root = path.join(cwd, "projects", project);
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    mkdirSync(path.join(root, "script"), { recursive: true });
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD);
    writeFileSync(path.join(root, "script", "script.zh-CN.md"), SCRIPT);
    writeFileSync(path.join(root, "research", "claims.yaml"), CLAIMS);

    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runReview({ project, cwd, model: "minimax" });
    expect(code).toBe(0);

    const contentReview = readFileSync(
      path.join(root, "review", "content-review.yaml"),
      "utf8",
    );
    expect(contentReview).toContain("overall: warn");
    expect(contentReview).toContain("unsupported_claims");
    const visualReview = readFileSync(
      path.join(root, "review", "visual-review.yaml"),
      "utf8",
    );
    expect(visualReview).toContain("overall: pass");
    const technicalReview = readFileSync(
      path.join(root, "review", "technical-review.yaml"),
      "utf8",
    );
    expect(technicalReview).toContain("overall: pass");

    const runsDir = path.join(root, "runs");
    const files = execFileSync("ls", [runsDir], { encoding: "utf8" })
      .trim()
      .split("\n");
    expect(files.length).toBe(1);
    const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
    expect(record).toContain("provider: minimax");
    expect(record).toContain("model: MiniMax-M2.7");
    expect(record).toContain("prompt_hash: sha256:");
    expect(record).toMatch(/input: 400/);
  });

  it("exits 1 with helpful error when storyboard missing", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rv-"));
    mkdirSync(path.join(cwd, "projects", "missing", "script"), {
      recursive: true,
    });
    mkdirSync(path.join(cwd, "projects", "missing", "research"), {
      recursive: true,
    });
    writeFileSync(
      path.join(cwd, "projects", "missing", "script", "script.zh-CN.md"),
      SCRIPT,
    );
    writeFileSync(
      path.join(cwd, "projects", "missing", "research", "claims.yaml"),
      CLAIMS,
    );
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runReview({ project: "missing", cwd, model: "minimax" });
    expect(code).toBe(1);
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rv-"));
    const project = "leak-check";
    const root = path.join(cwd, "projects", project);
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    mkdirSync(path.join(root, "script"), { recursive: true });
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD);
    writeFileSync(path.join(root, "script", "script.zh-CN.md"), SCRIPT);
    writeFileSync(path.join(root, "research", "claims.yaml"), CLAIMS);
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    await runReview({ project, cwd, model: "minimax" });
    const tree = execFileSync(
      "find",
      [path.join(cwd, "projects"), "-type", "f"],
      { encoding: "utf8" },
    );
    expect(tree.includes("test-key-do-not-leak")).toBe(false);
  });
});
