import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  IMAGE_PROMPT_REVISION,
  buildScenePromptMessages,
  expandSceneBrief,
  expandScenePrompt,
} from "./image-prompt.js";
import { stylePromptSuffix, styleSystemBlock } from "./image-style.js";

function fakeProvider(
  respond: (req: ChatRequest) => string,
): Provider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    name: "fake",
    calls,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      calls.push(req);
      return {
        content: respond(req),
        usage: { input: 1, output: 1 },
      };
    },
  };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vf-img-prompt-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

const SCENE = {
  id: "scene_1",
  visual: "network of nodes",
  caption: "连接",
  narration: "一张逐渐展开的网络图",
};

describe("expandScenePrompt", () => {
  it("expands via the provider, writes the cache + auditable sidecar", async () => {
    const provider = fakeProvider(
      () =>
        "A vast network of glowing nodes on deep navy, soft rim lighting, centered composition, minimal tech style.",
    );
    const r = await expandScenePrompt(SCENE, provider, dir, 1);
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toContain("network of glowing nodes");
    expect(provider.calls).toHaveLength(1);

    const userMsg =
      provider.calls[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("Scene ID: scene_1");
    expect(userMsg).toContain("Caption (on-screen text): 连接");
    expect(userMsg).toContain("Visual direction: network of nodes");
    expect(userMsg).toContain("DO NOT render any of its words");

    const sidecar = await readFile(
      path.join(dir, "assets", "images", "scene_1.prompt.txt"),
      "utf8",
    );
    expect(sidecar).toBe(r.prompt);
  });

  it("second identical call is a cache hit with zero provider calls", async () => {
    const provider = fakeProvider(() => "should not be called");
    const r = await expandScenePrompt(SCENE, provider, dir, 1);
    expect(r.cacheHit).toBe(true);
    expect(r.prompt).toContain("network of glowing nodes");
    expect(provider.calls).toHaveLength(0);
  });

  it("a different visual is a cache miss (content-hash keying)", async () => {
    const provider = fakeProvider(
      () => "different prompt for a different visual",
    );
    const r = await expandScenePrompt(
      { ...SCENE, visual: "a formula" },
      provider,
      dir,
      2,
    );
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toContain("different visual");
  });

  it("truncates provider output to the brief budget, then appends the style suffix", async () => {
    const provider = fakeProvider(() => "y".repeat(2000));
    const r = await expandScenePrompt(
      { ...SCENE, visual: "third visual" },
      provider,
      dir,
      3,
    );
    // v0.10.3: the ceiling now covers the ASSEMBLED prompt, so the brief is
    // trimmed to whatever the suffix leaves over — a long style suffix must
    // not push the total past what the image API accepts.
    const suffix = stylePromptSuffix("flat-vector");
    expect(r.prompt).toBe("y".repeat(1500 - suffix.length - 1) + "\n" + suffix);
    expect(r.prompt.length).toBeLessThanOrEqual(1500);
  });

  it("strips reasoning scaffolding so the brief, not the thinking, is kept", async () => {
    const provider = fakeProvider(
      () =>
        "<think>The user wants a flat vector brief. Key elements: a document, " +
        "a folder, a person. Let me craft the paragraph now.</think>\n" +
        "A blank sheet of paper on a dark wooden desk, softly creased.",
    );
    const r = await expandScenePrompt(
      { ...SCENE, visual: "think-leak" },
      provider,
      dir,
      5,
    );
    expect(r.prompt).not.toContain("<think>");
    expect(r.prompt).not.toContain("Key elements");
    expect(r.prompt).toContain("blank sheet of paper on a dark wooden desk");
  });

  it("drops everything after an unterminated <think> (budget-truncated response)", async () => {
    const provider = fakeProvider(
      () => "<think>The user wants a brief about tokens and counting and",
    );
    const r = await expandScenePrompt(
      { ...SCENE, visual: "open-think" },
      provider,
      dir,
      6,
    );
    expect(r.prompt).not.toContain("tokens and counting");
    expect(r.prompt).toBe("\n" + stylePromptSuffix("flat-vector"));
  });

  it("unwraps a fenced answer and strips a leading label", async () => {
    const provider = fakeProvider(
      () => "Prompt: ```\nA wide establishing shot of a windswept plain.\n```",
    );
    const r = await expandScenePrompt(
      { ...SCENE, visual: "fenced" },
      provider,
      dir,
      7,
    );
    expect(r.prompt).toBe(
      "A wide establishing shot of a windswept plain.\n" +
        stylePromptSuffix("flat-vector"),
    );
  });

  it("frames the brief for a 16:9 still that carries lower-third captions", async () => {
    const provider = fakeProvider(() => "A quiet harbour at dawn.");
    await expandScenePrompt(
      { ...SCENE, visual: "frame-context" },
      provider,
      dir,
      8,
    );
    const user =
      provider.calls[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("16:9");
    expect(user).toContain("caption overlays in the lower third");
    expect(user).toContain("invent the concrete subject");
  });

  it("a corrupt cache entry is ignored and re-expanded", async () => {
    const scenesDir = path.join(dir, "assets", "images", ".prompt-cache");
    await mkdir(scenesDir, { recursive: true });
    const scene = { ...SCENE, visual: "corrupt-cache-visual" };
    const first = await expandScenePrompt(
      scene,
      fakeProvider(() => "good prompt"),
      dir,
      4,
    );
    expect(first.cacheHit).toBe(false);
    // Corrupt every cache entry so the next identical call must re-expand.
    const { readdir } = await import("node:fs/promises");
    for (const f of await readdir(scenesDir)) {
      await writeFile(path.join(scenesDir, f), "{not json", "utf8");
    }
    const r = await expandScenePrompt(
      scene,
      fakeProvider(() => "recovered prompt"),
      dir,
      4,
    );
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toBe(
      "recovered prompt" + "\n" + stylePromptSuffix("flat-vector"),
    );
  });
});

// ─── Era anchoring (v0.10) ───────────────────────────────────────────────────
//
// Observed on projects/玄武门 (2026-10-18): 19 generated briefs, none of which
// mentioned ethnicity or facial features; the 7 that named a dynasty were
// exactly those whose source `visual:` line happened to contain 唐代. A bare
// "armored courier" rendered in whatever armour the image model defaults to —
// Western medieval. Two causes: the expander was never told the era, and the
// prompt had no rule requiring era, appearance and period dress.

const TANG_SCENE = {
  id: "scene_11",
  visual: "边境烽烟骤起，军情急报入京",
  caption: "导火索：突厥进犯",
  narration: "史书记载，导火索是突厥进犯。李建成推荐齐王李元吉挂帅。",
};

describe("buildScenePromptMessages — setting block", () => {
  it("puts the declared setting BEFORE the visual direction", () => {
    // Order matters: `visual:` is a bare Chinese category hint that reads as
    // era-neutral, so the setting must land before the model decides what a
    // courier looks like.
    const msgs = buildScenePromptMessages(TANG_SCENE, {
      setting: "Tang-dynasty China, 626 CE",
    });
    const user = msgs[1]?.content ?? "";
    expect(user).toContain("Setting (the whole video is set here");
    expect(user).toContain("Tang-dynasty China, 626 CE");
    expect(user.indexOf("Setting (")).toBeLessThan(
      user.indexOf("Visual direction:"),
    );
  });

  it("omits the setting line entirely when none is declared", () => {
    const user = buildScenePromptMessages(TANG_SCENE)[1]?.content ?? "";
    expect(user).not.toContain("Setting (");
  });

  it("treats a whitespace-only setting as absent", () => {
    const user =
      buildScenePromptMessages(TANG_SCENE, { setting: "   " })[1]?.content ??
      "";
    expect(user).not.toContain("Setting (");
  });

  it("still carries caption, visual and narration", () => {
    const user =
      buildScenePromptMessages(TANG_SCENE, {
        setting: "Tang-dynasty China",
      })[1]?.content ?? "";
    expect(user).toContain("导火索：突厥进犯");
    expect(user).toContain(TANG_SCENE.visual);
    expect(user).toContain("史书记载");
  });

  it("keeps the style block and the lessons in the system turn", () => {
    const system =
      buildScenePromptMessages(TANG_SCENE, {
        learned: "- avoid fake signage",
      })[0]?.content ?? "";
    expect(system).toContain("avoid fake signage");
    expect(system).toContain("image-generation brief");
  });

  it("omits the lessons block when there are none", () => {
    const system = buildScenePromptMessages(TANG_SCENE)[0]?.content ?? "";
    expect(system).not.toContain("avoid fake signage");
  });
});

describe("setting participates in the brief cache identity", () => {
  it("a different setting is a cache miss, not a stale reuse", async () => {
    // The bug this prevents: a brief written for one era being served for
    // another because the cache key never saw the setting.
    const scene = { ...TANG_SCENE, visual: "setting-cache-scene" };
    const a = await expandScenePrompt(
      scene,
      fakeProvider(() => "tang brief"),
      dir,
      5,
      {
        setting: "Tang-dynasty China, 626 CE",
      },
    );
    const b = await expandScenePrompt(
      scene,
      fakeProvider(() => "song brief"),
      dir,
      5,
      {
        setting: "Song-dynasty China, 1100 CE",
      },
    );
    expect(a.cacheHit).toBe(false);
    expect(b.cacheHit).toBe(false);
    expect(b.prompt).toContain("song brief");
  });

  it("the same setting IS a cache hit", async () => {
    const scene = { ...TANG_SCENE, visual: "setting-cache-scene-2" };
    const opts = { setting: "Tang-dynasty China, 626 CE" };
    await expandScenePrompt(
      scene,
      fakeProvider(() => "brief"),
      dir,
      6,
      opts,
    );
    const again = await expandScenePrompt(
      scene,
      fakeProvider(() => "brief"),
      dir,
      6,
      opts,
    );
    expect(again.cacheHit).toBe(true);
  });

  it("revision is bumped so paragraph-era briefs are never reused", () => {
    // v3 = era anchoring, v4 = the six labelled output lines, v5 = the
    // assembled-prompt ceiling, v6 = the flat-vector contract merge,
    // v7 = the visual direction is now a vivid art-direction line, not a
    // thin category hint. Without each bump, briefs cached by the previous
    // expander wording outlive the change.
    expect(IMAGE_PROMPT_REVISION).toBe("7");
  });
});

describe("the expander prompt itself demands era, appearance and dress", () => {
  const system = buildScenePromptMessages(TANG_SCENE)[0]?.content ?? "";

  it("requires all three anchors for a historical person", () => {
    expect(system).toContain("HISTORICAL AND CULTURAL SUBJECTS");
    expect(system).toContain("ERA + REGION");
    expect(system).toContain("APPEARANCE");
    expect(system).toContain("PERIOD DRESS");
  });

  it("names the default it has to beat: Western medieval", () => {
    expect(system).toMatch(/Western medieval/);
  });

  it("rules out the specific anachronisms", () => {
    for (const banned of ["plate armour", "chainmail", "cathedral"]) {
      expect(system).toContain(banned);
    }
  });

  it("says never to leave a historical person unanchored", () => {
    expect(system).toMatch(/Never leave a historical person unanchored/);
  });
});

// v0.10.2: the brief is six labelled lines, not a paragraph. The labels are
// part of the output the image model and the auditable .prompt.txt sidecar
// both consume.
describe("the expander prompt demands the six labelled lines", () => {
  const system = buildScenePromptMessages(TANG_SCENE)[0]?.content ?? "";

  it("names every label, in order", () => {
    const labels = [
      "1. Subject:",
      "2. Scene:",
      "3. Composition:",
      "4. Lighting:",
      "5. Style:",
      "6. Constraints:",
    ];
    for (const label of labels) {
      expect(system).toContain(label);
    }
    // Order matters: the labels define the output structure.
    const positions = labels.map((l) => system.indexOf(l));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("asks for subject size in frame and three depth layers", () => {
    expect(system).toMatch(/how much of the frame it occupies/);
    expect(system).toMatch(/foreground, middle ground, background/);
  });

  it("asks for materials and texture, not praise", () => {
    expect(system).toMatch(/name the material/);
    expect(system).toMatch(/rough ink edges, dry-brush texture/);
    expect(system).toContain('"Beautiful illustration" is not a style.');
  });

  it("carries the practical exclusions", () => {
    expect(system).toMatch(/no extra\s+people in the background/);
    expect(system).toMatch(/no cropped hands/);
    expect(system).toMatch(/face stays unobstructed/);
    expect(system).toMatch(/no modern buildings, vehicles or electrical/);
  });

  it("forbids the paragraph form it used to ask for", () => {
    expect(system).not.toContain("One paragraph");
    expect(system).toMatch(/Exactly six labelled lines/);
  });

  it("the worked example is itself six labelled lines", () => {
    const example = system.slice(system.indexOf("EXAMPLE"));
    for (const label of [
      "1. Subject:",
      "2. Scene:",
      "3. Composition:",
      "4. Lighting:",
      "5. Style:",
      "6. Constraints:",
    ]) {
      expect(example).toContain(label);
    }
  });
});

describe("prompt fits the provider ceiling", () => {
  // MiniMax rejects a prompt over 1500 chars; the old budget covered only
  // the brief, so a long style suffix silently dropped whole scenes.
  it("keeps brief + suffix within 1500 characters for a long-suffix style", async () => {
    const provider = {
      name: "test" as const,
      async chat() {
        return {
          content: "S".repeat(5000),
          providerName: "test",
          usage: { input: 0, output: 0 },
        };
      },
    };
    const { prompt } = await expandSceneBrief(
      { id: "scene_1", narration: "x", caption: "y", visual: "z" },
      provider,
      { style: "isometric" },
    );
    expect(prompt.length).toBeLessThanOrEqual(1500);
  });

  it("still carries the style suffix verbatim", async () => {
    const provider = {
      name: "test" as const,
      async chat() {
        return {
          content: "B".repeat(5000),
          providerName: "test",
          usage: { input: 0, output: 0 },
        };
      },
    };
    const { prompt } = await expandSceneBrief(
      { id: "scene_1", narration: "x", caption: "y", visual: "z" },
      provider,
      { style: "isometric" },
    );
    expect(prompt).toContain("isometric illustration");
  });
});

// v0.10.4: the A/B verdict, pinned. Against the proposed alternative text,
// the shipped preset kept its decisive property — a LOCKED, named palette
// (3/3 scenes consistent vs 1/3 for an unlocked "coordinated 4-6 colours") —
// while adopting the alternative's three genuinely additive phrases. These
// assertions keep the merge from being silently reverted to either extreme.
describe("flat-vector style contract (post-merge)", () => {
  const suffix = stylePromptSuffix("flat-vector");

  it("keeps the locked, named four-colour palette", () => {
    expect(suffix).toContain(
      "limited 4-color palette of deep navy slate blue warm amber and off-white",
    );
    expect(suffix).toContain("dark ground");
  });

  it("carries the merged phrases from the alternative text", () => {
    expect(suffix).toContain("simple silhouettes");
    expect(suffix).toContain("no 3D rendering");
    expect(suffix).toContain("no glossy surfaces");
  });

  it("stays short enough to leave the brief room under the 1500 ceiling", () => {
    // The A/B loser was 752 chars and forced briefs down to 3 of 6 lines.
    // This merge must not drift that way: 350 leaves >1100 for the brief.
    expect(suffix.length).toBeLessThanOrEqual(350);
  });

  it("the system block allows one subtle flat shadow, not drop shadows", () => {
    const block = styleSystemBlock("flat-vector");
    expect(block).toContain("one subtle flat shadow");
    expect(block).toContain("never a soft gradient or a drop shadow");
  });
});
