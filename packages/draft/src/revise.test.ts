import { describe, expect, it } from "vitest";
import type { RawArticle } from "./agent.js";
import {
  buildReviseMessages,
  verifySurgicalRevision,
  type ReviseFinding,
} from "./revise.js";

const BASE: RawArticle = {
  title: "你不是在努力，只是在吃苦",
  hook: "学也学不进去，玩也玩不尽兴。",
  sections: [
    { heading: "学不进去的那种日子", body: "先分清是暂时疲惫，还是持续耗竭。" },
    { heading: "加班不等于努力", body: "每天加班最多，积累最少。" },
  ],
  scenes: [
    {
      id: "scene_1",
      duration: 8,
      caption: "疲惫还是耗竭",
      visual: "一个人在深夜书桌前",
      narration: "先分清是暂时疲惫，还是持续耗竭。",
    },
    {
      id: "scene_2",
      duration: 10,
      caption: "加班最多积累最少",
      visual: "办公室亮着灯",
      narration: "每天加班最多，积累最少。",
    },
  ],
};

const clone = (a: RawArticle): RawArticle =>
  JSON.parse(JSON.stringify(a)) as RawArticle;

const F: ReviseFinding = {
  id: "F-001",
  code: "LOGIC_OVERGENERALIZATION",
  severity: "Moderate",
  quote: "先分清是暂时疲惫，还是持续耗竭。",
  description: "缺少判断标准",
  recommendation: "给出两周观察期标准",
};

describe("verifySurgicalRevision — the surgical contract", () => {
  it("keeps a targeted edit and passes untargeted text through", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.structurePreserved).toBe(true);
    expect(audit.revertedSections).toBe(0);
    expect(fixed.sections![0]!.body).toContain("专业帮助");
    expect(fixed.sections![1]!.body).toBe(BASE.sections![1]!.body);
  });

  it("reverts an untargeted section the model 'improved'", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    next.sections![1]!.body = "每天加班最多，积累最少。（顺手润色）";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.revertedSections).toBe(1);
    expect(fixed.sections![1]!.body).toBe(BASE.sections![1]!.body);
    // The targeted edit survives.
    expect(fixed.sections![0]!.body).toContain("专业帮助");
  });

  it("reverts an untargeted scene edit", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    next.scenes![1]!.narration = "每天加班最多，积累最少。改了没被引用的部分。";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.revertedScenes).toBe(1);
    expect(fixed.scenes![1]!.narration).toBe(BASE.scenes![1]!.narration);
  });

  it("keeps an edit to a scene the finding quotes (narration)", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    next.scenes![0]!.narration = "先分清：两周未改善就寻求专业帮助。";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.revertedScenes).toBe(0);
    expect(fixed.scenes![0]!.narration).toContain("专业帮助");
  });

  it("reverts title/hook changes no finding targets", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    next.title = "一个更标准的标题";
    next.hook = "一个更抓人的开场。";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.revertedTitle).toBe(true);
    expect(audit.revertedHook).toBe(true);
    expect(fixed.title).toBe(BASE.title);
    expect(fixed.hook).toBe(BASE.hook);
  });

  it("reverts the WHOLE revision when section count changes", () => {
    const next = clone(BASE);
    next.sections!.push({ heading: "新增一节", body: "结构不该动。" });
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.structurePreserved).toBe(false);
    expect(fixed).toEqual(BASE);
  });

  it("reverts the WHOLE revision when scene ids change", () => {
    const next = clone(BASE);
    next.scenes![1]!.id = "scene_2b";
    const { fixed, audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit.structurePreserved).toBe(false);
    expect(fixed).toEqual(BASE);
  });

  it("allows an untargeted-but-identical pass-through (no reverts)", () => {
    const next = clone(BASE);
    next.sections![0]!.body = "先分清：两周未改善就寻求专业帮助。";
    const { audit } = verifySurgicalRevision(BASE, next, [F]);
    expect(audit).toStrictEqual({
      structurePreserved: true,
      revertedSections: 0,
      revertedScenes: 0,
      revertedTitle: false,
      revertedHook: false,
    });
  });
});

describe("buildReviseMessages", () => {
  it("carries the draft, findings, and research notes", () => {
    const msgs = buildReviseMessages({
      base: BASE,
      baseMarkdown: "# 你不是在努力，只是在吃苦",
      findings: [F],
      researchNotes: [
        { claim: "余世存引语", verdict: "unsupported", notes: "查无出处" },
      ],
      topic: "努力",
      audience: "general",
      language: "zh-CN",
      duration: 240,
    });
    const sys = msgs[0]!.content;
    const user = msgs[1]!.content;
    expect(sys).toContain("SURGICAL");
    expect(user).toContain("## Current draft (rejected");
    expect(user).toContain("[F-001 | LOGIC_OVERGENERALIZATION | Moderate]");
    expect(user).toContain("Required fix");
    expect(user).toContain("Fact-check research");
    expect(user).toContain("unsupported");
  });

  it("omits the research block when no notes are provided", () => {
    const msgs = buildReviseMessages({
      base: BASE,
      baseMarkdown: "# x",
      findings: [F],
      topic: "努力",
      audience: "general",
      language: "zh-CN",
      duration: 240,
    });
    expect(msgs[1]!.content).not.toContain("Fact-check research");
  });
});
