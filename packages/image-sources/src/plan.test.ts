import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  ImageSourcePlanError,
  buildPlanMessages,
  normalizePlan,
  planSceneSources,
} from "./plan.js";
import type { PlanInput } from "./plan.js";

const input: PlanInput = {
  title: "玄武门之变",
  setting: "Tang-dynasty China, 626 CE",
  scenes: [
    {
      scene: 1,
      id: "scene_1",
      visual: "帝王侧影立於丹墀之前",
      caption: "李世民",
      narration: "公元626年，玄武门之变。",
    },
    {
      scene: 2,
      id: "scene_2",
      visual: "抽象的治理概念图",
    },
  ],
};

describe("buildPlanMessages", () => {
  it("sends every scene with its number, visual and caption", () => {
    const messages = buildPlanMessages(input);
    expect(messages).toHaveLength(2);
    const user = messages[1]?.content ?? "";
    expect(user).toContain("玄武门之变");
    expect(user).toContain("Tang-dynasty China, 626 CE");
    expect(user).toContain("Scene 1 (scene_1)");
    expect(user).toContain("帝王侧影立於丹墀之前");
    expect(user).toContain("on-screen text: 李世民");
    expect(user).toContain("Scene 2 (scene_2)");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildPlanMessages(input)[0]?.content ?? "";
    expect(system).toContain("direct");
    expect(system).toContain("reference");
  });
});

describe("normalizePlan", () => {
  it("keeps a planned scene as planned", () => {
    const out = normalizePlan(
      [
        {
          scene: 1,
          historical: true,
          subject: "李世民",
          query: "李世民 Tang dynasty portrait",
          mode: "direct",
          reason: "a named emperor",
        },
        {
          scene: 2,
          historical: false,
          subject: "",
          query: "",
          mode: "none",
          reason: "abstract",
        },
      ],
      input,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.historical).toBe(true);
    expect(out[0]?.mode).toBe("direct");
    expect(out[0]?.query).toContain("李世民");
    expect(out[1]?.mode).toBe("none");
  });

  it("plans a scene the model skipped as no picture", () => {
    const out = normalizePlan([], input);
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.mode === "none")).toBe(true);
    expect(out.every((p) => p.query === "")).toBe(true);
  });

  it("refuses a historical plan with no query — there is nothing to look for", () => {
    const out = normalizePlan(
      [
        {
          scene: 1,
          historical: true,
          subject: "李世民",
          query: "   ",
          mode: "direct",
          reason: "",
        },
      ],
      input,
    );
    expect(out[0]?.historical).toBe(false);
    expect(out[0]?.mode).toBe("none");
  });

  it("drops a plan entry for a scene that does not exist", () => {
    const out = normalizePlan(
      [
        {
          scene: 99,
          historical: true,
          subject: "x",
          query: "x",
          mode: "direct",
          reason: "",
        },
      ],
      input,
    );
    expect(out.map((p) => p.scene)).toEqual([1, 2]);
  });
});

describe("planSceneSources", () => {
  const provider = (respond: () => string): Provider => ({
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  });

  it("returns the plan the model wrote", async () => {
    const plan = await planSceneSources(
      input,
      provider(
        () => `scenes:
  - scene: 1
    historical: true
    subject: "唐太宗 李世民"
    query: "Li Shimin"
    mode: direct
    reason: "a historical figure"`,
      ),
    );
    expect(plan[0]).toEqual({
      scene: 1,
      historical: true,
      subject: "唐太宗 李世民",
      query: "Li Shimin",
      mode: "direct",
      reason: "a historical figure",
    });
  });

  it("reports an unreadable answer as its own error", async () => {
    const error = await planSceneSources(
      input,
      provider(() => "not yaml"),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ImageSourcePlanError);
    const planError = error as ImageSourcePlanError;
    expect(planError.providerName).toBe("fake");
    expect(planError.cause).toBeDefined();
  });
});
