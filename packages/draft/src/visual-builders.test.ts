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
describe("buildSvgScene — rich-family diagram synthesis", () => {
  it("lays out extracted nodes as a left-to-right chain with edges, schema-valid", async () => {
    const { SvgScenePropsSchema } = await import("@vf/video-components");
    const props = VISUAL_BUILDERS.SvgScene!(
      scene({
        id: "scene_2",
        duration: 10,
        caption: "工具链",
        visual: "网络节点流程图",
        narration: "先研究，再写作，最后渲染。",
      }),
      { section: { heading: "t", body: "- 节点一\n- 节点二\n- 节点三" } },
    );
    const parsed = SvgScenePropsSchema.safeParse(props);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nodes.length).toBeGreaterThanOrEqual(3);
      expect(parsed.data.edges).toHaveLength(parsed.data.nodes.length - 1);
      for (const n of parsed.data.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(1920);
        expect(n.y + n.h).toBeLessThan(1080);
        expect(n.text).toBeTruthy();
      }
    }
  });

  it("never emits zero nodes when little can be extracted", async () => {
    const { SvgScenePropsSchema } = await import("@vf/video-components");
    const props = VISUAL_BUILDERS.SvgScene!(
      scene({ id: "scene_2", duration: 8, caption: "唯一要点" }),
      { section: null },
    );
    const parsed = SvgScenePropsSchema.safeParse(props);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nodes.length).toBeGreaterThanOrEqual(1);
      expect(parsed.data.edges).toHaveLength(parsed.data.nodes.length - 1);
    }
  });
});

describe("buildDoodleScene — seeded hand-drawn strokes", () => {
  it("produces 4 schema-valid strokes, deterministic for the same scene", async () => {
    const { DoodleScenePropsSchema } = await import("@vf/video-components");
    const s = scene({
      id: "scene_3",
      duration: 8,
      caption: "要点清单",
      visual: "列表要点",
    });
    const a = VISUAL_BUILDERS.DoodleScene!(s, { section: null });
    const b = VISUAL_BUILDERS.DoodleScene!(s, { section: null });
    expect(a).toEqual(b);
    const parsed = DoodleScenePropsSchema.safeParse(a);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.strokes).toHaveLength(4);
      for (const st of parsed.data.strokes) {
        expect(["circle", "star", "zigzag", "spiral"]).toContain(st.shape);
        expect(st.x).toBeGreaterThan(0);
        expect(st.x).toBeLessThan(1920);
        expect(st.y).toBeGreaterThan(0);
        expect(st.y).toBeLessThan(1080);
      }
    }
  });
});

describe("buildQuoteBlock (v0.4.2)", () => {
  it("extracts the first narration sentence as the quote", () => {
    const props = VISUAL_BUILDERS.QuoteBlock!(
      scene({
        id: "scene_q",
        duration: 6,
        caption: "引用",
        visual: "一段引文",
        narration: "知之为知之，不知为不知。这是孔子的教诲。",
      }),
      { section: null },
    );
    expect(props.quote).toBe("知之为知之，不知为不知");
  });

  it("extracts the author from a dash attribution", () => {
    const props = VISUAL_BUILDERS.QuoteBlock!(
      scene({
        id: "scene_q2",
        duration: 6,
        caption: "名言",
        visual: "——爱因斯坦",
        narration: "想象力比知识更重要。",
      }),
      { section: null },
    );
    expect(props.quote).toBe("想象力比知识更重要");
    expect(props.author).toBe("爱因斯坦");
  });
});

describe("buildStatGrid (v0.4.2)", () => {
  it("extracts up to 4 number+unit stats with labels", () => {
    const props = VISUAL_BUILDERS.StatGrid!(
      scene({
        id: "scene_s",
        duration: 6,
        caption: "关键数据",
        visual: "百分比",
        narration: "准确率 95%，速度快 3倍，成本 20% 降低。",
      }),
      { section: null },
    );
    const stats = props.stats as { value: string; label: string }[];
    expect(stats.length).toBeGreaterThanOrEqual(2);
    expect(stats.some((s) => s.value.includes("95"))).toBe(true);
  });

  it("falls back to a single caption-labeled stat", () => {
    const props = VISUAL_BUILDERS.StatGrid!(
      scene({
        id: "scene_s2",
        duration: 6,
        caption: "增长趋势",
        visual: "数据统计",
        narration: "一直在增长。",
      }),
      { section: null },
    );
    const stats = props.stats as { value: string; label: string }[];
    expect(stats).toHaveLength(1);
    expect(stats[0]!.label).toBe("增长趋势");
  });
});

describe("buildBarChart (v0.4.2)", () => {
  it("extracts label:percent pairs into bars", () => {
    const props = VISUAL_BUILDERS.BarChart!(
      scene({
        id: "scene_b",
        duration: 6,
        caption: "语言分布",
        visual: "柱状图",
        narration: "中文 60%，英文 40%。",
      }),
      { section: null },
    );
    const bars = props.bars as { label: string; value: number; display: string }[];
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0]!.display).toMatch(/%$/);
  });

  it("falls back to a descending illustrative ramp", () => {
    const props = VISUAL_BUILDERS.BarChart!(
      scene({
        id: "scene_b2",
        duration: 6,
        caption: "高、中、低",
        visual: "分布",
        narration: "没有具体数字。",
      }),
      { section: null },
    );
    const bars = props.bars as { label: string; value: number }[];
    expect(bars.length).toBe(3);
    expect(bars[0]!.value).toBeGreaterThan(bars[1]!.value);
  });
});

