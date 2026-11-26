import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  DecisionAnswer,
  DecisionProvider,
  DecisionRequest,
} from "@video/llm";
import { parseDecisionLog, type DecisionLogRow } from "./decision-log.js";
import {
  runDraftDecisionShadow,
  type DraftBarAttemptFacts,
} from "./draft-decision.js";

/** A provider that always answers with one option. */
function fakeProvider(answer: string | null = "revise"): DecisionProvider {
  return {
    name: "fake",
    lastError: null,
    available: () => true,
    decide: async (_req: DecisionRequest): Promise<DecisionAnswer | null> => {
      if (answer === null) return null;
      return {
        value: { kind: "choice", option: answer },
        confidence: 0.8,
        confidenceSource: "native",
        usage: { input: 50, output: 0 },
        latencyMs: 5,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
}

const attempt: DraftBarAttemptFacts = {
  attempt: 1,
  overall: 88,
  grade: "B",
  passing: false,
};

/** A row as the writer writes it — one JSON object per line. */
function row(project: string): DecisionLogRow {
  return {
    ts: "2026-11-26T00:00:00.000Z",
    surface: "draft-bar",
    project,
    attempt: 1,
    mode: "shadow",
    provider: "fake",
    model: "fake-1",
    state_sha256: "abc123",
    answer: "revise",
    confidence: 0.8,
    confidence_source: "native",
    verdict: { passing: false },
    label: "revise",
    agreed: true,
    latency_ms: 5,
    usage: { input: 50, output: 0 },
    error: null,
  };
}

function tempLogPath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "vf-decision-log-")),
    "decision-log.jsonl",
  );
}

describe("parseDecisionLog", () => {
  it("reads back exactly what the writer wrote", async () => {
    const logPath = tempLogPath();
    const result = await runDraftDecisionShadow({
      project: "玄武门",
      attempts: [attempt],
      mode: "shadow",
      provider: fakeProvider("revise"),
      logPath,
    });
    expect(result.consulted).toBe(1);

    const rows = parseDecisionLog(readFileSync(logPath, "utf8"));
    expect(rows).toHaveLength(1);
    const read = rows[0]!;
    expect(read.surface).toBe("draft-bar");
    expect(read.project).toBe("玄武门");
    expect(read.attempt).toBe(1);
    expect(read.provider).toBe("fake");
    expect(read.answer).toBe("revise");
    // The label is derived from the review's own verdict, so the row
    // agrees exactly when the decision picked that label.
    expect(read.label).toBe("revise");
    expect(read.agreed).toBe(true);
    expect(read.error).toBeNull();
  });

  it("keeps the rows in the order the log holds them", () => {
    const body = [row("first"), row("second"), row("third")]
      .map((r) => JSON.stringify(r))
      .join("\n")
      .concat("\n");
    expect(parseDecisionLog(body).map((r) => r.project)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("skips the truncated last line a killed run leaves behind", () => {
    const body = `${JSON.stringify(row("first"))}\n{"ts":"2026-11-26T00:00:0`;
    const rows = parseDecisionLog(body);
    expect(rows.map((r) => r.project)).toEqual(["first"]);
  });

  it("skips a broken line without losing the rows around it", () => {
    const body = [
      JSON.stringify(row("first")),
      "{not json at all",
      JSON.stringify(row("third")),
    ].join("\n");
    expect(parseDecisionLog(body).map((r) => r.project)).toEqual([
      "first",
      "third",
    ]);
  });

  it("ignores blank lines and CRLF endings", () => {
    const body = `\r\n${JSON.stringify(row("only"))}\r\n   \r\n\t\r\n`;
    const rows = parseDecisionLog(body);
    expect(rows.map((r) => r.project)).toEqual(["only"]);
  });

  it("reads nothing out of an empty log", () => {
    expect(parseDecisionLog("")).toEqual([]);
    expect(parseDecisionLog("\n\n")).toEqual([]);
  });

  it("keeps a row from another surface — the caller narrows by surface", () => {
    const foreign = {
      surface: "qa-triage",
      ts: "2026-11-26T00:00:00.000Z",
      note: "another surface",
    };
    const body = [JSON.stringify(row("draft-bar-row")), JSON.stringify(foreign)]
      .join("\n")
      .concat("\n");
    const rows = parseDecisionLog(body) as unknown as Array<{
      surface: string;
    }>;
    expect(rows.map((r) => r.surface)).toEqual(["draft-bar", "qa-triage"]);
  });

  it("returns what it parses — it does not validate the row shape", () => {
    const rows = parseDecisionLog("[1,2,3]\n") as unknown as unknown[];
    expect(rows).toEqual([[1, 2, 3]]);
  });
});
