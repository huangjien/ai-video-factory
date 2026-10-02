import type { ChatRequest, ChatResponse, Provider } from "@vf/llm";
import { describe, expect, it } from "vitest";
import {
  MotionAgentError,
  callMotionAgent,
  parseMotionSpec,
} from "./agent.js";
import { validateMotionSpec } from "./plan.js";

class FakeProvider implements Provider {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly respond: () => string,
  ) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return {
      content: this.respond(),
      usage: { input: 120, output: 80 },
    };
  }
}

const INPUT = {
  sceneId: "scene-03",
  durationSec: 8,
  index: 2,
  component: "FlowChart",
  narrationText: "请求流向服务端",
  baseline: {
    animations: [
      {
        id: "scene-03-enter-1",
        target: "scene-03",
        type: "draw" as const,
        start: 0.1,
        duration: 0.8,
        easing: "easeOut" as const,
      },
    ],
    transition: { in: "fade" as const, out: "fade" as const },
  },
  guidance: "Enter -> ease-out, 300-500ms.",
};

const GOOD_YAML = "```yaml\nanimations:\n  - id: s3-arrows\n    target: arrows\n    type: wipe\n    start: 0.5\n    duration: 1.2\n    easing: easeInOut\n  - id: s3-focus\n    target: server-node\n    type: highlight\n    start: 4\n    duration: 0.6\n    easing: easeInOut\ntransition:\n  in: fade\n  out: cut\n```";

const OVERFLOW_YAML = "```yaml\nanimations:\n  - id: too-long\n    target: x\n    type: fade\n    start: 7\n    duration: 3\n    easing: easeOut\n```";

const SNEAKY_YAML = "```yaml\nanimations:\n  - id: sneaky\n    target: x\n    type: fade\n    start: 0.1\n    duration: 0.5\n    easing: easeOut\n    springStiffness: 300\n```";

describe("callMotionAgent (T4.2)", () => {
  it("parses a good plan, canonicalizes synonyms, validates the timeline", async () => {
    const provider = new FakeProvider("minimax", () => GOOD_YAML);
    const result = await callMotionAgent(INPUT, provider);
    expect(result.providerName).toBe("minimax");
    expect(result.usage).toEqual({ input: 120, output: 80 });
    expect(result.messages).toHaveLength(2);
    // "wipe" is a synonym → canonical draw (VDSL preprocessor)
    expect(result.spec.animations[0]!.type).toBe("draw");
    expect(result.spec.transition.out).toBe("cut");
    expect(validateMotionSpec(result.spec, INPUT.durationSec)).toEqual([]);
  });

  it("rejects garbage output as MotionAgentError", async () => {
    const provider = new FakeProvider("minimax", () => "I cannot do that");
    await expect(callMotionAgent(INPUT, provider)).rejects.toThrow(
      MotionAgentError,
    );
  });

  it("rejects animations that overflow the scene", async () => {
    const provider = new FakeProvider("minimax", () => OVERFLOW_YAML);
    await expect(callMotionAgent(INPUT, provider)).rejects.toThrow(
      /scene is 8.00s/,
    );
  });

  it("rejects unknown keys (strict schema — no config smuggling)", () => {
    expect(() => parseMotionSpec(SNEAKY_YAML, INPUT)).toThrow(/invalid/);
  });

  it("falls through to the fallback provider on primary quota errors", async () => {
    const healthy = new FakeProvider("glm", () => GOOD_YAML);
    const failingProvider: Provider = {
      name: "minimax",
      chat: () =>
        Promise.reject(
          Object.assign(new Error("insufficient_balance"), { status: 429 }),
        ),
    };
    const result = await callMotionAgent(INPUT, failingProvider, {}, healthy);
    expect(result.providerName).toBe("glm");
    expect(healthy.calls).toBe(1);
  });
});
