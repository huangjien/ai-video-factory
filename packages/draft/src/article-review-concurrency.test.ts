import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, Provider } from "@video/llm";
import {
  PROFILE,
  createFactChecker,
  runScoredDraft,
} from "./article-review.js";
import type { ResearchNote, ReviseFinding } from "./revise.js";

/** The package's TS lib is ES2022, so `Promise.withResolvers` (ES2024)
 *  is unavailable and the executor form is the only way. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A call site that never completes a call on its own — the TEST decides
 *  when each one finishes, so concurrency is observed, not raced. */
class Gate<T> {
  readonly started: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly waiting: { key: string; call: Deferred<T> }[] = [];
  private startWaiters: { n: number; resolve: () => void }[] = [];

  enter(key: string): Promise<T> {
    this.started.push(key);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.startWaiters = this.startWaiters.filter((waiter) => {
      if (this.started.length < waiter.n) return true;
      waiter.resolve();
      return false;
    });
    const call = deferred<T>();
    this.waiting.push({ key, call });
    const settled = call.promise.finally(() => {
      this.inFlight -= 1;
    });
    return settled;
  }

  /** Resolves once `n` calls have started. */
  whenStarted(n: number): Promise<void> {
    if (this.started.length >= n) return Promise.resolve();
    // ES2022 lib — see deferred().
    return new Promise<void>((resolve) => {
      this.startWaiters.push({ n, resolve });
    });
  }

  /** Completes the oldest pending call, or the oldest one for `key`. */
  answer(value: T, key?: string): void {
    const call = this.take(key);
    call.resolve(value);
  }

  fail(reason: unknown, key?: string): void {
    this.take(key).reject(reason);
  }

  private take(key?: string): Deferred<T> {
    const index = this.waiting.findIndex(
      (w) => key === undefined || w.key === key,
    );
    const entry = this.waiting[index];
    if (entry === undefined) {
      throw new Error(
        `no pending call${key === undefined ? "" : ` for ${key}`}`,
      );
    }
    this.waiting.splice(index, 1);
    return entry.call;
  }
}

/** A judge or generator that answers only when the test says so. */
class GatedProvider implements Provider {
  readonly requests: ChatRequest[] = [];
  readonly gate = new Gate<ChatResponse>();
  constructor(readonly name: string) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    return this.gate.enter("chat");
  }
}

const INPUT = {
  topic: "demo",
  audience: "developers",
  language: "zh-CN" as const,
  duration: 60,
};

const ARTICLE = JSON.stringify({
  title: "t",
  hook: "h",
  sections: [{ heading: "s", body: "b" }],
  scenes: [
    {
      id: "scene_1",
      duration: 8,
      caption: "c",
      visual: "v",
      narration: "narration line",
    },
  ],
});

/** A minimum-valid scorecard with every indicator at `score`. */
function scorecard(score: 4 | 5 | 3): string {
  return JSON.stringify({
    dimension_scores: PROFILE.map((d) => ({
      id: d.id,
      indicators: d.indicators.map((i) => ({ id: i.id, score, reason: "ok" })),
    })),
    findings: [],
    risk_flags: [],
    limitations: [],
    summary: {
      strengths: [],
      main_weaknesses: [],
      conclusion: "",
      confidence: 0.5,
    },
    comment: "ok",
    suggestions: [],
  });
}

const USAGE = { input: 10, output: 20 };
const note = (claim: string): ResearchNote => ({
  claim,
  verdict: "supported",
  notes: `note for ${claim}`,
});

const fact = (quote: string, code = "FACT_UNVERIFIED"): ReviseFinding => ({
  id: `R-${quote}`,
  code,
  severity: "Major",
  quote,
  description: "d",
  recommendation: "r",
});

