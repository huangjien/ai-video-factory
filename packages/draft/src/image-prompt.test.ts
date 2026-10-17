import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import { expandScenePrompt } from "./image-prompt.js";
import { stylePromptSuffix } from "./image-style.js";

function fakeProvider(respond: (req: ChatRequest) => string): Provider & { calls: ChatRequest[] } {
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
      () => "A vast network of glowing nodes on deep navy, soft rim lighting, centered composition, minimal tech style.",
    );
    const r = await expandScenePrompt(SCENE, provider, dir, 1);
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toContain("network of glowing nodes");
    expect(provider.calls).toHaveLength(1);

    const userMsg = provider.calls[0]?.messages.find((m) => m.role === "user")?.content ?? "";
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
    const provider = fakeProvider(() => "different prompt for a different visual");
    const r = await expandScenePrompt({ ...SCENE, visual: "a formula" }, provider, dir, 2);
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toContain("different visual");
  });

  it("truncates provider output to the brief budget, then appends the style suffix", async () => {
    const provider = fakeProvider(() => "y".repeat(2000));
    const r = await expandScenePrompt({ ...SCENE, visual: "third visual" }, provider, dir, 3);
    // v0.6: generated part ≤ budget + "\n" + flat-vector (default) suffix.
    expect(r.prompt).toBe(
      "y".repeat(700) + "\n" + stylePromptSuffix("flat-vector"),
    );
  });

  it("strips reasoning scaffolding so the brief, not the thinking, is kept", async () => {
    const provider = fakeProvider(
      () =>
        "<think>The user wants a flat vector brief. Key elements: a document, " +
        "a folder, a person. Let me craft the paragraph now.</think>\n" +
        "A blank sheet of paper on a dark wooden desk, softly creased.",
    );
    const r = await expandScenePrompt({ ...SCENE, visual: "think-leak" }, provider, dir, 5);
    expect(r.prompt).not.toContain("<think>");
    expect(r.prompt).not.toContain("Key elements");
    expect(r.prompt).toContain("blank sheet of paper on a dark wooden desk");
  });

  it("drops everything after an unterminated <think> (budget-truncated response)", async () => {
    const provider = fakeProvider(
      () => "<think>The user wants a brief about tokens and counting and",
    );
    const r = await expandScenePrompt({ ...SCENE, visual: "open-think" }, provider, dir, 6);
    expect(r.prompt).not.toContain("tokens and counting");
    expect(r.prompt).toBe("\n" + stylePromptSuffix("flat-vector"));
  });

  it("unwraps a fenced answer and strips a leading label", async () => {
    const provider = fakeProvider(
      () => "Prompt: ```\nA wide establishing shot of a windswept plain.\n```",
    );
    const r = await expandScenePrompt({ ...SCENE, visual: "fenced" }, provider, dir, 7);
    expect(r.prompt).toBe(
      "A wide establishing shot of a windswept plain.\n" +
        stylePromptSuffix("flat-vector"),
    );
  });

  it("frames the brief for a 16:9 still that carries lower-third captions", async () => {
    const provider = fakeProvider(() => "A quiet harbour at dawn.");
    await expandScenePrompt({ ...SCENE, visual: "frame-context" }, provider, dir, 8);
    const user = provider.calls[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("16:9");
    expect(user).toContain("caption overlays in the lower third");
    expect(user).toContain("invent the concrete subject");
  });

  it("a corrupt cache entry is ignored and re-expanded", async () => {
    const scenesDir = path.join(dir, "assets", "images", ".prompt-cache");
    await mkdir(scenesDir, { recursive: true });
    const scene = { ...SCENE, visual: "corrupt-cache-visual" };
    const first = await expandScenePrompt(scene, fakeProvider(() => "good prompt"), dir, 4);
    expect(first.cacheHit).toBe(false);
    // Corrupt every cache entry so the next identical call must re-expand.
    const { readdir } = await import("node:fs/promises");
    for (const f of await readdir(scenesDir)) {
      await writeFile(path.join(scenesDir, f), "{not json", "utf8");
    }
    const r = await expandScenePrompt(scene, fakeProvider(() => "recovered prompt"), dir, 4);
    expect(r.cacheHit).toBe(false);
    expect(r.prompt).toBe(
      "recovered prompt" + "\n" + stylePromptSuffix("flat-vector"),
    );
  });
});