describe("buildLeaderboard (v0.4.2)", () => {
  it("extracts numbered entries in order", () => {
    const props = VISUAL_BUILDERS.Leaderboard!(
      scene({
        id: "scene_l",
        duration: 6,
        caption: "榜单",
        visual: "排行榜",
        narration: "",
      }),
      {
        section: {
          heading: "## 排行",
          body: "1. Alpha\n2. Beta\n3. Gamma",
        },
      },
    );
    const entries = props.entries as { name: string }[];
    expect(entries.map((e) => e.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("falls back to generic medal names", () => {
    const props = VISUAL_BUILDERS.Leaderboard!(
      scene({ id: "scene_l2", duration: 6, caption: "冠军榜", visual: "排名" }),
      { section: null },
    );
    const entries = props.entries as { name: string }[];
    expect(entries.length).toBe(3);
  });
});

describe("buildChecklist (v0.4.2)", () => {
  it("extracts bullets from the section body", () => {
    const props = VISUAL_BUILDERS.Checklist!(
      scene({
        id: "scene_c",
        duration: 6,
        caption: "注意事项",
        visual: "避坑清单",
        narration: "",
      }),
      {
        section: {
          heading: "## 检查",
          body: "- 先写测试\n- 小步提交\n- 及时重构",
        },
      },
    );
    const items = props.items as { text: string }[];
    expect(items.map((i) => i.text)).toEqual(["先写测试", "小步提交", "及时重构"]);
  });
});

describe("buildBigIdea (v0.4.2)", () => {
  it("uses the caption as the statement and picks a zh kicker", () => {
    const props = VISUAL_BUILDERS.BigIdea!(
      scene({
        id: "scene_i",
        duration: 6,
        caption: "简单优于复杂",
        visual: "核心观点",
        narration: "记住这一点。",
      }),
      { section: null },
    );
    expect(props.text).toBe("简单优于复杂");
    expect(props.kicker).toBe("核心观点");
  });
});

describe("buildPyramidDiagram (v0.4.2)", () => {
  it("maps bullet list to levels top-first", () => {
    const props = VISUAL_BUILDERS.PyramidDiagram!(
      scene({
        id: "scene_p",
        duration: 6,
        caption: "层级",
        visual: "金字塔",
        narration: "",
      }),
      {
        section: {
          heading: "## 分层",
          body: "- 顶层结论\n- 方法路径\n- 基础事实",
        },
      },
    );
    expect(props.levels).toEqual(["顶层结论", "方法路径", "基础事实"]);
  });

  it("falls back to 3 generic layers", () => {
    const props = VISUAL_BUILDERS.PyramidDiagram!(
      scene({ id: "scene_p2", duration: 6, caption: "层级图", visual: "金字塔" }),
      { section: null },
    );
    expect(props.levels).toHaveLength(3);
  });
});

describe("buildVennDiagram (v0.4.2)", () => {
  it("splits the caption on conjunctions into 2-3 sets", () => {
    const props = VISUAL_BUILDERS.VennDiagram!(
      scene({
        id: "scene_v",
        duration: 6,
        caption: "AI、教育、数据",
        visual: "维恩图 交集",
        narration: "",
      }),
      { section: null },
    );
    expect(props.sets).toEqual(["AI", "教育", "数据"]);
  });

  it("falls back to two placeholder sets", () => {
    const props = VISUAL_BUILDERS.VennDiagram!(
      scene({ id: "scene_v2", duration: 6, caption: "重叠", visual: "维恩" }),
      { section: null },
    );
    expect(props.sets).toHaveLength(2);
  });
});

describe("buildCycleDiagram (v0.4.2)", () => {
  it("reuses the node extractor for loop stages", () => {
    const props = VISUAL_BUILDERS.CycleDiagram!(
      scene({
        id: "scene_y",
        duration: 8,
        caption: "循环改进",
        visual: "闭环迭代",
        narration: "步骤 1: 计划。步骤 2: 执行。",
      }),
      {
        section: {
          heading: "## 闭环",
          body: "- 计划目标\n- 执行落地\n- 检查结果\n- 改进迭代",
        },
      },
    );
    expect(props.stages).toEqual(["计划目标", "执行落地", "检查结果", "改进迭代"]);
  });

  it("falls back to a PDCA-like cycle", () => {
    const props = VISUAL_BUILDERS.CycleDiagram!(
      scene({ id: "scene_y2", duration: 6, caption: "循环", visual: "飞轮" }),
      { section: null },
    );
    const stages = props.stages as string[];
    expect(stages.length).toBeGreaterThanOrEqual(3);
  });
});
