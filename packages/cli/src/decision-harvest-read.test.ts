import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";

import {
  harvestProject,
  readReviewAttempts,
  registerDecisionBackfill,
  registerDecisionHarvest,
} from "./decision-harvest.js";

const REVIEW_YAML = `project: demo
language: en-US
threshold: 90
attempts_used: 2
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
  - attempt: 2
    overall: 88.4
    grade: B
    coverage: 100
    passing: false
    findings: []
    risk_flags: []
`;

async function projectWith(review: string | null): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "harvest-read-"));
  if (review !== null) {
    await writeFile(path.join(dir, "article-review.yaml"), review, "utf8");
  }
  return dir;
}

describe("readReviewAttempts", () => {
  it("reads every attempt the draft loop recorded", async () => {
    const dir = await projectWith(REVIEW_YAML);
    const attempts = await readReviewAttempts(dir);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.attempt).toBe(1);
    expect(attempts[0]?.overall).toBe(71.2);
    expect(attempts[0]?.grade).toBe("C");
    expect(attempts[0]?.passing).toBe(false);
    expect(attempts[1]?.attempt).toBe(2);
    expect(attempts[1]?.overall).toBe(88.4);
  });

  it("returns nothing when the project has no review artifact", async () => {
    const dir = await projectWith(null);
    expect(await readReviewAttempts(dir)).toEqual([]);
  });

  it("returns nothing when the review artifact is unreadable", async () => {
    const dir = await projectWith("this: is: not: yaml: at all");
    expect(await readReviewAttempts(dir)).toEqual([]);
  });

  it("numbers an attempt that carries no number of its own", async () => {
    const dir = await projectWith(
      "attempts:\n  - overall: 90\n  - overall: 91\n",
    );
    const attempts = await readReviewAttempts(dir);
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
  });

  it("reads the same attempts the harvest reads", async () => {
    const dir = await projectWith(REVIEW_YAML);
    const attempts = await readReviewAttempts(dir);
    const { candidates } = await harvestProject(dir, "demo");
    // The harvest derives its labels from these facts, so the two must
    // not drift apart.
    expect(candidates).toHaveLength(0);
    expect(attempts).toHaveLength(2);
  });
});

describe("the decision verbs", () => {
  it("registers harvest and backfill with their flags", () => {
    const program = new Command();
    const decision = program.command("decision");
    registerDecisionHarvest(decision);
    registerDecisionBackfill(decision);
    const harvest = decision.commands.find((c) => c.name() === "harvest");
    const backfill = decision.commands.find((c) => c.name() === "backfill");
    expect(harvest).toBeDefined();
    expect(backfill).toBeDefined();
    expect((harvest?.options ?? []).map((o) => o.long)).toContain("--out");
    expect((backfill?.options ?? []).map((o) => o.long)).toContain("--max");
  });

  it("writes the candidates into the project when the verb runs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-cmd-"));
    const project = path.join(dir, "projects", "demo");
    await mkdir(project, { recursive: true });
    // A project root is recognised by its state file.
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\n",
      "utf8",
    );
    await writeFile(
      path.join(project, "article-review.yaml"),
      REVIEW_YAML,
      "utf8",
    );
    await writeFile(
      path.join(project, "decision-log.jsonl"),
      JSON.stringify({
        ts: "2026-11-26T00:00:00.000Z",
        surface: "draft-bar",
        project: "demo",
        attempt: 1,
        mode: "shadow",
        provider: "openai",
        model: "gpt-6-luna",
        state_sha256: "a1b2c3d4e5f6a7b8",
        answer: "reject",
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
    const program = new Command();
    const decision = program.command("decision");
    registerDecisionHarvest(decision);
    await program.parseAsync(["decision", "harvest", "demo", "--cwd", dir], {
      from: "user",
    });
    // The logged consult becomes a review queue entry on disk.
    const written = await readFile(
      path.join(project, "decision-candidates.yaml"),
      "utf8",
    );
    expect(written).toContain("cases:");
    expect(written).toContain("expects:");
  });

  it("says there is no review artifact instead of consulting anything", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harvest-cmd-"));
    const project = path.join(dir, "projects", "demo");
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(project, "state.yaml"),
      "status: DRAFT\n",
      "utf8",
    );
    const program = new Command();
    const decision = program.command("decision");
    registerDecisionBackfill(decision);
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await program.parseAsync(["decision", "backfill", "demo", "--cwd", dir], {
        from: "user",
      });
    } finally {
      console.log = origLog;
    }
    expect(lines.join("\n")).toContain("no article-review.yaml");
  });
});
