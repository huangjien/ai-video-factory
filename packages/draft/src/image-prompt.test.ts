import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import { expandScenePrompt } from "./image-prompt.js";

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
    expect(userMsg).toContain("DO NOT render the words");

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

  it("truncates provider output to 400 chars", async () => {
    const provider = fakeProvider(() => "y".repeat(600));
    const r = await expandScenePrompt({ ...SCENE, visual: "third visual" }, provider, dir, 3);
    expect(r.prompt.length).toBe(400);
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
    expect(r.prompt).toBe("recovered prompt");
  });
});