describe("createFactChecker — the claims of one judgment are researched together", () => {
  it("runs four at a time and never more", async () => {
    const research = new Gate<ResearchNote[]>();
    const checker = createFactChecker(async (claims) =>
      research.enter(claims[0] ?? ""),
    );
    const run = checker.notesFor(["a", "b", "c", "d", "e"].map((q) => fact(q)));
    await research.whenStarted(4);
    expect(research.maxInFlight).toBe(4);
    research.answer([note("a")]);
    await research.whenStarted(5);
    expect(research.maxInFlight).toBe(4);
    for (const key of ["b", "c", "d", "e"]) research.answer([note(key)]);
    expect((await run)?.map((n) => n.claim)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns the notes in CLAIM order however the calls finished", async () => {
    const research = new Gate<ResearchNote[]>();
    const checker = createFactChecker(async (claims) =>
      research.enter(claims[0] ?? ""),
    );
    // Duplicates and blank quotes collapse into one claim each.
    const run = checker.notesFor([
      fact(" a "),
      fact("a"),
      fact(" b "),
      fact("   "),
      fact("c"),
    ]);
    await research.whenStarted(3);
    research.answer([note("c")], "c");
    research.answer([note("b")], "b");
    research.answer([note("a")], "a");
    expect((await run)?.map((n) => n.claim)).toEqual(["a", "b", "c"]);
    expect(research.started).toEqual(["a", "b", "c"]);
  });

  it("researches a claim once, across calls", async () => {
    const research = new Gate<ResearchNote[]>();
    const checker = createFactChecker(async (claims) =>
      research.enter(claims[0] ?? ""),
    );
    const first = checker.notesFor([fact("a"), fact("b")]);
    await research.whenStarted(2);
    research.answer([note("a")]);
    research.answer([note("b")]);
    await first;
    const second = checker.notesFor([fact("b"), fact("a"), fact("c")]);
    await research.whenStarted(3);
    research.answer([note("c")]);
    expect((await second)?.map((n) => n.claim)).toEqual(["b", "a", "c"]);
    expect(research.started).toEqual(["a", "b", "c"]);
  });

  it("a failed check leaves no notes, never throws, and counts as unverified", async () => {
    const research = new Gate<ResearchNote[]>();
    const checker = createFactChecker(async (claims) =>
      research.enter(claims[0] ?? ""),
    );
    const run = checker.notesFor([fact("a"), fact("b")]);
    await research.whenStarted(2);
    research.fail(new Error("search is down"), "b");
    research.answer([note("a")]);
    expect((await run)?.map((n) => n.claim)).toEqual(["a"]);
    expect(checker.verifiedFor("b")).toEqual([]);
    expect(checker.verifiedFor("a")).toEqual([note("a")]);
  });

  it("does nothing for findings that are not fact claims, or when nothing verified", async () => {
    const research = new Gate<ResearchNote[]>();
    const checker = createFactChecker(async (claims) =>
      research.enter(claims[0] ?? ""),
    );
    expect(await checker.notesFor([fact("a", "LOGIC_GAP")])).toBeUndefined();
    expect(research.started).toEqual([]);
    const run = checker.notesFor([fact("a")]);
    await research.whenStarted(1);
    research.answer([]);
    expect(await run).toBeUndefined();
  });
});

describe("runScoredDraft — the side calls of one attempt", () => {
  it("judges the samples of one draft together", async () => {
    const judge = new GatedProvider("judge");
    const gen = new GatedProvider("gen");
    const run = runScoredDraft(INPUT, gen, null, {
      minScore: 70,
      judgeSamples: 2,
      judgeProvider: judge,
      seed: { markdown: ARTICLE, raw: JSON.parse(ARTICLE), findings: [] },
    });
    // Both judgments are in flight before either has answered.
    await judge.gate.whenStarted(2);
    expect(judge.gate.maxInFlight).toBe(2);
    judge.gate.answer({ content: scorecard(4), usage: USAGE });
    judge.gate.answer({ content: scorecard(4), usage: USAGE });
    const r = await run;
    expect(r.passing).toBe(true);
    expect(judge.gate.started).toHaveLength(2);
    // A passing seed generates nothing.
    expect(gen.gate.started).toEqual([]);
  });

  it("a judgment that breaks is dropped and the other sample still scores", async () => {
    const judge = new GatedProvider("judge");
    const gen = new GatedProvider("gen");
    const run = runScoredDraft(INPUT, gen, null, {
      minScore: 70,
      judgeSamples: 2,
      judgeProvider: judge,
      seed: { markdown: ARTICLE, raw: JSON.parse(ARTICLE), findings: [] },
    });
    await judge.gate.whenStarted(2);
    judge.gate.fail(new Error("judge returned prose, not JSON"));
    judge.gate.answer({ content: scorecard(4), usage: USAGE });
    const r = await run;
    expect(r.passing).toBe(true);
  });

  it("hands the reviser the fact-check notes in claim order", async () => {
    const judge = new GatedProvider("judge");
    const gen = new GatedProvider("gen");
    const research = new Gate<ResearchNote[]>();
    const run = runScoredDraft(INPUT, gen, null, {
      minScore: 70,
      maxAttempts: 2,
      judgeProvider: judge,
      research: async (claims) => research.enter(claims[0] ?? ""),
      seed: {
        markdown: ARTICLE,
        raw: JSON.parse(ARTICLE),
        findings: [fact("claim A"), fact("claim B"), fact("claim C")],
      },
    });
    // Round 1: the seed misses the bar, and its three claims are checked
    // at once.
    await judge.gate.whenStarted(1);
    judge.gate.answer({ content: scorecard(3), usage: USAGE });
    await research.whenStarted(3);
    expect(research.maxInFlight).toBe(3);
    // They finish in the order least likely to be the claim order —
    // each answer goes to ITS claim's call, the oldest first otherwise.
    research.answer([note("claim C")], "claim C");
    research.answer([note("claim A")], "claim A");
    research.answer([note("claim B")], "claim B");
    // Round 2: the reviser runs.
    await gen.gate.whenStarted(1);
    const prompt = gen.requests[0]!.messages.map((m) => m.content).join("\n");
    const a = prompt.indexOf("note for claim A");
    const b = prompt.indexOf("note for claim B");
    const c = prompt.indexOf("note for claim C");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    gen.gate.answer({ content: ARTICLE, usage: USAGE });
    await judge.gate.whenStarted(2);
    judge.gate.answer({ content: scorecard(3), usage: USAGE });
    const r = await run;
    expect(r.attempts.map((x) => x.mode)).toEqual(["seed", "revise"]);
    expect(research.started).toEqual(["claim A", "claim B", "claim C"]);
  });
});
