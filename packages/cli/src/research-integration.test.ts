import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runResearch } from "./research-command.js";

const goodYaml = `markdown: |
  ## Needs human review
  - c-uncertain
  ## Overview
  Brief.
  ## Key claims
  1. [fact] The sky is blue.
sources:
  - id: s1
    url: https://example.com/sky
    title: Why the sky is blue
    accessed: 2026-09-20
    snippet: Rayleigh scattering.
claims:
  - id: c1
    claim: The sky is blue
    status: fact
    sources: [s1]
  - id: c-uncertain
    claim: Some uncertain claim
    status: uncertain
    sources: [s1]
meta:
  web_search_used: false
  web_search_failed: false
  provider: minimax
  model: MiniMax-M2.7
`;

const uncertainYaml = `markdown: |
  ## Needs human review
  - c-uncertain
  ## Overview
  About a topic where everything is uncertain.
  ## Key claims
  1. [uncertain] We don't actually know.
sources:
  - id: s1
    url: https://example.com/x
    title: X
    accessed: 2026-09-20
    snippet: x
claims:
  - id: c-uncertain
    claim: We don't actually know
    status: uncertain
    sources: [s1]
meta:
  web_search_used: false
  web_search_failed: false
  provider: minimax
  model: MiniMax-M2.7
`;

describe("vf research end-to-end (todo 4) — mock MiniMax", () => {
  let server: Server;
  let baseUrl: string;
  let responseYaml = goodYaml;
  const statusToSend = 200;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = statusToSend;
      res.setHeader("Content-Type", "application/json");
      const url = req.url ?? "";
      let body: string;
      if (url.includes("/v1/coding_plan/search")) {
        body = JSON.stringify({ organic: [], related_searches: [], base_resp: { status_code: 0 } });
      } else {
        // Handle BOTH MiniMax (/v1/chat/completions) and GLM (/chat/completions) paths
        body = JSON.stringify({
          choices: [
            {
              message: { content: "```yaml\n" + responseYaml + "\n```" },
              index: 0,
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 250, completion_tokens: 120 },
        });
      }
      res.end(body);
    });
    await new Promise<void>((r) =>
      server.listen(0, "127.0.0.1", () => r()),
    );
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(
    async () =>
      new Promise<void>((r) => server.close(() => r())),
  );

  it("writes research.md, sources.yaml, claims.yaml + runs/<id>.yaml", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rb-"));
    process.env["GLM_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    // Override GLM base URL to point at the mock (since research default is GLM per doc §6)
    process.env["GLM_BASE_URL"] = baseUrl;
    const code = await runResearch({ topic: "AI 思维链", cwd });
    expect(code).toBe(0);
    const projectRoot = path.join(cwd, "projects", "ai-思维链");
    const md = readFileSync(path.join(projectRoot, "research", "research.md"), "utf8");
    expect(md).toContain("## Needs human review");
    expect(md).toContain("[fact] The sky is blue.");
    const sources = readFileSync(path.join(projectRoot, "research", "sources.yaml"), "utf8");
    expect(sources).toContain("s1");
    expect(sources).toContain("https://example.com/sky");
    const claims = readFileSync(path.join(projectRoot, "research", "claims.yaml"), "utf8");
    expect(claims).toContain("c1");
    expect(claims).toContain("status: fact");
    const runsDir = path.join(projectRoot, "runs");
    const files = execFileSync("ls", [runsDir], { encoding: "utf8" }).trim().split("\n");
    expect(files.length).toBe(1);
    const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
    expect(record).toContain("provider: glm");
    expect(record).toContain("model: glm-4.6");
    expect(record).toContain("prompt_hash: sha256:");
  });

  it("surfaces Needs human review section for uncertain claims", async () => {
    responseYaml = uncertainYaml;
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rb-"));
    process.env["GLM_API_KEY"] = "test-key-do-not-leak";
    process.env["GLM_BASE_URL"] = baseUrl;
    const code = await runResearch({ topic: "Uncertain Topic", cwd });
    expect(code).toBe(0);
    const md = readFileSync(
      path.join(cwd, "projects", "uncertain-topic", "research", "research.md"),
      "utf8",
    );
    expect(md).toContain("## Needs human review");
    expect(md).toContain("c-uncertain");
    responseYaml = goodYaml;
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-rb-"));
    process.env["GLM_API_KEY"] = "test-key-do-not-leak";
    process.env["GLM_BASE_URL"] = baseUrl;
    await runResearch({ topic: "leak-check", cwd });
    const tree = execFileSync(
      "find",
      [path.join(cwd, "projects"), "-type", "f"],
      { encoding: "utf8" },
    );
    expect(tree.includes("test-key-do-not-leak")).toBe(false);
  });
});
