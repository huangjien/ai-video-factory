import { describe, expect, it } from "vitest";
import { wrapText } from "./captions.js";

describe("wrapText (CJK-aware, unit = 1 zh char)", () => {
  it("short zh text stays one line", () => {
    expect(wrapText("AI 思维链有什么用？", 24)).toEqual([
      "AI 思维链有什么用？",
    ]);
  });

  it("wraps 60 zh chars into 3 lines of <= 24", () => {
    const text = "一".repeat(60);
    const lines = wrapText(text, 24);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(24);
  });

  it("breaks at spaces for latin and counts ascii as half-width", () => {
    const lines = wrapText("AI Agent 为什么需要 Memory 机制来保持上下文", 8);
    for (const line of lines) {
      const units = [...line]
        .map((c) => (/[\u4e00-\u9fff\uff00-\uffef]/.test(c) ? 1 : 0.5))
        .reduce((a, b) => a + b, 0);
      expect(units).toBeLessThanOrEqual(8);
    }
    expect(lines.join(" ")).toContain("Memory");
  });

  it("hard-breaks unbreakable CJK runs at the limit", () => {
    const lines = wrapText("字".repeat(30), 24);
    expect(lines).toEqual(["字".repeat(24), "字".repeat(6)]);
  });
});
