import { describe, expect, it } from "vitest";
import { VISUAL_BUILDERS } from "./visual-builders.js";
import type { Scene as ArticleScene } from "./schemas.js";

const scene = (
  partial: Partial<ArticleScene> & Pick<ArticleScene, "id" | "duration">,
): ArticleScene => ({
  caption: "",
  visual: "",
  narration: "",
  ...partial,
});

describe("buildTitle", () => {
  it("emits text from caption and subtext from visual", () => {
    const props = VISUAL_BUILDERS.Title!(
      scene({
        id: "scene_1",
        duration: 5,
        caption: "Title text",
        visual: "A short subtext",
      }),
      { section: null },
    );
    expect(props.text).toBe("Title text");
    expect(props.subtext).toBe("A short subtext");
  });

  it("truncates subtext to 80 chars with a trailing …", () => {
    const long = "x".repeat(120);
    const props = VISUAL_BUILDERS.Title!(
      scene({ id: "scene_1", duration: 5, caption: "c", visual: long }),
      { section: null },
    );
    expect((props.subtext as string).length).toBeLessThanOrEqual(51);
    expect((props.subtext as string).endsWith("…")).toBe(true);
  });
});

describe("buildFlowChart", () => {
  it("extracts nodes from the section's bullet list", () => {
    const props = VISUAL_BUILDERS.FlowChart!(
      scene({
        id: "scene_2",
        duration: 8,
        caption: "流程",
        visual: "流水线节点",
        narration: "步骤 1: 连接。步骤 2: 比对。",
      }),
      {
        section: {
          heading: "## 1. 流程",
          body: "- 步骤 1: 连接\n- 步骤 2: 比对\n- 步骤 3: 报告",
        },
      },
    );
    expect(props.nodes).toEqual([
      "步骤 1: 连接",
      "步骤 2: 比对",
      "步骤 3: 报告",
    ]);
    expect(props.direction).toBe("left-to-right");
  });

  it("falls back to 3 generic step nodes when the section is empty", () => {
    const props = VISUAL_BUILDERS.FlowChart!(
      scene({
        id: "scene_2",
        duration: 8,
        caption: "流程",
        visual: "流水线",
        narration: "开始 → 过程 → 结果",
      }),
      { section: null },
    );
    expect(Array.isArray(props.nodes)).toBe(true);
    expect((props.nodes as string[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildTerminal", () => {
  it("extracts lines from a fenced code block in the section", () => {
    const props = VISUAL_BUILDERS.Terminal!(
      scene({
        id: "scene_3",
        duration: 6,
        caption: "代码",
        visual: "代码片段",
        narration: "看一段示例",
      }),
      {
        section: {
          heading: "## 3. 代码",
          body: "```python\nprint('hello')\nfor i in range(10):\n  print(i)\n```",
        },
      },
    );
    expect(props.lines).toEqual([
      "print('hello')",
      "for i in range(10):",
      "  print(i)",
    ]);
    expect(props.prompt).toBe("$");
  });

  it("falls back to narration sentences when no code block is present", () => {
    const props = VISUAL_BUILDERS.Terminal!(
      scene({
        id: "scene_3",
        duration: 6,
        caption: "代码",
        visual: "示例",
        narration: "first line. second line. third line?",
      }),
      { section: null },
    );
    expect((props.lines as string[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildCallout", () => {
  it("derives a warning kind from the visual/caption", () => {
    const props = VISUAL_BUILDERS.Callout!(
      scene({
        id: "scene_4",
        duration: 5,
        caption: "注意",
        visual: "警告提示",
        narration: "这是一个需要小心的坑",
      }),
      { section: null },
    );
    expect(props.kind).toBe("warning");
    expect(props.text).toBe("这是一个需要小心的坑");
  });

  it("derives success kind from positive cue words", () => {
    const props = VISUAL_BUILDERS.Callout!(
      scene({
        id: "scene_4",
        duration: 5,
        caption: "成功",
        visual: "达成目标",
        narration: "恭喜你做到了",
      }),
      { section: null },
    );
    expect(props.kind).toBe("success");
  });

  it("defaults to kind=info when no cue word matches", () => {
    const props = VISUAL_BUILDERS.Callout!(
      scene({
        id: "scene_4",
        duration: 5,
        caption: "事实",
        visual: "普通说明",
        narration: "这是事实描述。",
      }),
      { section: null },
    );
    expect(props.kind).toBe("info");
  });
});

describe("buildComparison", () => {
  it("splits narration on 对比 marker into left/right", () => {
    const props = VISUAL_BUILDERS.Comparison!(
      scene({
        id: "scene_5",
        duration: 8,
        caption: "对比",
        visual: "对比 vs 之前",
        narration: "之前需要手动操作。现在可以一键完成。",
      }),
      { section: null },
    );
    const left = props.left as { title: string; items: string[] };
    const right = props.right as { title: string; items: string[] };
    expect(left.items.length).toBeGreaterThan(0);
    expect(right.items.length).toBeGreaterThan(0);
  });

  it("falls back to half-split when no contrast marker is found", () => {
    const props = VISUAL_BUILDERS.Comparison!(
      scene({
        id: "scene_5",
        duration: 8,
        caption: "对比",
        visual: "v",
        narration: "句一。句二。句三。句四。",
      }),
      { section: null },
    );
    const left = props.left as { title: string; items: string[] };
    const right = props.right as { title: string; items: string[] };
    expect(left.items.length + right.items.length).toBeGreaterThan(0);
  });
});

describe("buildTimeline", () => {
  it("extracts year labels from the section body", () => {
    const props = VISUAL_BUILDERS.Timeline!(
      scene({
        id: "scene_6",
        duration: 6,
        caption: "历史",
        visual: "时间线展示",
        narration: "2020 年上线",
      }),
      {
        section: {
          heading: "## 2. 历史",
          body: "2020 年上线，2021 年扩展，2022 年迁移到云端。",
        },
      },
    );
    const events = props.events as { label: string }[];
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.label).toMatch(/^20\d{2}/);
  });

  it("falls back to a 4-step default timeline when no year tokens exist", () => {
    const props = VISUAL_BUILDERS.Timeline!(
      scene({
        id: "scene_6",
        duration: 6,
        caption: "历史",
        visual: "时间线",
        narration: "很早以前，后来，现在",
      }),
      { section: null },
    );
    const events = props.events as { label: string }[];
    expect(events).toHaveLength(4);
  });
});

describe("buildIllustration / buildAnimatedIllustration", () => {
  it("returns caption + visual as plain props", () => {
    const props = VISUAL_BUILDERS.AnimatedIllustration!(
      scene({
        id: "scene_7",
        duration: 5,
        caption: "图",
        visual: "a serene lake at sunset",
      }),
      { section: null },
    );
    expect(props.text).toBe("图");
    expect(props.visual).toBe("a serene lake at sunset");
  });
});