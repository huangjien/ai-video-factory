import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

import {
  MAX_VIDEO_SCENES,
  VideoSourcePlanError,
  buildVideoPlanMessages,
  normalizeVideoPlan,
  planSceneVideos,
  type PlanVideoInput,
} from "./plan.js";

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const input: PlanVideoInput = {
  title: "谁被允许下阴间",
  setting: "Tang China, 7th century",
  scenes: [
    {
      scene: 1,
      id: "scene_1",
      visual: "a bronze underworld gate",
      caption: "死亡不等于放行",
      narration: "孙悟空的名字被写进生死簿，地府便来勾魂。",
    },
    {
      scene: 2,
      id: "scene_2",
      visual: "a lantern on a stone step",
      caption: "",
      narration: "",
    },
  ],
};

const planYaml = `\`\`\`yaml
scenes:
  - scene: 1
    historical: true
    subject: "阎罗王"
    query: "ten kings of hell"
    reason: "the subject is a historical figure"
  - scene: 2
    historical: false
    subject: ""
    query: ""
    reason: "no archival footage of this scene"
\`\`\``;

describe("buildVideoPlanMessages", () => {
  it("states the per-film cap and the title", () => {
    const user = buildVideoPlanMessages(input)[1]?.content ?? "";
    expect(user).toContain(`up to ${MAX_VIDEO_SCENES}`);
    expect(user).toContain("Video title: 谁被允许下阴间");
    expect(user).toContain("Setting: Tang China, 7th century");
  });

  it("numbers the scenes and carries their visual, text and narration", () => {
    const user = buildVideoPlanMessages(input)[1]?.content ?? "";
    expect(user).toContain("Scene 1 (scene_1): a bronze underworld gate");
    expect(user).toContain("on-screen text: 死亡不等于放行");
    expect(user).toContain("narration: 孙悟空的名字被写进生死簿");
  });

  it("leaves out a scene's empty text and narration", () => {
    const user = buildVideoPlanMessages(input)[1]?.content ?? "";
    const secondScene = user.split("Scene 2 (scene_2)")[1] ?? "";
    expect(secondScene).not.toContain("on-screen text:");
    expect(secondScene).not.toContain("narration:");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildVideoPlanMessages(input)[0]?.content ?? "";
    expect(system).toContain("scenes");
  });
});

describe("normalizeVideoPlan", () => {
  it("keeps a planned scene as it is, trimmed", () => {
    const out = normalizeVideoPlan(
      [
        {
          scene: 1,
          historical: true,
          subject: " 阎罗王 ",
          query: " ten kings of hell ",
          reason: " a figure ",
        },
      ],
      input,
    );
    expect(out[0]).toEqual({
      scene: 1,
      historical: true,
      subject: "阎罗王",
      query: "ten kings of hell",
      reason: "a figure",
    });
  });

  it("plans a scene the model skipped as no clip", () => {
    const out = normalizeVideoPlan([], input);
    expect(out[0]).toEqual({
      scene: 1,
      historical: false,
      subject: "",
      query: "",
      reason: "not planned",
    });
  });

  it("plans a scene with an empty query as no clip", () => {
    const out = normalizeVideoPlan(
      [
        {
          scene: 1,
          historical: true,
          subject: "阎罗王",
          query: "   ",
          reason: "historical",
        },
      ],
      input,
    );
    expect(out[0]?.historical).toBe(false);
    expect(out[0]?.reason).toBe("not planned");
  });

  it("drops a plan entry for a scene that does not exist", () => {
    const out = normalizeVideoPlan(
      [
        {
          scene: 99,
          historical: true,
          subject: "nobody",
          query: "nobody",
          reason: "invented",
        },
      ],
      input,
    );
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.scene === 99)).toBe(false);
  });

  it("keeps at most the per-film cap, and says why the rest were left out", () => {
    const many = {
      title: "long film",
      scenes: Array.from({ length: MAX_VIDEO_SCENES + 3 }, (_, i) => ({
        scene: i + 1,
        id: `scene_${i + 1}`,
        visual: `a scene ${i + 1}`,
      })),
    };
    const raw = many.scenes.map((s) => ({
      scene: s.scene,
      historical: true,
      subject: "a subject",
      query: "a query",
      reason: "historical",
    }));
    const out = normalizeVideoPlan(raw, many);
    const kept = out.filter((p) => p.historical);
    expect(kept).toHaveLength(MAX_VIDEO_SCENES);
    expect(out[MAX_VIDEO_SCENES]?.reason).toContain("footage cap");
  });
});

describe("planSceneVideos", () => {
  it("returns the plan the model wrote", async () => {
    const plan = await planSceneVideos(
      input,
      fakeProvider(() => planYaml),
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({
      scene: 1,
      historical: true,
      subject: "阎罗王",
      query: "ten kings of hell",
      reason: "the subject is a historical figure",
    });
    expect(plan[1]?.historical).toBe(false);
  });

  it("reports an unreadable answer as its own error", async () => {
    await expect(
      planSceneVideos(
        input,
        fakeProvider(() => "not yaml"),
      ),
    ).rejects.toThrow(VideoSourcePlanError);
  });
});
