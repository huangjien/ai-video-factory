import { describe, expect, it } from "vitest";
import {
  dedupe,
  filterFree,
  pickBest,
  resolutionAsFrame,
  resolveSceneSource,
  retrieveForScenes,
  searchAllSources,
  tokenSet,
} from "./retrieve.js";
import type {
  HistoricalCandidate,
  PictureSource,
  SceneSourcePlan,
} from "./types.js";

function candidate(
  over: Partial<HistoricalCandidate> = {},
): HistoricalCandidate {
  return {
    source: "commons",
    title: "Portrait of Li Shimin",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
    fileUrl: "https://example.com/portrait.jpg",
    localPath: null,
    author: "Anonymous",
    license: "PD",
    licenseUrl: "",
    width: 1000,
    height: 1200,
    digestKey: "https://example.com/portrait.jpg|PD",
    query: "li shimin portrait",
    owned: false,
    directEligible: true,
    ...over,
  };
}

function fakeSource(
  name: string,
  results: HistoricalCandidate[],
  opts: { fail?: boolean } = {},
): PictureSource {
  return {
    name: name as PictureSource["name"],
    offline: false,
    search: async () => {
      if (opts.fail === true) throw new Error("source is down");
      return results;
    },
  };
}

describe("tokenSet", () => {
  it("keeps latin words and CJK bigrams", () => {
    const tokens = tokenSet("Li Shimin 唐太宗画像");
    expect(tokens.has("li")).toBe(true);
    expect(tokens.has("shimin")).toBe(true);
    // A Chinese subject matches on bigrams — a whole word would not.
    expect(tokens.has("唐太")).toBe(true);
    expect(tokens.has("画像")).toBe(true);
  });
});

