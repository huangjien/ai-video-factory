import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LayaAnswer, LayaClient } from "./laya.js";
import {
  decisionsAgree,
  recordDecision,
  scoreWithin,
  validateAnswer,
  type RecordDecisionOptions,
} from "./laya-decide.js";
import { readLayaDecisions } from "./laya-shadow.js";

/** A stub client that answers with a fixed payload, or with nothing.
 *
 *  `LayaClient.decide` returns the PARSED answer shape (`value`), not the
 *  raw wire format — the wire→parsed translation happens inside the
 *  client, so a stub must produce what the client would have produced. */
function stubClient(answers: Record<string, LayaAnswer> | null): LayaClient {
  return {
    decide: async () =>
      answers === null
        ? null
        : {
            answers,
            latencyMs: 7,
            routingModel: "english",
          },
  } as unknown as LayaClient;
}

/** A parsed choice answer, as `decide` would return it. */
function choice(value: string, confidence = 0.9): LayaAnswer {
  return { type: "choice", value, confidence, routingModel: "english" };
}

/** A parsed score answer. */
function score(value: number, confidence = 0.9): LayaAnswer {
  return {
    type: "score",
    value: String(value),
    score: value,
    confidence,
    routingModel: "english",
  };
}

/** A parsed noul answer. */
function noul(value: boolean, confidence = 0.9): LayaAnswer {
  return {
    type: "noul",
    value: String(value),
    confidence,
    routingModel: "english",
  };
}

function sidecar(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "laya-decide-")),
    "rows.jsonl",
  );
}

const CHOICE_Q = {
  id: "component",
  type: "choice" as const,
  instructions: "pick one",
  criteria: ["Title", "FlowChart"],
};

describe("validateAnswer", () => {
  it("accepts a choice inside the criteria", () => {
    const a = validateAnswer(
      { type: "choice", value: "Title", confidence: 0.9, routingModel: "e" },
      CHOICE_Q,
    );
    expect(a?.value).toBe("Title");
  });

  it("rejects a choice OUTSIDE the criteria", () => {
    const a = validateAnswer(
      { type: "choice", value: "Nonsense", confidence: 0.9, routingModel: "e" },
      CHOICE_Q,
    );
    expect(a).toBeNull();
  });

  it("rejects a choice when criteria are empty and the value is unknown", () => {
    const a = validateAnswer(
      { type: "choice", value: "X", confidence: 0.9, routingModel: "e" },
      { id: "q", type: "choice", instructions: "i" },
    );
    // No criteria means "anything goes" — the sidecar's own options.
    expect(a?.value).toBe("X");
  });

  it("accepts a finite score and rejects a non-numeric one", () => {
    const q = { id: "s", type: "score" as const, instructions: "i" };
    expect(
      validateAnswer(
        {
          type: "score",
          value: "42",
          score: 42,
          confidence: 0.9,
          routingModel: "e",
        },
        q,
      )?.score,
    ).toBe(42);
    expect(
      validateAnswer(
        { type: "score", value: "abc", confidence: 0.9, routingModel: "e" },
        q,
      ),
    ).toBeNull();
  });

  it("accepts a noul boolean and rejects anything else", () => {
    const q = { id: "n", type: "noul" as const, instructions: "i" };
    expect(
      validateAnswer(
        { type: "noul", value: "true", confidence: 0.9, routingModel: "e" },
        q,
      )?.value,
    ).toBe("true");
    expect(
      validateAnswer(
        { type: "noul", value: "maybe", confidence: 0.9, routingModel: "e" },
        q,
      ),
    ).toBeNull();
  });

  it("rejects a missing answer or a missing value", () => {
    expect(validateAnswer(undefined, CHOICE_Q)).toBeNull();
    expect(
      validateAnswer(
        { type: "choice", confidence: 0.9, routingModel: "e" },
        CHOICE_Q,
      ),
    ).toBeNull();
  });
});

describe("decisionsAgree", () => {
  it("compares a choice against a string baseline", () => {
    const a = {
      type: "choice" as const,
      value: "Title",
      confidence: 1,
      routingModel: "e",
    };
    expect(decisionsAgree(a, "Title")).toBe(true);
    expect(decisionsAgree(a, "FlowChart")).toBe(false);
  });

  it("compares a score against a numeric baseline", () => {
    const a = {
      type: "score" as const,
      value: "90",
      score: 90,
      confidence: 1,
      routingModel: "e",
    };
    expect(decisionsAgree(a, 90)).toBe(true);
    expect(decisionsAgree(a, 80)).toBe(false);
  });

  it("compares a noul against a boolean baseline", () => {
    const t = {
      type: "noul" as const,
      value: "true",
      confidence: 1,
      routingModel: "e",
    };
    expect(decisionsAgree(t, true)).toBe(true);
    expect(decisionsAgree(t, false)).toBe(false);
  });

  it("never agrees when there is no baseline", () => {
    const a = {
      type: "choice" as const,
      value: "Title",
      confidence: 1,
      routingModel: "e",
    };
    expect(decisionsAgree(a, null)).toBe(false);
  });
});

