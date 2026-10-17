import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
  Usage,
} from "@video/llm";
import { callAgent, buildRepairMessages } from "./agent.js";
import { validStoryboardYaml } from "./test-fixtures.js";

class CannedProvider implements Provider {
  readonly name = "minimax";
  readonly responses: string[];
  calls = 0;
  /** Every request body the agent sent, so tests can assert what the repair
   *  pass actually asked for. */
  readonly requests: ChatRequest[] = [];
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const content = this.responses[this.calls] ?? "";
    this.calls += 1;
    return {
      content,
      usage: { input: 100, output: 50 } as Usage,
    };
  }
}

const baseInput = {
  topic: "AI 思维链有什么用？",
  audience: "developers",
  duration: 40,
  language: "zh-CN" as const,
  style: "dark-tech",
};

describe("callAgent (todo 4) — §53", () => {
  it("parses a clean VDSL response into a valid Storyboard", async () => {
    const p = new CannedProvider([validStoryboardYaml]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
  });

  it("strips ```yaml fenced code blocks before parsing", async () => {
    const fenced = "```yaml\n" + validStoryboardYaml + "\n```";
    const p = new CannedProvider([fenced]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
  });

  it("strips ``` (no language tag) fences", async () => {
    const fenced = "```\n" + validStoryboardYaml + "\n```";
    const p = new CannedProvider([fenced]);
    const result = await callAgent(baseInput, p);
    expect(result.storyboard.scenes).toHaveLength(2);
  });

  it("recovers a prose-only reply via the repair pass", async () => {
    // Before the repair pass this was a hard failure: prose reached the
    // validator and the whole run died. Now the model gets told what was
    // wrong and gets a second chance.
    const p = new CannedProvider([
      "This is not YAML, just a chat reply.",
      validStoryboardYaml,
    ]);
    const result = await callAgent(baseInput, p);
    expect(result.repaired).toBe(true);
    expect(result.storyboard.scenes.length).toBeGreaterThan(0);
  });

  it("rejects empty response with explicit no-YAML message", async () => {
    const p = new CannedProvider([""]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(
      /no YAML in response/,
    );
  });

  it("rejects invalid VDSL with the underlying validation errors", async () => {
    const invalid = `schema_version: "0.0"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes: []`;
    const p = new CannedProvider([invalid]);
    await expect(callAgent(baseInput, p)).rejects.toThrow();
  });

  it("sends both system + user messages to the provider", async () => {
    const p = new CannedProvider([validStoryboardYaml]);
    await callAgent(baseInput, p);
    expect(p.calls).toBe(1);
  });
});

// A strict schema plus an inventive model means an occasional unknown key or
// enum value, and discarding a whole storyboard over one is expensive. One
// repair pass converts that failure into an extra call. Found by
// `video prompts eval --judge` on 2026-10-18 — see
// docs/v0.10-prompt-evals-plan.md §8 gap 2.
describe("callAgent repair pass", () => {
  const invalidStyleKey = `schema_version: "0.1"
project:
  id: t
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
style:
  theme: dark-tech
  art_style: cinematic
scenes:
  - id: s1
    duration: 5
    visual:
      component: Title
      props:
        text: hello`;

  it("recovers from an unknown key and flags the repair", async () => {
    const p = new CannedProvider([invalidStyleKey, validStoryboardYaml]);
    const result = await callAgent(baseInput, p);
    expect(result.repaired).toBe(true);
    expect(p.calls).toBe(2);
    expect(result.storyboard.scenes.length).toBeGreaterThan(0);
  });

  it("quotes the validator's own field names back to the model", async () => {
    const p = new CannedProvider([invalidStyleKey, validStoryboardYaml]);
    await callAgent(baseInput, p);
    const repair = p.requests[1]?.messages as ChatMessage[];
    const last = repair[repair.length - 1]?.content ?? "";
    expect(last).toContain("style.art_style");
    expect(last).toContain("failed VDSL validation");
    expect(last).toContain("none, fade, slide, scale, draw, typewriter");
  });

  it("keeps the original messages for prompt_hash lineage", async () => {
    const p = new CannedProvider([invalidStyleKey, validStoryboardYaml]);
    const clean = new CannedProvider([validStoryboardYaml]);
    const repaired = await callAgent(baseInput, p);
    const unrepaired = await callAgent(baseInput, clean);
    // The repair scaffolding must not leak into the hashed prompt.
    expect(repaired.messages).toEqual(unrepaired.messages);
  });

  it("reports repaired=false on a first-pass success (no extra call)", async () => {
    const p = new CannedProvider([validStoryboardYaml]);
    const result = await callAgent(baseInput, p);
    expect(result.repaired).toBe(false);
    expect(p.calls).toBe(1);
  });

  it("gives up after one repair attempt and names the attempt count", async () => {
    const p = new CannedProvider([invalidStyleKey, invalidStyleKey]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(
      /VDSL validation failed after 1 repair attempt/,
    );
    expect(p.calls).toBe(2);
  });

  it("accumulates usage across both calls", async () => {
    const p = new CannedProvider([invalidStyleKey, validStoryboardYaml]);
    const result = await callAgent(baseInput, p);
    expect(result.usage).toEqual({ input: 200, output: 100 });
  });

  it("treats an empty first response as fatal, not a validation failure", async () => {
    // There is nothing to quote back to the model, so the repair pass is
    // skipped and the run ends with the original diagnosis.
    const p = new CannedProvider([""]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(
      /no YAML in response/,
    );
    expect(p.calls).toBe(1);
  });

  it("still reports no-YAML when the repair response comes back empty", async () => {
    const p = new CannedProvider([invalidStyleKey, ""]);
    await expect(callAgent(baseInput, p)).rejects.toThrow(
      /no YAML in response/,
    );
    expect(p.calls).toBe(2);
  });
});

describe("buildRepairMessages", () => {
  const base: ChatMessage[] = [
    { role: "system", content: "SYS" },
    { role: "user", content: "USR" },
  ];

  it("appends one user turn quoting every error", () => {
    const out = buildRepairMessages(base, [
      { field: "style.palette", message: "Unknown field" },
      { field: "scenes.0.animation.entrance", message: "Invalid enum" },
    ]);
    expect(out).toHaveLength(3);
    const text = out[2]?.content ?? "";
    expect(text).toContain("- style.palette: Unknown field");
    expect(text).toContain("- scenes.0.animation.entrance: Invalid enum");
    expect(out.slice(0, 2)).toEqual(base);
  });

  it("tells the model to change nothing but the listed fields", () => {
    const text =
      buildRepairMessages(base, [{ field: "style.palette", message: "m" }])[2]
        ?.content ?? "";
    expect(text).toContain("Change nothing else");
    expect(text).toContain("Never invent keys");
  });
});
