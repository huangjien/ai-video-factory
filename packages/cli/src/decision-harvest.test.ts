import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { harvestProject, renderCandidateYaml } from "./decision-harvest.js";

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
        baseline: "ImageBackground",
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
  const REVIEW_YAML = `project: demo
language: en-US
threshold: 90
attempts_used: 1
passing: false
attempts:
  - attempt: 1
    overall: 71.2
    grade: C
    coverage: 100
    passing: false
    findings:
      - id: F-001
        code: CONTENT_GAP
        severity: Major
        description: The promotion path is compressed into three words.
    risk_flags:
      - code: MAJOR_REVISION_NEEDED
        severity: Major
`;

  async function projectWithLog(
    logRow: Record<string, unknown>,
  ): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article-review.yaml"), REVIEW_YAML, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "draft-bar",
        project: "demo",
        attempt: 1,
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: "a1b2c3d4e5f6a7b8",
        answer: String(logRow["answer"] ?? "reject"),
        confidence: 0.71,
        confidence_source: "native",
        verdict: { passing: false, major_revision_needed: true },
        label: "revise",
        agreed: false,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      }) + "\n",
      "utf8",
    );
    return dir;
  }

  it("reports no candidates when the project has no log", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    const { candidates, rows } = await harvestProject(dir, "demo");
    expect(candidates).toHaveLength(0);
    expect(rows).toBe(0);
  });

  it("turns a logged draft-bar consult into a candidate", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates, rows } = await harvestProject(dir, "demo");
    expect(rows).toBe(1);
    expect(candidates).toHaveLength(1);
  });

  it("derives the label from the review artifact, not the model", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates[0]?.expects.value).toBe("revise");
  });

  it("rebuilds the state from the review artifact", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates[0]?.state).toContain("A draft about demo");
    expect(candidates[0]?.state).toContain("F-001");
  });

  it("marks the candidate undisputed (the rule decides, no human needed)", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates[0]?.disputed).toBe(false);
  });

  it("records the model's disagreement in the policy note", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates[0]?.policy.note).toContain("DISAGREED");
  });

  it("skips a row whose attempt is missing from the review", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-"));
    await writeFile(path.join(dir, "article-review.yaml"), REVIEW_YAML, "utf8");
    await writeFile(
      path.join(dir, "decision-log.jsonl"),
      JSON.stringify({
        ts: "2026-11-14T00:00:00.000Z",
        surface: "draft-bar",
        project: "demo",
        attempt: 9,
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: "a1b2c3d4e5f6a7b8",
        answer: "reject",
        confidence: 0.71,
        confidence_source: "native",
        verdict: { passing: false },
        label: "revise",
        agreed: false,
        latency_ms: 300,
        usage: { input: 100, output: 0 },
        error: null,
      }) + "\n",
      "utf8",
    );
    const { candidates } = await harvestProject(dir, "demo");
    expect(candidates).toHaveLength(0);
  });

  it("renders a review queue with the derived label", async () => {
    const dir = await projectWithLog({ answer: "reject" });
    const { candidates } = await harvestProject(dir, "demo");
    const yaml = renderCandidateYaml(candidates);
    expect(yaml).toContain("value: revise");
    expect(yaml).toContain("review-verdict");
  });
});