describe("scoreWithin", () => {
  it("agrees within the tolerance and disagrees outside it", () => {
    const a = {
      type: "score" as const,
      value: "88",
      score: 88,
      confidence: 1,
      routingModel: "e",
    };
    expect(scoreWithin(a, 90, 5)).toBe(true);
    expect(scoreWithin(a, 90, 1)).toBe(false);
  });

  it("disagrees on a non-numeric value", () => {
    const a = {
      type: "score" as const,
      value: "abc",
      confidence: 1,
      routingModel: "e",
    };
    expect(scoreWithin(a, 90, 100)).toBe(false);
  });
});

describe("recordDecision", () => {
  it("does nothing in off mode — no call, no row", async () => {
    const file = sidecar();
    let called = 0;
    const client = {
      decide: async () => {
        called += 1;
        return null;
      },
    } as unknown as LayaClient;
    const r = await recordDecision(client, {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "off",
      sidecarPath: file,
    });
    expect(called).toBe(0);
    expect(r.answer).toBeNull();
    expect(await readLayaDecisions(file)).toHaveLength(0);
  });

  it("returns the answer and the parsed choice", async () => {
    const r = await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: sidecar(),
    });
    expect(r.choice).toBe("Title");
    expect(r.asked).toBe(1);
  });

  it("parses a score answer", async () => {
    const r = await recordDecision(stubClient({ s: score(88) }), {
      surface: "test",
      state: "s",
      question: { id: "s", type: "score", instructions: "i" },
      mode: "shadow",
      baseline: 90,
    });
    expect(r.score).toBe(88);
  });

  it("parses a noul answer", async () => {
    const r = await recordDecision(stubClient({ n: noul(true) }), {
      surface: "test",
      state: "s",
      question: { id: "n", type: "noul", instructions: "i" },
      mode: "shadow",
      baseline: true,
    });
    expect(r.noul).toBe(true);
  });

  it("SHADOW NEVER ACTS — onAnswer is not called", async () => {
    let acted = false;
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: sidecar(),
      onAnswer: () => {
        acted = true;
      },
    });
    expect(acted).toBe(false);
  });

  it("ON mode acts, and the row records acted=true", async () => {
    const file = sidecar();
    let acted = false;
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "on",
      baseline: "Title",
      sidecarPath: file,
      onAnswer: () => {
        acted = true;
      },
    });
    expect(acted).toBe(true);
    expect((await readLayaDecisions(file))[0]?.acted).toBe(true);
  });

  it("records the question's REAL instructions and criteria", async () => {
    const file = sidecar();
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: file,
    });
    const row = (await readLayaDecisions(file))[0]!;
    expect(row.questions["component"]?.instructions).toBe("pick one");
    expect(row.questions["component"]?.criteria).toEqual([
      "Title",
      "FlowChart",
    ]);
  });

  it("records expected + agreed in shadow mode", async () => {
    const file = sidecar();
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: file,
    });
    const row = (await readLayaDecisions(file))[0]!;
    expect(row.expected).toBe("Title");
    expect(row.agreed).toBe(true);
  });

  it("records disagreed=true when the answer differs from the baseline", async () => {
    const file = sidecar();
    await recordDecision(stubClient({ component: choice("FlowChart") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: file,
    });
    expect((await readLayaDecisions(file))[0]?.agreed).toBe(false);
  });

  it("records NO expected/agreed when there is no baseline", async () => {
    const file = sidecar();
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      sidecarPath: file,
    });
    const row = (await readLayaDecisions(file))[0]!;
    expect(row.expected).toBeUndefined();
    expect(row.agreed).toBeUndefined();
  });

  it("records an unusable answer as a row with null answers", async () => {
    // The calibration corpus needs to see "the sidecar answered, but the
    // answer was not usable" — that is a signal, not a missing row.
    const file = sidecar();
    const r = await recordDecision(
      stubClient({ component: choice("Nonsense") }),
      {
        surface: "test",
        state: "s",
        question: CHOICE_Q,
        mode: "shadow",
        baseline: "Title",
        sidecarPath: file,
      },
    );
    expect(r.answer).toBeNull();
    const rows = await readLayaDecisions(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answers).toBeNull();
  });

  it("NEVER THROWS when the client throws", async () => {
    const client = {
      decide: async () => {
        throw new Error("boom");
      },
    } as unknown as LayaClient;
    const r = await recordDecision(client, {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      sidecarPath: sidecar(),
    });
    expect(r.answer).toBeNull();
    expect(r.asked).toBe(0);
  });

  it("NEVER THROWS when the sidecar write fails", async () => {
    // A path in a directory that does not exist.
    const bad = path.join(sidecar(), "nested", "rows.jsonl");
    const r = await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "s",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: bad,
    });
    // The ANSWER still comes back — telemetry failure must not cost the
    // decision itself.
    expect(r.choice).toBe("Title");
  });

  it("never writes the raw state — only its hash", async () => {
    const file = sidecar();
    await recordDecision(stubClient({ component: choice("Title") }), {
      surface: "test",
      state: "SECRET-ARTICLE-CONTENT",
      question: CHOICE_Q,
      mode: "shadow",
      baseline: "Title",
      sidecarPath: file,
    });
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("SECRET-ARTICLE-CONTENT");
    expect(raw).toContain("sha256:");
  });
});