describe("filterFree", () => {
  it("keeps public-domain pictures and drops the rest", () => {
    const out = filterFree([
      candidate({ license: "PD" }),
      candidate({ license: "CC0", fileUrl: "b" }),
      candidate({ license: "CC BY 4.0", fileUrl: "c" }),
      candidate({ license: "", fileUrl: "d" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps the project's own pictures whatever their license", () => {
    const out = filterFree([
      candidate({ license: "OWNED", owned: true, fileUrl: "a" }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("dedupe", () => {
  it("keeps one copy of a picture two sources found", () => {
    const out = dedupe([
      candidate({ fileUrl: "https://x/a.jpg" }),
      candidate({ fileUrl: "https://x/a.jpg", source: "wikipedia" }),
      candidate({ fileUrl: "https://x/b.jpg" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.source).toBe("commons");
  });
});

describe("searchAllSources", () => {
  it("keeps going when one source fails", async () => {
    const out = await searchAllSources("q", {
      sources: [
        fakeSource("commons", [], { fail: true }),
        fakeSource("wikipedia", [candidate()]),
      ],
    });
    expect(out).toHaveLength(1);
  });
});

describe("pickBest", () => {
  it("prefers the picture whose title matches the query", () => {
    const best = pickBest(
      [
        candidate({
          title: "Battle at Xuanwu Gate",
          fileUrl: "https://x/battle.jpg",
        }),
        candidate({
          title: "Portrait of Li Shimin",
          fileUrl: "https://x/portrait.jpg",
        }),
      ],
      "Li Shimin portrait",
    );
    expect(best?.fileUrl).toBe("https://x/portrait.jpg");
  });

  it("returns null when there is nothing to pick", () => {
    expect(pickBest([], "q")).toBeNull();
  });
});

describe("resolveSceneSource", () => {
  it("turns a direct plan into a direct resolution with a digest", () => {
    const r = resolveSceneSource(3, "direct", [candidate()], "li shimin");
    expect(r.mode).toBe("direct");
    expect(r.candidate?.source).toBe("commons");
    expect(r.digest.startsWith("direct:")).toBe(true);
  });

  it("turns a reference plan into a reference resolution", () => {
    const r = resolveSceneSource(3, "reference", [candidate()], "li shimin");
    expect(r.mode).toBe("reference");
    expect(r.digest.startsWith("ref:")).toBe(true);
  });

  it("falls back to no picture when nothing was found", () => {
    const r = resolveSceneSource(3, "direct", [], "li shimin");
    expect(r.mode).toBe("none");
    expect(r.digest).toBe("");
  });

  it("demotes a direct plan to a reference when the picture may not be the frame", () => {
    // The film's own cast art can inform a generated frame, but putting
    // the cast sheet on screen would show the drawing, not the person.
    const r = resolveSceneSource(
      3,
      "direct",
      [candidate({ directEligible: false, owned: true, license: "OWNED" })],
      "li shimin",
    );
    expect(r.mode).toBe("reference");
    expect(r.digest.startsWith("ref:")).toBe(true);
  });

  it("gives the same picture the same digest, whatever scene uses it", () => {
    const a = resolveSceneSource(1, "direct", [candidate()], "q");
    const b = resolveSceneSource(2, "direct", [candidate()], "q");
    // The digest is the IDENTITY of the borrowed picture. The scene number
    // is a separate term of the image cache key, so two scenes may share
    // a picture — and must share its digest.
    expect(a.digest).toBe(b.digest);
    // A different picture is a different digest.
    const other = resolveSceneSource(
      1,
      "direct",
      [
        candidate({
          fileUrl: "https://x/other.jpg",
          digestKey: "https://x/other.jpg|PD",
        }),
      ],
      "q",
    );
    expect(other.digest).not.toBe(a.digest);
  });
});

describe("retrieveForScenes", () => {
  const plan: SceneSourcePlan[] = [
    {
      scene: 1,
      historical: true,
      subject: "Li Shimin",
      query: "li shimin portrait",
      mode: "direct",
      reason: "portrait",
    },
    {
      scene: 2,
      historical: false,
      subject: "",
      query: "",
      mode: "none",
      reason: "abstract",
    },
  ];

  it("widens the search when a narrow query finds nothing", async () => {
    // An archive ANDs its terms: the rich query finds nothing, the bare
    // subject finds plenty.
    const asked: string[] = [];
    const source: PictureSource = {
      name: "commons",
      offline: false,
      search: async (query) => {
        asked.push(query);
        return query === "Li Shimin" ? [candidate()] : [];
      },
    };
    const out = await retrieveForScenes(
      [
        {
          scene: 1,
          historical: true,
          subject: "Li Shimin",
          query: "Li Shimin Tang dynasty portrait painting",
          mode: "direct",
          reason: "",
        },
      ],
      { sources: [source] },
    );
    expect(asked[0]).toBe("Li Shimin Tang dynasty portrait painting");
    expect(asked).toContain("Li Shimin");
    expect(out.get(1)?.mode).toBe("direct");
  });

  it("does not let the project's own pictures end the search early", async () => {
    // The cast sheet answers every query, so it cannot be the signal that
    // a query was too narrow — only a real archive hit can end the ladder.
    const asked: string[] = [];
    const source: PictureSource = {
      name: "artifact",
      offline: true,
      search: async (query) => {
        asked.push(query);
        return [candidate({ owned: true, license: "OWNED", fileUrl: "" })];
      },
    };
    await retrieveForScenes(
      [
        {
          scene: 1,
          historical: true,
          subject: "Wei Zheng",
          query: "Wei Zheng portrait",
          mode: "direct",
          reason: "",
        },
      ],
      { sources: [source] },
    );
    expect(asked.length).toBeGreaterThan(1);
    expect(asked).toContain("Wei Zheng");
  });

  it("only spends a lookup on the historical scenes", async () => {
    const asked: string[] = [];
    const source: PictureSource = {
      name: "commons",
      offline: false,
      search: async (query) => {
        asked.push(query);
        return [candidate()];
      },
    };
    const out = await retrieveForScenes(plan, { sources: [source] });
    expect(asked).toEqual(["li shimin portrait"]);
    expect(out.get(1)?.mode).toBe("direct");
    expect(out.get(2)).toBeUndefined();
  });

  it("drops a picture whose license is not free", async () => {
    const source = fakeSource("commons", [candidate({ license: "CC BY 4.0" })]);
    const out = await retrieveForScenes(plan, { sources: [source] });
    expect(out.get(1)?.mode).toBe("none");
  });
});

describe("resolutionAsFrame", () => {
  // A reference the providers cannot take is a picture that never reaches
  // the screen. When the picture may BE the frame, it becomes the frame
  // instead of being dropped.

  it("turns a reference into a frame when the picture may be one", () => {
    const pic = candidate();
    const out = resolutionAsFrame({
      scene: 3,
      mode: "reference",
      candidate: pic,
      digest: "ref:abc",
      note: "reference picture",
    });
    expect(out.mode).toBe("direct");
    // The digest changes with the mode — the same picture as a reference
    // and as the frame are different scene inputs.
    expect(out.digest).toMatch(/^direct:/);
    expect(out.digest).not.toBe("ref:abc");
    expect(out.candidate).toBe(pic);
    expect(out.note).toContain("Portrait of Li Shimin");
  });

  it("leaves a picture that may not be the frame alone", () => {
    // A cast sheet must not become the frame: showing the drawing instead
    // of the person is not what a portrait scene needs.
    const resolution = {
      scene: 3,
      mode: "reference" as const,
      candidate: candidate({ directEligible: false, owned: true }),
      digest: "ref:abc",
      note: "reference picture",
    };
    expect(resolutionAsFrame(resolution)).toBe(resolution);
  });

  it("leaves a scene without a picture alone", () => {
    const resolution = {
      scene: 3,
      mode: "none" as const,
      candidate: null,
      digest: "",
      note: "no freely-licensed picture found",
    };
    expect(resolutionAsFrame(resolution)).toBe(resolution);
  });
});
