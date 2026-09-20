import { describe, expect, it } from "vitest";
import { buildMessages } from "./prompt.js";

const UNIQUE = "RESEARCH-CTX-MARKER-77";

describe("buildMessages — research context (todo 5)", () => {
  it("includes research markdown + claim summary when provided", () => {
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      style: "dark-tech",
      researchContext: {
        markdown: `# Research\n\n${UNIQUE} is important.`,
        claimSummary: "- CoT improves reasoning accuracy",
      },
    });
    const user = m[1]?.content ?? "";
    expect(user).toContain(UNIQUE);
    expect(user).toContain("CoT improves reasoning accuracy");
    expect(user).toContain("Supporting research");
  });

  it("does NOT include the research header when researchContext is absent", () => {
    const m = buildMessages({
      topic: "t",
      audience: "a",
      language: "zh-CN",
      duration: 40,
      style: "dark-tech",
    });
    const user = m[1]?.content ?? "";
    expect(user).not.toContain("Supporting research");
    expect(user).not.toContain(UNIQUE);
  });
});
