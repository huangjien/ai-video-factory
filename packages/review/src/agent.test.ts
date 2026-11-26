import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

import { ReviewError, callReview } from "./agent.js";
import { buildReviewMessages } from "./prompt.js";

function fakeProvider(respond: () => string, name = "fake"): Provider {
  return {
    name,
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const input = {
  storyboard: 'schema_version: "0.2"\nscenes: []',
  script: "# 谁被允许下阴间",
  claims: "claims: []",
};

/** A package the schema accepts: every section, every dimension, a verdict. */
function reviewYaml(overall: string): string {
  const scalar = (name: string): string =>
    `  ${name}:\n    status: ok\n    evidence: "fine"\n`;
  return `\`\`\`yaml
content:
${scalar("accuracy")}${scalar("logic")}  unsupported_claims: []
  contradictions: []
  repetition: []
  overall: ${overall}
visual:
${scalar("readability")}${scalar("density")}${scalar("pacing")}${scalar("visual_hierarchy")}${scalar("caption_length")}  overall: ${overall}
technical:
${scalar("resolution")}${scalar("fps")}${scalar("audio")}${scalar("subtitle")}  missing_assets: []
  render_errors: []
  overall: ${overall}
\`\`\``;
}

describe("buildReviewMessages", () => {
  it("hands each artifact over whole and labelled", () => {
    const user = buildReviewMessages(input)[1]?.content ?? "";
    expect(user).toContain("## Storyboard (VDSL)");
    expect(user).toContain("## Script (Markdown)");
    expect(user).toContain("## Claims (YAML)");
    expect(user).toContain("Produce the review package YAML");
  });

  it("marks a clipped artifact, so the judge does not call it a defect", () => {
    const huge = "x".repeat(60_001);
    const user =
      buildReviewMessages({ ...input, storyboard: huge })[1]?.content ?? "";
    expect(user).toContain("[TRUNCATED:");
    expect(user).toContain("do NOT report the missing content as a defect");
    // The clipped artifact stays inside the marker's budget.
    expect(user.length).toBeLessThan(huge.length + 2_000);
  });

  it("leaves a normal artifact unmarked", () => {
    const user = buildReviewMessages(input)[1]?.content ?? "";
    expect(user).not.toContain("[TRUNCATED:");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildReviewMessages(input)[0]?.content ?? "";
    expect(system.length).toBeGreaterThan(100);
  });
});

describe("callReview", () => {
  it("returns the review the judge wrote", async () => {
    const result = await callReview(
      input,
      fakeProvider(() => reviewYaml("pass")),
    );
    expect(result.review.content.overall).toBe("pass");
    expect(result.review.visual.overall).toBe("pass");
    expect(result.review.technical.overall).toBe("pass");
    expect(result.providerName).toBe("fake");
  });

  it("gives the fallback provider a turn when the answer does not fit the schema", async () => {
    let asked = 0;
    const primary: Provider = {
      name: "primary",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        asked += 1;
        // The provider ANSWERED; the answer is just unusable.
        return {
          content: "content: {}\n",
          usage: { input: 1, output: 1 },
        };
      },
    };
    const result = await callReview(
      input,
      primary,
      fakeProvider(() => reviewYaml("warn"), "fallback"),
    );
    expect(asked).toBe(1);
    expect(result.providerName).toBe("fallback");
    expect(result.review.content.overall).toBe("warn");
  });

  it("reports an unreadable answer as the review's own error", async () => {
    await expect(
      callReview(
        input,
        fakeProvider(() => "not yaml"),
      ),
    ).rejects.toThrow(ReviewError);
  });

  it("surfaces the last provider's error when both providers are down", async () => {
    const primary: Provider = {
      name: "primary",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw Object.assign(new Error("429 rate limit"), { status: 429 });
      },
    };
    const fallback: Provider = {
      name: "fallback",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("fallback also down");
      },
    };
    await expect(callReview(input, primary, fallback)).rejects.toThrow(
      "fallback also down",
    );
  });
});
