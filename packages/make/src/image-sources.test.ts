import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import type { ParsedArticle } from "@video/draft";
import type {
  HistoricalCandidate,
  PictureSource,
  SceneSourcePlan,
} from "@video/image-sources";

import {
  parseImageSourcesMode,
  resolveHistoricalSources,
  resolveImageSourcesMode,
} from "./image-sources.js";

function fakeProvider(respond: () => string): Provider {
  return {
    name: "fake",
    async chat(_req: ChatRequest): Promise<ChatResponse> {
      return { content: respond(), usage: { input: 1, output: 1 } };
    },
  };
}

/** A picture a source can hand back. */
function candidate(title: string): HistoricalCandidate {
  return {
    source: "commons",
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${title}`,
    fileUrl: `https://upload.wikimedia.org/${title}`,
    localPath: null,
    author: "A Painter",
    license: "PD",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    width: 640,
    height: 480,
    digestKey: `https://upload.wikimedia.org/${title}|PD`,
    query: "yama",
    owned: false,
    directEligible: true,
  };
}

/** A source that always answers with the same picture. */
function sourceWith(
  title: string,
  opts: { directEligible?: boolean } = {},
): PictureSource {
  return {
    name: "commons",
    offline: false,
    async search() {
      const found = candidate(title);
      return [
        opts.directEligible === undefined
          ? found
          : { ...found, directEligible: opts.directEligible },
      ];
    },
  };
}

function articleWith(scenes: { visual: string }[]): ParsedArticle {
  return {
    title: "谁被允许下阴间",
    frontmatter: { language: "zh-CN" },
    scenes: scenes.map((s, i) => ({
      id: `scene_${i + 1}`,
      visual: s.visual,
      caption: `caption ${i + 1}`,
      narration: `narration ${i + 1}`,
    })),
  } as unknown as ParsedArticle;
}

const plan: SceneSourcePlan[] = [
  {
    scene: 1,
    historical: true,
    subject: "阎罗王",
    query: "yama",
    mode: "direct",
    reason: "a historical subject",
  },
];

describe("resolveImageSourcesMode", () => {
  it("lets an explicit choice win", () => {
    expect(resolveImageSourcesMode("off", "on")).toBe("off");
    expect(resolveImageSourcesMode("on", "off")).toBe("on");
  });

  it("reads the frontmatter's spellings of off", () => {
    for (const raw of ["off", "OFF", " false ", "no", "0"]) {
      expect(resolveImageSourcesMode(undefined, raw)).toBe("off");
    }
  });

  it("treats anything else as on — a typo must not brick the run", () => {
    for (const raw of ["on", "true", "auto", undefined, "", "onn"]) {
      expect(resolveImageSourcesMode(undefined, raw)).toBe("on");
    }
  });
});

describe("parseImageSourcesMode", () => {
  it("accepts the off spellings", () => {
    for (const raw of ["off", "none", "false", "no", " OFF "]) {
      expect(parseImageSourcesMode(raw)).toBe("off");
    }
  });

  it("accepts the on spellings, including the older auto", () => {
    for (const raw of ["on", "auto", "true", "yes", " ON "]) {
      expect(parseImageSourcesMode(raw)).toBe("on");
    }
  });

  it("ignores an unknown value, so the frontmatter decides", () => {
    expect(parseImageSourcesMode("maybe")).toBeUndefined();
    expect(parseImageSourcesMode(undefined)).toBeUndefined();
  });
});

