import { describe, expect, it } from "vitest";
import { buildCaptionCues, MAX_CAPTION_LINES, wrapText } from "./captions.js";

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

describe("buildCaptionCues (CS-07)", () => {
  const narration =
    "公元六二六年七月二日清晨，长安城刚刚苏醒，宫城北门玄武门外响起急促的马蹄声。" +
    "三十多名骑兵如鬼魅般冲出，直扑太子与齐王的队伍。" +
    "几十分钟后，大唐帝国的两位皇子当场殒命。";

  it("splits a long narration into several cues", () => {
    expect(buildCaptionCues(narration, 20).length).toBeGreaterThan(1);
  });

  it("never stacks more than two lines in any cue", () => {
    for (const cue of buildCaptionCues(narration, 20)) {
      expect(cue.lines.length).toBeLessThanOrEqual(MAX_CAPTION_LINES);
    }
  });

  it("covers the whole scene: first cue at 0, last ends at the duration", () => {
    const cues = buildCaptionCues(narration, 20);
    expect(cues[0]?.startSec).toBe(0);
    expect(cues[cues.length - 1]?.endSec).toBeCloseTo(20, 6);
  });

  it("is continuous and monotonic — no gaps, no overlaps, no reordering", () => {
    const cues = buildCaptionCues(narration, 20);
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i]!;
      expect(cue.endSec).toBeGreaterThan(cue.startSec);
      const next = cues[i + 1];
      if (next) expect(cue.endSec).toBeCloseTo(next.startSec, 9);
    }
  });

  it("loses no text — every character survives into some cue", () => {
    const rejoined = buildCaptionCues(narration, 20)
      .flatMap((c) => c.lines)
      .join("")
      .replace(/\s/g, "");
    expect(rejoined).toBe(narration.replace(/\s/g, ""));
  });

  it("splits a punctuation-free run instead of truncating it", () => {
    const long = "一".repeat(200);
    const cues = buildCaptionCues(long, 30);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.flatMap((c) => c.lines).join("")).toHaveLength(200);
  });

  it("gives longer cues proportionally more time", () => {
    const cues = buildCaptionCues("短。".repeat(2) + "长".repeat(60) + "。", 30);
    const spans = cues.map((c) => c.endSec - c.startSec);
    expect(spans[spans.length - 1]!).toBeGreaterThan(spans[0]!);
  });

  it("returns nothing for empty text or a non-positive duration", () => {
    expect(buildCaptionCues("", 10)).toEqual([]);
    expect(buildCaptionCues("   ", 10)).toEqual([]);
    expect(buildCaptionCues("有文字。", 0)).toEqual([]);
  });

  describe("markers option (yellow highlighter)", () => {
    it("attaches markers to every cue when supplied", () => {
      const cues = buildCaptionCues(
        "总体叙述。重要短语出现在这里。另一句带有重要短语的尾句。".repeat(3),
        60,
        { markers: ["重要短语"] },
      );
      expect(cues.length).toBeGreaterThan(1);
      for (const cue of cues) expect(cue.markers).toEqual(["重要短语"]);
    });

    it("omits the markers field when no markers are supplied", () => {
      const cues = buildCaptionCues("普通叙述，没有高亮。", 10);
      for (const cue of cues) expect(cue.markers).toBeUndefined();
    });

    it("treats empty-marker as no markers (renderer skips the highlight pass)", () => {
      const cues = buildCaptionCues("叙述带空 marker。", 10, { markers: [] });
      for (const cue of cues) expect(cue.markers).toBeUndefined();
    });

    it("does not mutate the caller's markers array", () => {
      const input = ["词A", "词B"];
      buildCaptionCues("词A与词B的对比。".repeat(3), 30, { markers: input });
      expect(input).toEqual(["词A", "词B"]);
    });
  });
});
