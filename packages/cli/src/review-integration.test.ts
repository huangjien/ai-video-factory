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

const STORYBOARD_EN = `schema_version: "0.1"
project:
  id: t
  language: en-US
  fps: 30
  width: 1920
  height: 1080
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "A wealthy man receives a strange final measurement."
    visual:
      component: Title
      props:
        text: "hello"
`;

const goodYaml = `content:
  accuracy:
    status: ok
    evidence: "narration matches the storyboard"
    recommendation: null
  logic:
    status: warn
    evidence: "scene 4 contradicts scene 6"
    recommendation: "align the two claims"
  unsupported_claims:
    - id: F001
      severity: major
      reference: c-1
      observation: "claim c-1 has no source"
      evidence: "claims.yaml lists c-1 with sources: []"
      recommendation: "attach a source"
  contradictions: []
  repetition: []
  overall: warn
visual:
  readability:
    status: ok
    evidence: "caption is legible"
    recommendation: null
  density:
    status: ok
    evidence: "one idea per scene"
    recommendation: null
  pacing:
    status: ok
    evidence: "durations match the narration"
    recommendation: null
  visual_hierarchy:
    status: ok
    evidence: "subject leads the frame"
    recommendation: null
  caption_length:
    status: ok
    evidence: "captions fit the safe area"
    recommendation: null
  overall: pass
technical:
  resolution:
    status: ok
    evidence: "1920x1080"
    recommendation: null
  fps:
    status: ok
    evidence: "30"
    recommendation: null
  audio:
    status: ok
    evidence: "narration and bgm present"
    recommendation: null
  subtitle:
    status: ok
    evidence: "srt covers every scene"
    recommendation: null
  missing_assets: []
  render_errors: []
  overall: pass`;

describe("video review end-to-end (todo 2) — mock MiniMax", () => {
  let server: Server;
  let baseUrl: string;
  /** Bodies the judge actually received — lets a test assert what was
   *  sent, not just what came back. */
  const capturedBodies: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (c: Buffer) => {
        body += c.toString("utf8");
      });
      req.on("end", () => {
        capturedBodies.push(body);
      });
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
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
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
    expect(record).toContain("model: MiniMax-M3");
    expect(record).toContain("prompt_hash: sha256:");
    expect(record).toMatch(/input: 400/);
  });

  it("default pick reads the REVIEW role (not research) and flips off the storyboard generator — cross-model judging", async () => {
    // Discriminating config: research → minimax, review → glm. The old
    // code read cfg["research"] and would have served minimax (the same
    // provider that generated the storyboard); the fixed code serves glm.
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
    const project = "role-pick";
    const root = path.join(cwd, "projects", project);
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    mkdirSync(path.join(root, "script"), { recursive: true });
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD);
    writeFileSync(path.join(root, "script", "script.zh-CN.md"), SCRIPT);
    writeFileSync(path.join(root, "research", "claims.yaml"), CLAIMS);

    const { mkdtempSync: mkdtemp, writeFileSync: wfs } =
      await import("node:fs");
    const cfgDir = mkdtemp(path.join(tmpdir(), "video-cfg-"));
    const cfgPath = path.join(cfgDir, "llm.config.yaml");
    wfs(
      cfgPath,
      [
        "research:",
        "  primary: minimax",
        "  fallback: glm",
        "review:",
        "  primary: glm",
        "  fallback: minimax",
      ].join("\n"),
      "utf8",
    );
    const prevLlConfig = process.env["LL_CONFIG"];
    const prevGlmBase = process.env["GLM_BASE_URL"];
    process.env["LL_CONFIG"] = cfgPath;
    process.env["GLM_BASE_URL"] = baseUrl;
    process.env["GLM_API_KEY"] = "test-key-do-not-leak";
    try {
      const code = await runReview({ project, cwd }); // no model override
      expect(code).toBe(0);
      const runsDir = path.join(root, "runs");
      const files = execFileSync("ls", [runsDir], { encoding: "utf8" })
        .trim()
        .split("\n");
      const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
      expect(record).toContain("provider: glm");
      expect(record).toContain("model: glm-5.3");
    } finally {
      if (prevLlConfig === undefined) delete process.env["LL_CONFIG"];
      else process.env["LL_CONFIG"] = prevLlConfig;
      if (prevGlmBase === undefined) delete process.env["GLM_BASE_URL"];
      else process.env["GLM_BASE_URL"] = prevGlmBase;
      delete process.env["GLM_API_KEY"];
    }
  });

  it("exits 1 with helpful error when storyboard missing", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
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

  it("resolves the script by the PROJECT's language, not a hardcoded zh-CN", async () => {
    // The command used to read `script/script.zh-CN.md` for every
    // project, so an en-US project could never be reviewed — the file it
    // looked for does not exist. `video script` writes `script.en-US.md`
    // for en-US, so the path must follow the project's language.
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
    const project = "en-demo";
    const root = path.join(cwd, "projects", project);
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    mkdirSync(path.join(root, "script"), { recursive: true });
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD_EN);
    writeFileSync(path.join(root, "script", "script.en-US.md"), SCRIPT);
    writeFileSync(path.join(root, "research", "claims.yaml"), CLAIMS);

    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runReview({ project, cwd, model: "minimax" });
    expect(code).toBe(0);
    const record = readFileSync(
      path.join(root, "runs", execFileSync("ls", [path.join(root, "runs")], { encoding: "utf8" }).trim().split("\n")[0] ?? ""),
      "utf8",
    );
    expect(record).toContain("script/script.en-US.md");
    expect(record).not.toContain("script/script.zh-CN.md");
  });

  it("runs on a draft-pipeline project: no script/ and no research/ (article.md substitutes)", async () => {
    // `video draft` writes article.md + storyboard.yaml and nothing else,
    // so `video review` could never run on a drafted project: it demanded
    // a script/ and a research/claims.yaml that the pipeline never makes.
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
    const project = "draft-demo";
    const root = path.join(cwd, "projects", project);
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(path.join(root, "storyboard", "storyboard.yaml"), STORYBOARD);
    writeFileSync(
      path.join(root, "article.md"),
      "---\nlanguage: zh-CN\n---\n\n# 标题\n\n正文里的独特标记 sentence from the article body.\n",
    );

    capturedBodies.length = 0;
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runReview({ project, cwd, model: "minimax" });
    expect(code).toBe(0);
    expect(
      capturedBodies.some((b) => b.includes("sentence from the article body")),
    ).toBe(true);
    const record = readFileSync(
      path.join(root, "runs", execFileSync("ls", [path.join(root, "runs")], { encoding: "utf8" }).trim().split("\n")[0] ?? ""),
      "utf8",
    );
    expect(record).toContain("article.md");
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "video-rv-"));
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
