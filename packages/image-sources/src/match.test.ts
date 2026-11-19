import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  buildMatchMessages,
  matchSceneSources,
  type SceneCandidates,
} from "./match.js";

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const scenes: SceneCandidates[] = [
  {
    scene: 3,
    subject: "唐高宗 李治",
    mode: "reference",
    candidates: [
      { title: "Gaozong of Song.jpg", source: "commons", pageUrl: "u1" },
      { title: "Tang Gaozong.jpg", source: "commons", pageUrl: "u2" },
    ],
  },
  {
    scene: 4,
    subject: "唐长安城 玄武门",
    mode: "direct",
    candidates: [
      { title: "Mall in Shijiazhuang.jpg", source: "openverse", pageUrl: "u3" },
    ],
  },
];

describe("buildMatchMessages", () => {
  it("numbers the candidates and names the subject", () => {
    const user = buildMatchMessages(scenes)[1]?.content ?? "";
    expect(user).toContain("Scene 3 — subject: 唐高宗 李治");
    expect(user).toContain("[0] Gaozong of Song.jpg (commons)");
    expect(user).toContain("[1] Tang Gaozong.jpg (commons)");
    expect(user).toContain("[0] Mall in Shijiazhuang.jpg (openverse)");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildMatchMessages(scenes)[0]?.content ?? "";
    expect(system).toContain("-1");
    expect(system).toContain("MEANING");
  });
});

describe("matchSceneSources", () => {
  it("takes the pick the model made", async () => {
    const picks = await matchSceneSources(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 3
    pick: 1
    reason: "the Tang-dynasty emperor"
  - scene: 4
    pick: -1
    reason: "a modern mall is not the Xuanwu Gate"
`,
      ),
    );
    expect(picks.get(3)).toBe(1);
    expect(picks.get(4)).toBe(-1);
  });

  it("refuses a pick that is outside the candidate list", async () => {
    const picks = await matchSceneSources(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 3
    pick: 7
    reason: "hallucinated index"
`,
      ),
    );
    // An index the model made up is not a pick — the scene gets nothing.
    expect(picks.get(3)).toBe(-1);
  });

  it("asks about nothing when there is nothing to ask about", async () => {
    const picks = await matchSceneSources(
      [{ scene: 1, subject: "x", mode: "none", candidates: [] }],
      fakeProvider(() => "should not be called"),
    );
    expect(picks.size).toBe(0);
  });
});
