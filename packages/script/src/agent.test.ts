import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatResponse, Provider } from "@vf/llm";
import { callScript, ScriptError } from "./agent.js";

class CannedProvider implements Provider {
  readonly name = "minimax";
  readonly responses: string[];
  calls = 0;
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(_req: { messages: ChatMessage[] }): Promise<ChatResponse> {
    const content = this.responses[this.calls] ?? "";
    this.calls += 1;
    return { content, usage: { input: 300, output: 200 } };
  }
}

const goodYaml = `hook: "Hook line."
problem: "Problem line."
explanation: "Explanation line."
example: "Example line."
comparison: "Comparison line."
implication: "Implication line."
conclusion: "Conclusion line."`;

describe("callScript (todo 2) — §28", () => {
  it("parses a clean fenced YAML into a Script", async () => {
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callScript(
      { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
      p,
    );
    expect(r.script.hook).toBe("Hook line.");
    expect(r.script.problem).toBe("Problem line.");
    expect(r.usage.output).toBe(200);
  });

  it("rejects missing fenced block with ScriptError", async () => {
    const p = new CannedProvider(["Just prose, no fence."]);
    await expect(
      callScript(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
      ),
    ).rejects.toThrow(ScriptError);
  });

  it("rejects missing required sections with ScriptError", async () => {
    const bad = `hook: "h"
problem: "p"
explanation: "e"
example: "x"
comparison: "c"
implication: "i"`; // missing conclusion
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callScript(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
      ),
    ).rejects.toThrow(ScriptError);
  });

  it("rejects unknown sections with ScriptError", async () => {
    const bad = `hook: "h"
problem: "p"
explanation: "e"
example: "x"
comparison: "c"
implication: "i"
conclusion: "k"
extra: "no"`;
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callScript(
        { topic: "t", audience: "a", language: "zh-CN", duration: 40 },
        p,
      ),
    ).rejects.toThrow(ScriptError);
  });
});
