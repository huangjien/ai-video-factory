import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { harvestProject, renderCandidateYaml } from "./decision-harvest.js";
import { sha256 } from "@video/draft";

const ARTICLE = `---
project: demo
language: en-US
duration_target_sec: 60
voice: en-US-AvaMultilingualNeural
---

# Demo

> **Hook** (≤20s): a hook.

## 1. Body

Body text.

## Scenes

\`\`\`yaml
scenes:
  - id: scene_01
    duration: 5
    caption: A caption
    visual: 少年立在崖边望向远方
    narration: |
      narration text
\`\`\`
`;

describe("renderCandidateYaml", () => {
  it("renders an empty document when there is nothing to review", () => {
    expect(renderCandidateYaml([])).toBe("{}\n");
  });

  it("renders the cases under a `cases` key", () => {
    const yaml = renderCandidateYaml([
      {
        id: "demo-scene-01",
        surface: "visual-class",
        state: "少年立在崖边望向远方",
        expects: { kind: "choice", value: "Checklist" },
        baseline: "AnimatedIllustration",
        disputed: true,
        dispute: "proposed by a model",
        policy: { rule: "structure-over-photo", note: "confirm the rule" },
        provenance: { source: "projects/demo/article.md scene_01" },
      },
    ]);
    expect(yaml).toContain("cases:");
    expect(yaml).toContain("Checklist");
  });
});

describe("harvestProject", () => {
  it("reports no candidates when the project has no log", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    const { candidates, rows } = await harvestProject(dir, "demo");
    expect(candidates).toHaveLength(0);
    expect(rows).toBe(0);
  });

  it("turns a logged disagreement into a candidate", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article.md"), ARTICLE, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "visual-class",
        scene_id: "scene_01",
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: sha256("少年立在崖边望向远方"),
        answer: "Checklist",
        confidence: 0.71,
        confidence_source: "native",
        baseline: "AnimatedIllustration",
        agreed: false,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      })}\n`,
      "utf8",
    );
    const { candidates, rows } = await harvestProject(dir, "demo");
    expect(rows).toBe(1);
    expect(candidates).toHaveLength(1);
  });

  it("recovers the state from the article, not the log", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article.md"), ARTICLE, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "visual-class",
        scene_id: "scene_01",
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: sha256("少年立在崖边望向远方"),
        answer: "Checklist",
        confidence: 0.71,
        confidence_source: "native",
        baseline: "AnimatedIllustration",
        agreed: false,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      })}\n`,
      "utf8",
    );
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates[0]?.state).toBe("少年立在崖边望向远方");
  });

  it("keeps a logged agreement — a corpus needs both kinds of case", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article.md"), ARTICLE, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "visual-class",
        scene_id: "scene_01",
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: sha256("少年立在崖边望向远方"),
        answer: "AnimatedIllustration",
        confidence: 0.99,
        confidence_source: "native",
        baseline: "AnimatedIllustration",
        agreed: true,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      })}\n`,
      "utf8",
    );
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates).toHaveLength(1);
  });

  it("does not throw when the project has no article", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "decision-log.jsonl"), "{}\n", "utf8");
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates).toHaveLength(0);
  });

  it("renders a review queue whose labels are still proposals", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article.md"), ARTICLE, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "visual-class",
        scene_id: "scene_01",
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: sha256("少年立在崖边望向远方"),
        answer: "Checklist",
        confidence: 0.71,
        confidence_source: "native",
        baseline: "AnimatedIllustration",
        agreed: false,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      })}\n`,
      "utf8",
    );
    const { candidates } = await harvestProject(dir, "demo");
    const yaml = renderCandidateYaml(candidates);
    expect(yaml).toContain("disputed: true");
    expect(yaml).toContain("A human must rule");
  });
});
