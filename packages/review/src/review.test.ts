import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ChatMessage, ChatResponse, Provider } from "@video/llm";
import { ReviewPackageSchema, callReview, ReviewError } from "./index.js";
import { buildReviewMessages } from "./prompt.js";

class CannedProvider implements Provider {
  readonly name: string;
  readonly responses: string[];
  calls = 0;
  constructor(responses: string[], name = "minimax") {
    this.responses = responses;
    this.name = name;
  }
  async chat(_req: { messages: ChatMessage[] }): Promise<ChatResponse> {
    const content = this.responses[this.calls] ?? "";
    this.calls += 1;
    return { content, usage: { input: 200, output: 150 } };
  }
}

/** The shape `packages/prompts/prompts/review.md` asks for: scalar
 *  fields are `{status, evidence, recommendation}` objects and array
 *  fields hold structured findings. The schema used to demand bare
 *  enums and bare strings — the two contracts were irreconcilable, so
 *  every real review died on "Review package schema invalid". */
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
    evidence: "caption is legible over the image"
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

/** The OLD contract: bare enums and bare strings. The current prompt
 *  never asks for this, so a model following it never produces it. */
const legacyFlatYaml = `content:
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

describe("ReviewPackageSchema — matches the review prompt's contract", () => {
  it("accepts the structured shape the prompt asks for", () => {
    const parsed = parseYaml(goodYaml) as unknown;
    const r = ReviewPackageSchema.safeParse(parsed);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.content.overall).toBe("warn");
      expect(r.data.content.logic.status).toBe("warn");
      expect(r.data.content.unsupported_claims[0]?.severity).toBe("major");
      expect(r.data.content.unsupported_claims[0]?.id).toBe("F001");
      expect(r.data.visual.overall).toBe("pass");
      expect(r.data.technical.overall).toBe("pass");
    }
  });

  it("rejects the legacy flat shape — the prompt never asks for it", () => {
    const r = ReviewPackageSchema.safeParse(
      parseYaml(legacyFlatYaml) as unknown,
    );
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const bad = parseYaml(
      goodYaml.replace("overall: pass", "overall: pass\nextra: no"),
    ) as unknown;
    const r = ReviewPackageSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects invalid overall enum", () => {
    const bad = parseYaml(
      goodYaml.replace("overall: pass", "overall: maybe"),
    ) as unknown;
    const r = ReviewPackageSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects a finding whose severity is not one of the four levels", () => {
    const bad = parseYaml(
      goodYaml.replace("severity: major", "severity: high"),
    ) as unknown;
    const r = ReviewPackageSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe("buildReviewMessages — the artifacts must reach the judge whole", () => {
  const long = (n: number, marker: string): string =>
    "x".repeat(n) + "\n" + marker;

  it("does not silently truncate a long storyboard", () => {
    // The builder used to slice each artifact to 4000 characters. On a
    // 16-scene film that cut the storyboard mid-scene-07, and the judge
    // read the cut as a storyboard that ENDS there — filing a critical
    // contradiction about a film that was in fact complete. The review
    // evaluates the whole film; the whole film must arrive.
    const tail = "THE-VERY-LAST-SCENE-MARKER";
    const storyboard = long(30_000, tail);
    const msgs = buildReviewMessages({
      storyboard,
      script: "script",
      claims: "claims",
    });
    const user = msgs[1]?.content ?? "";
    expect(user).toContain(tail);
  });

  it("does not silently truncate a long script", () => {
    const tail = "THE-LAST-SENTENCE-OF-THE-ARTICLE";
    const script = long(30_000, tail);
    const msgs = buildReviewMessages({
      storyboard: "sb",
      script,
      claims: "claims",
    });
    expect(msgs[1]?.content ?? "").toContain(tail);
  });

  it("marks the cut when a cap does bite, so the judge does not call it a defect", () => {
    const huge = "y".repeat(500_000);
    const msgs = buildReviewMessages({
      storyboard: huge,
      script: "script",
      claims: "claims",
    });
    const user = msgs[1]?.content ?? "";
    expect(user).toContain("TRUNCATED");
    expect(user.toLowerCase()).toContain("do not report");
  });
});

describe("callReview", () => {
  it("parses a clean fenced YAML into a ReviewPackage", async () => {
    const p = new CannedProvider(["```yaml\n" + goodYaml + "\n```"]);
    const r = await callReview(
      { storyboard: "yaml", script: "md", claims: "yaml" },
      p,
    );
    expect(r.review.content.overall).toBe("warn");
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

  it("gives the fallback provider a turn when the primary's answer is schema-invalid", async () => {
    // The provider ANSWERED; the answer just did not fit the schema.
    // That is a content failure, not an outage, so chatWithFallback never
    // engages the fallback and the whole review dies on one model's
    // formatting. A second model rarely repeats the mistake.
    const primary = new CannedProvider(
      ["```yaml\n" + legacyFlatYaml + "\n```"],
      "glm",
    );
    const fallback = new CannedProvider(
      ["```yaml\n" + goodYaml + "\n```"],
      "minimax",
    );
    const r = await callReview(
      { storyboard: "x", script: "x", claims: "x" },
      primary,
      fallback,
    );
    expect(r.providerName).toBe("minimax");
    expect(r.review.content.overall).toBe("warn");
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
  });
});
