import { describe, expect, it } from "vitest";
// Importing every prompt-loader site executes its module-scope loadPrompt()
// calls, so @video/prompts' loader cache afterwards IS the registry's live
// coverage. Asserting cache == disk closes both orphan directions:
//   - a prompt file added but loaded by no package → on disk, not in cache;
//   - a prompt deleted while still referenced → the import throws (and a
//     name in the cache without a file is impossible by construction).
// This file lives in @video/cli because only the CLI sits above every
// consumer package (including ./retrospect-command.ts, which owns the one
// prompt loaded from inside the CLI itself).
import "@video/agent-storyboard";
import "@video/audio-plan";
import "@video/bilibili";
import "@video/draft";
import "@video/motion";
import "@video/qa";
import "@video/research";
import "@video/review";
import "@video/script";
import "@video/youtube";
import "./retrospect-command.js";
// The eval harness lives in the CLI too and loads `evals-judge` from the
// registry, so importing it keeps the coverage assertion below honest.
import "./prompt-evals.js";
import { listPromptFiles, loadedPromptNames } from "@video/prompts";

describe("prompt registry coverage", () => {
  it("every .md prompt file on disk is loaded by an import-time loader", () => {
    const disk = listPromptFiles().filter((f) => f.endsWith(".md")).sort();
    const loaded = loadedPromptNames().map((name) => `${name}.md`).sort();
    expect(loaded).toEqual(disk);
  });

  it("structured registry files are exactly the yaml/json loaders", () => {
    // Adding a new structured prompt file is a deliberate act: give it a
    // loader in @video/prompts and extend this expected set.
    const structured = listPromptFiles().filter((f) => !f.endsWith(".md"));
    expect(structured).toEqual(["image-styles.yaml", "music.json"]);
  });
});