describe("resolveHistoricalSources", () => {
  async function projectRoot(): Promise<string> {
    return mkdtemp(path.join(tmpdir(), "vf-image-sources-"));
  }

  it("spends nothing when the feature is off", async () => {
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches: []"),
      mode: "off",
      plan,
    });
    expect(out.planned).toBe(false);
    expect(out.resolutions.size).toBe(0);
  });

  it("spends nothing without a provider and without a plan", async () => {
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: null,
      mode: "on",
    });
    expect(out.planned).toBe(false);
    expect(out.resolutions.size).toBe(0);
  });

  it("uses a pre-computed plan without asking the model", async () => {
    let asked = false;
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        asked = true;
        return { content: "matches: []", usage: { input: 1, output: 1 } };
      },
    };
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider,
      mode: "on",
      plan,
      sources: [sourceWith("Yama.jpg")],
    });
    // The plan was given, so the planner never ran — but the matcher did.
    expect(asked).toBe(true);
    expect(out.planned).toBe(true);
    expect(out.plan).toHaveLength(1);
    expect(out.resolutions.get(1)?.mode).toBe("direct");
  });

  it("reports a video with no historical scene", async () => {
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan: [{ ...plan[0]!, historical: false, mode: "none" }],
      sources: [sourceWith("Yama.jpg")],
    });
    expect(out.planned).toBe(true);
    expect(out.resolutions.size).toBe(0);
    expect(out.notes.join("\n")).toContain("no historical scene");
  });

  it("turns a reference into the frame when no provider can take one", async () => {
    const referencePlan: SceneSourcePlan[] = [
      { ...plan[0]!, mode: "reference" },
    ];
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan: referencePlan,
      sources: [sourceWith("Yama.jpg")],
      referenceCapable: false,
    });
    // The picture the model cannot be shown next to becomes the frame.
    expect(out.resolutions.get(1)?.mode).toBe("direct");
    expect(out.notes.join("\n")).toContain("becomes the frame");
  });

  it("drops a picture that may neither be shown nor become the frame", async () => {
    const referencePlan: SceneSourcePlan[] = [
      { ...plan[0]!, mode: "reference" },
    ];
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan: referencePlan,
      // A picture that may not BE the frame either.
      sources: [sourceWith("Yama.jpg", { directEligible: false })],
      referenceCapable: false,
    });
    // The picture cannot be a reference and may not become the frame, so
    // the scene drops it and says why.
    expect(out.resolutions.get(1)?.mode).toBe("none");
    expect(out.notes.join("\n")).toContain(
      "generating without the historical picture",
    );
  });

  it("keeps a reference when a provider can take one", async () => {
    const referencePlan: SceneSourcePlan[] = [
      { ...plan[0]!, mode: "reference" },
    ];
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches: []"),
      mode: "on",
      plan: referencePlan,
      sources: [sourceWith("Yama.jpg")],
      referenceCapable: true,
    });
    expect(out.resolutions.get(1)?.mode).toBe("reference");
  });

  it("falls back to the search order when the matcher fails", async () => {
    const provider: Provider = {
      name: "fake",
      async chat(_req: ChatRequest): Promise<ChatResponse> {
        throw new Error("matcher is down");
      },
    };
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider,
      mode: "on",
      plan,
      sources: [sourceWith("Yama.jpg")],
    });
    expect(out.notes.join("\n")).toContain("matching failed");
    // The picture still reaches the screen — the search order stands in.
    expect(out.resolutions.get(1)?.mode).toBe("direct");
  });

  it("gives a scene no picture when the matcher answers none", async () => {
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: -1\n"),
      mode: "on",
      plan,
      sources: [sourceWith("Yama.jpg")],
    });
    expect(out.resolutions.get(1)?.mode).toBe("none");
  });

  it("counts the historical scenes and the pictures it found", async () => {
    const out = await resolveHistoricalSources({
      projectRoot: await projectRoot(),
      article: articleWith([{ visual: "a gate" }]),
      workspaceRoot: null,
      provider: fakeProvider(() => "matches:\n  - scene: 1\n    pick: 0\n"),
      mode: "on",
      plan,
      sources: [sourceWith("Yama.jpg")],
    });
    expect(out.notes.join("\n")).toContain(
      "1 historical scene(s) planned, 1 with a freely-licensed picture",
    );
  });
});
