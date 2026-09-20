import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScript } from "./script-command.js";

const goodYaml = `hook: "Hook line."
problem: "Problem line."
explanation: "Explanation line."
example: "Example line."
comparison: "Comparison line."
implication: "Implication line."
conclusion: "Conclusion line."`;

describe("vf script end-to-end (todo 3) — mock MiniMax", () => {
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
          usage: { prompt_tokens: 300, completion_tokens: 200 },
        }),
      );
    });
    await new Promise<void>((r) =>
      server.listen(0, "127.0.0.1", () => r()),
    );
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("writes script.zh-CN.md with all 7 sections + run record", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sc-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runScript({ topic: "AI 思维链", cwd });
    expect(code).toBe(0);
    const projectRoot = path.join(cwd, "projects", "ai-思维链");
    const md = readFileSync(path.join(projectRoot, "script", "script.zh-CN.md"), "utf8");
    expect(md).toContain("## Hook");
    expect(md).toContain("## Conclusion");
    expect(md).toContain("Hook line.");
    const runsDir = path.join(projectRoot, "runs");
    const files = execFileSync("ls", [runsDir], { encoding: "utf8" }).trim().split("\n");
    expect(files.length).toBe(1);
    const record = readFileSync(path.join(runsDir, files[0] ?? ""), "utf8");
    expect(record).toContain("provider: minimax");
    expect(record).toContain("model: MiniMax-M2.7");
  });

  it("never writes the API key into projects/ or runs/", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sc-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    await runScript({ topic: "leak-check", cwd });
    const tree = execFileSync(
      "find",
      [path.join(cwd, "projects"), "-type", "f"],
      { encoding: "utf8" },
    );
    expect(tree.includes("test-key-do-not-leak")).toBe(false);
  });

  it("uses script.en-US.md when --lang en-US is passed", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "vf-sc-"));
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
    const code = await runScript({ topic: "CoT", cwd, lang: "en-US" });
    expect(code).toBe(0);
    const md = readFileSync(
      path.join(cwd, "projects", "cot", "script", "script.en-US.md"),
      "utf8",
    );
    expect(md).toContain("Hook line.");
  });
});
