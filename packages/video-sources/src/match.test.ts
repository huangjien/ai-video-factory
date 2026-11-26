import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";

import {
  VideoSourceMatchError,
  buildVideoMatchMessages,
  matchSceneVideos,
  type SceneVideoCandidates,
} from "./match.js";

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

const scenes: SceneVideoCandidates[] = [
  {
    scene: 3,
    subject: "阎罗王的生死簿",
    candidates: [
      {
        title: "Ten Kings of Hell.jpg",
        source: "commons",
        pageUrl: "u1",
        durationSec: 12,
      },
      {
        title: "St. Peter keys.jpg",
        source: "commons",
        pageUrl: "u2",
        durationSec: null,
      },
    ],
  },
  {
    scene: 4,
    subject: "Charon and the obol",
    candidates: [
      {
        title: "Charon.jpg",
        source: "openverse",
        pageUrl: "u3",
        durationSec: 95.4,
      },
    ],
  },
];

describe("buildVideoMatchMessages", () => {
  it("numbers the clips, names the subject, and gives the duration", () => {
    const user = buildVideoMatchMessages(scenes)[1]?.content ?? "";
    expect(user).toContain("Scene 3 — subject: 阎罗王的生死簿");
    expect(user).toContain("[0] Ten Kings of Hell.jpg [12 s] (commons) — u1");
    expect(user).toContain("[1] St. Peter keys.jpg (commons) — u2");
    expect(user).toContain("[0] Charon.jpg [95 s] (openverse) — u3");
  });

  it("says so when a scene found no clip at all", () => {
    const user =
      buildVideoMatchMessages([
        { scene: 9, subject: "nothing here", candidates: [] },
      ])[1]?.content ?? "";
    expect(user).toContain("Scene 9 — subject: nothing here");
    expect(user).toContain("(no clip was found)");
  });

  it("carries the system prompt from the registry", () => {
    const system = buildVideoMatchMessages(scenes)[0]?.content ?? "";
    expect(system).toContain("-1");
  });
});

describe("matchSceneVideos", () => {
  it("maps a scene to the clip index the model picked", async () => {
    const picks = await matchSceneVideos(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 3
    pick: 1
    reason: the St. Peter picture is not the Ten Kings
  - scene: 4
    pick: 0
    reason: Charon with the obol`,
      ),
    );
    expect(picks.get(3)).toBe(1);
    expect(picks.get(4)).toBe(0);
  });

  it("keeps -1 as 'no clip for this scene'", async () => {
    const picks = await matchSceneVideos(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 3
    pick: -1
    reason: nothing matches
  - scene: 4
    pick: 0
    reason: Charon`,
      ),
    );
    expect(picks.get(3)).toBe(-1);
  });

  it("refuses an index that is outside the candidate list", async () => {
    const picks = await matchSceneVideos(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 4
    pick: 7
    reason: hallucinated index`,
      ),
    );
    // A pick that is not in the list is not a pick.
    expect(picks.get(4)).toBe(-1);
  });

  it("ignores a scene number the model invented", async () => {
    const picks = await matchSceneVideos(
      scenes,
      fakeProvider(
        () => `matches:
  - scene: 42
    pick: 0
    reason: invented
  - scene: 3
    pick: 0
    reason: the Ten Kings`,
      ),
    );
    expect(picks.has(42)).toBe(false);
    expect(picks.get(3)).toBe(0);
  });

  it("asks the provider nothing when no scene has a clip", async () => {
    let called = false;
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        called = true;
        return { content: "matches: []", usage: { input: 1, output: 1 } };
      },
    };
    const picks = await matchSceneVideos(
      [{ scene: 1, subject: "x", candidates: [] }],
      provider,
    );
    expect(called).toBe(false);
    expect(picks.size).toBe(0);
  });

  it("reports a provider failure as the provider's own error", async () => {
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("provider is down");
      },
    };
    await expect(matchSceneVideos(scenes, provider)).rejects.toThrow(
      "provider is down",
    );
  });

  it("reports an unreadable answer as the matcher's own error", async () => {
    const error = await matchSceneVideos(
      scenes,
      fakeProvider(() => "not yaml at all"),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(VideoSourceMatchError);
    const matchError = error as VideoSourceMatchError;
    expect(matchError.providerName).toBe("fake");
    expect(matchError.cause).toBeDefined();
  });
});
