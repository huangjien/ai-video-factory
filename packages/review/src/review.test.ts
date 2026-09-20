import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatResponse, Provider } from "@vf/llm";
import { ReviewPackageSchema, callReview, ReviewError } from "./index.js";

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
    return { content, usage: { input: 200, output: 150 } };
  }
}

const goodYaml = `content:
  accuracy: ok
  logic: ok
  unsupported_claims: ["c-1 not sourced"]
  contradictions: []
  repetition: []
  overall: pass
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

describe("ReviewPackageSchema (todo 1) — §31", () => {
  it("accepts a valid review package with all 3 review sections", () => {
    const parsed = require("yaml").parse(goodYaml) as unknown;
    const r = ReviewPackageSchema.safeParse(parsed);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.content.overall).toBe("pass");
      expect(r.data.visual.overall).toBe("pass");
      expect(r.data.technical.overall).toBe("pass");
    }
  });

  it("rejects unknown keys (strict)", () => {
    const bad = require("yaml").parse(
      goodYaml.replace("overall: pass", "overall: pass\nextra: no"),
    ) as unknown;
    const r = ReviewPackageSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects invalid overall enum", () => {
    const bad = require("yaml").parse(
      goodYaml.replace("overall: pass", "overall: maybe"),
    ) as unknown;
    const r = ReviewPackageSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe("callReview (todo 1)", () => {
  it("parses a clean fenced YAML into a ReviewPackage", async () => {
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callReview(
      { storyboard: "yaml", script: "md", claims: "yaml" },
      p,
    );
    expect(r.review.content.overall).toBe("pass");
    expect(r.usage.output).toBe(150);
  });

  it("rejects missing fenced block with ReviewError", async () => {
    const p = new CannedProvider(["just prose"]);
    await expect(
      callReview({ storyboard: "x", script: "x", claims: "x" }, p),
    ).rejects.toThrow(ReviewError);
  });

  it("rejects invalid enum in canned response with ReviewError", async () => {
    const bad = goodYaml.replace("overall: pass", "overall: maybe");
    const p = new CannedProvider(["```yaml\n" + bad + "\n```"]);
    await expect(
      callReview({ storyboard: "x", script: "x", claims: "x" }, p),
    ).rejects.toThrow(ReviewError);
  });
});
