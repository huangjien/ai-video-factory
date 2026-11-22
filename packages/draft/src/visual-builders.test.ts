import { describe, expect, it } from "vitest";
import { VISUAL_BUILDERS, extractEnumeration } from "./visual-builders.js";
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
  it("emits bullets when the first scene's narration enumerates", () => {
    const props = VISUAL_BUILDERS.Title!(
      scene({
        id: "scene_1",
        duration: 5,
        caption: "学不进，玩不尽兴",
        visual: "A direction",
        narration:
          "学也学不进去，玩也玩不尽兴，睡也睡不安稳，偏偏胃口还特别好。这样的日子，你可能也正在经历。",
      }),
      { section: null, title: "你不是在努力，只是在吃苦" },
    );
    expect(props.text).toBe("学不进，玩不尽兴");
    // The small line is the enumeration — the film's title is gone.
    expect(props.bullets).toStrictEqual([
      "学也学不进去",
      "玩也玩不尽兴",
      "睡也睡不安稳",
      "偏偏胃口还特别好",
    ]);
    expect(props.subtext).toBeUndefined();
    expect(JSON.stringify(props)).not.toContain("你不是在努力");
  });

  it("carries the article's artistic treatment into the props", () => {
    const props = VISUAL_BUILDERS.Title!(
      scene({ id: "scene_1", duration: 5, caption: "玄武门之变" }),
      { section: null, titleStyle: "brush" },
    );
    expect(props.style).toBe("brush");
  });

  it("falls back to the default treatment for an unknown style", () => {
    const props = VISUAL_BUILDERS.Title!(
      scene({ id: "scene_1", duration: 5, caption: "玄武门之变" }),
      { section: null, titleStyle: "brussh" },
    );
    expect(props.style).toBeUndefined();
  });

  it("outputs nothing when the narration does not enumerate", () => {
    // The old fallback put the film's title in the small line, where it
    // read as a redundant echo of the caption (user: bullets or nothing).
    const props = VISUAL_BUILDERS.Title!(
      scene({
        id: "scene_1",
        duration: 5,
        caption: "Title text",
        visual: "a direction",
        narration: "只有一句话的旁白，没有并列结构。",
      }),
      { section: null, title: "The Film Title" },
    );
    expect(props.bullets).toBeUndefined();
    expect(props.subtext).toBeUndefined();
    expect(JSON.stringify(props)).not.toContain("The Film Title");
  });

  it("never puts the art direction on screen", () => {
    // `visual:` is a PROMPT for the image model, not viewer-facing copy.
    // It used to be burned onto the title card as the subtitle.
    const visual =
      "画面左右分成两栏，左侧铺满桌面的宏大城堡剪影静止，右侧一本小说停在空白页";
    const props = VISUAL_BUILDERS.Title!(
      scene({ id: "scene_1", duration: 5, caption: "c", visual }),
      { section: null, title: "读者为什么弃书" },
    );
    expect(JSON.stringify(props)).not.toContain("画面左右分成两栏");
  });
});

describe("extractEnumeration", () => {
  it("finds a 、-separated list and strips the colon lead-in", () => {
    expect(
      extractEnumeration(
        "别再说每天进步一点点这样的空话。换成可执行的节奏：每周练一项技能，做一次复盘，交付一个可验证的小里程碑。",
      ),
    ).toStrictEqual([
      "每周练一项技能",
      "做一次复盘",
      "交付一个可验证的小里程碑",
    ]);
  });

  it("drops tail clauses and cleft lead-ins", () => {
    // 都会影响结果 is the claim, not a fourth item; 最怕的是 is the
    // lead-in to the list.
    expect(
      extractEnumeration("方向、环境、运气，都会影响结果。"),
    ).toStrictEqual(["方向", "环境", "运气"]);
    expect(
      extractEnumeration("最怕的是，不甘心平庸，又不肯付出，讨厌拖延。"),
    ).toStrictEqual(["不甘心平庸", "不肯付出", "讨厌拖延"]);
  });

  it("returns nothing for clause chains and negated conclusions", () => {
    // 把时间投在… averages ~10 characters — a clause chain, not a list.
    expect(
      extractEnumeration(
        "把时间投在能积累的事情上，精神状态反而会更稳、更有活力一些。",
      ),
    ).toStrictEqual([]);
    // 并不等于… is the sentence's conclusion.
    expect(
      extractEnumeration("每天加班、任劳任怨，并不等于真正的努力。"),
    ).toStrictEqual([]);
  });

  it("returns nothing for plain prose", () => {
    expect(extractEnumeration("冲动的决定，很多人后悔一阵子。")).toStrictEqual(
      [],
    );
  });

  it("rejects mixed-granularity fragments — scene beats, not a list", () => {
    // A real failure on 军种与兵种的组织文化: the opening's scene
    // description chopped into [军舰在夜里航行, 舰桥, 机舱, …] — places
    // (2 chars) mixed with a clause (9 chars) is not parallel structure.
    // Rule: the longest segment stays within 3× the shortest.
    expect(
      extractEnumeration(
        "想象三个场景。一艘军舰在夜间航行。舰桥、动力舱、通信室和损管小组，各自盯着自己的岗位。",
      ),
    ).toStrictEqual([]);
  });
});

describe("buildImageBackground", () => {
  it("points each scene at its generated image", () => {
    const props = VISUAL_BUILDERS.ImageBackground!(
      scene({
        id: "scene_7",
        duration: 5,
        caption: "图",
        visual: "a serene lake at sunset",
      }),
      { section: null },
    );
    expect(props).toStrictEqual({
      src: "assets/images/scene_7.jpg",
      fit: "cover",
    });
  });
});
describe("buildDoodleScene — seeded hand-drawn strokes", () => {
  it("produces 4 schema-valid strokes, deterministic for the same scene", async () => {
    const { DoodleScenePropsSchema } = await import("@video/video-components");
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

