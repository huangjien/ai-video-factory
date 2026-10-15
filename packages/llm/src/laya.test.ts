import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtemp, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LayaClient,
  LAYA_DEFAULTS,
  resolveLayaConfig,
  type LayaConfig,
} from "./laya.js";
import {
  appendLayaDecision,
  readLayaDecisions,
  stateSha256,
  summarizeAgreement,
  type LayaDecisionRecord,
} from "./laya-shadow.js";

const cfg = (over: Partial<LayaConfig> = {}): LayaConfig => ({
  ...LAYA_DEFAULTS,
  mode: "on",
  ...over,
});

const healthBody = () => ({
  status: "ok",
  loaded: ["english", "multilingual", "typed-decisions"],
  revisions: { english: "r1" },
  device: "cpu",
});

const decisionBody = (
  answerConfidence: number,
  choice = "baseline_ok",
) => ({
  model: "laya-rl-agent",
  answers: {
    needs_llm: {
      type: "choice",
      choice,
      probabilities: { baseline_ok: answerConfidence, refine: 0.1 },
      confidence: 0.0075,
      answer_confidence: answerConfidence,
      action: { act_probability: 1.0 },
    },
  },
  usage: { input_tokens: 64, output_tokens: 0 },
  routing: {
    model: "english",
    reason: "English Latin text",
  },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("resolveLayaConfig", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to off / localhost / 0.6 / 3000", () => {
    delete process.env["LAYA_MODE"];
    delete process.env["LAYA_URL"];
    const c = resolveLayaConfig({ configPath: "/nonexistent.yaml" });
    expect(c).toEqual(LAYA_DEFAULTS);
  });

  it("env overrides each field; invalid values ignored", () => {
    process.env["LAYA_MODE"] = "shadow";
    process.env["LAYA_URL"] = "http://127.0.0.1:9999";
    process.env["LAYA_MIN_CONFIDENCE"] = "0.9";
    process.env["LAYA_TIMEOUT_MS"] = "5000";
    process.env["LAYA_BEARER"] = "tok";
    const c = resolveLayaConfig({ configPath: "/nonexistent.yaml" });
    expect(c.mode).toBe("shadow");
    expect(c.url).toBe("http://127.0.0.1:9999");
    expect(c.minConfidence).toBe(0.9);
    expect(c.timeoutMs).toBe(5000);
    expect(c.bearer).toBe("tok");

    process.env["LAYA_MIN_CONFIDENCE"] = "not-a-number";
    process.env["LAYA_TIMEOUT_MS"] = "-1";
    const bad = resolveLayaConfig({ configPath: "/nonexistent.yaml" });
    expect(bad.minConfidence).toBe(LAYA_DEFAULTS.minConfidence);
    expect(bad.timeoutMs).toBe(LAYA_DEFAULTS.timeoutMs);
  });
});

describe("LayaClient.decide", () => {
  const questions = {
    needs_llm: {
      type: "choice" as const,
      instructions: "baseline or refine?",
      criteria: ["baseline_ok", "refine"],
    },
  };

  it("returns null without any HTTP when mode is off", async () => {
    const fetchImpl = vi.fn();
    const client = new LayaClient({
      resolvedConfig: cfg({ mode: "off" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.decide("state", questions)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when health fails (never throws)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new LayaClient({
      resolvedConfig: cfg(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.decide("state", questions)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // health only, no systemone
  });

  it("happy path: pre-flight then decide, maps answer fields", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValueOnce(jsonResponse(decisionBody(0.83, "refine")));
    const client = new LayaClient({
      resolvedConfig: cfg(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const d = await client.decide("state text", questions);
    expect(d).not.toBeNull();
    expect(d!.answers["needs_llm"]!.value).toBe("refine");
    expect(d!.answers["needs_llm"]!.confidence).toBe(0.83);
    expect(d!.routingModel).toBe("english");
    const body = JSON.parse(
      (fetchImpl.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(body.questions.needs_llm.instructions).toBe("baseline or refine?");
    expect(body.state).toBe("state text");
  });

  it("drops answers below min_confidence", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValueOnce(jsonResponse(decisionBody(0.3)));
    const client = new LayaClient({
      resolvedConfig: cfg({ minConfidence: 0.6 }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const d = await client.decide("state", questions);
    expect(d).not.toBeNull();
    expect(d!.answers["needs_llm"]).toBeUndefined();
  });

  it("retries a 503 once, then gives up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValue(
        new Response("server busy", {
          status: 503,
          headers: { "Retry-After": "1" },
        }),
      );
    const client = new LayaClient({
      resolvedConfig: cfg({ timeoutMs: 500 }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const d = await client.decide("state", questions);
    expect(d).toBeNull();
    // health + 2 systemone attempts
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("unparseable JSON resolves to null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValue(
        new Response("<html>not json</html>", { status: 200 }),
      );
    const client = new LayaClient({
      resolvedConfig: cfg(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.decide("state", questions)).toBeNull();
  });

  it("memoizes health: one probe across many decides", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValue(jsonResponse(decisionBody(0.9)));
    const client = new LayaClient({
      resolvedConfig: cfg(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.decide("a", questions);
    await client.decide("b", questions);
    const healthCalls = fetchImpl.mock.calls.filter(
      (c) => String(c[0]).endsWith("/health"),
    ).length;
    expect(healthCalls).toBe(1);
  });

  it("shadow mode records raw low-confidence answers (calibration corpus)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthBody()))
      .mockResolvedValue(jsonResponse(decisionBody(0.3)));
    const client = new LayaClient({
      resolvedConfig: cfg({ mode: "shadow", minConfidence: 0.6 }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const d = await client.decide("state", questions);
    expect(d?.answers["needs_llm"]?.confidence).toBe(0.3);
  });
});

describe("laya sidecar", () => {
  it("stateSha256 is stable", () => {
    expect(stateSha256("abc")).toBe(stateSha256("abc"));
    expect(stateSha256("abc")).not.toBe(stateSha256("abd"));
  });

  it("append + read roundtrip; corrupt lines skipped", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "laya-test-"));
    const file = path.join(dir, "nested", "laya-decisions.jsonl");
    const rec: LayaDecisionRecord = {
      ts: "2026-10-14T00:00:00Z",
      surface: "motion",
      mode: "shadow",
      state_sha256: stateSha256("s"),
      questions: {},
      answers: null,
      routing_model: null,
      latency_ms: 12,
      acted: false,
      expected: "refine",
      agreed: true,
    };
    await appendLayaDecision(file, rec);
    await appendLayaDecision(file, { ...rec, agreed: false });
    await appendFile(file, '{"torn": ', "utf8");
    const rows = await readLayaDecisions(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.agreed).toBe(true);
    expect(rows[1]!.agreed).toBe(false);
    const raw = await readFile(file, "utf8");
    expect(raw.endsWith("\n")).toBe(false); // torn line left in place
  });

  it("readLayaDecisions on missing file returns []", async () => {
    expect(await readLayaDecisions("/nonexistent/x.jsonl")).toEqual([]);
  });

  it("summarizeAgreement filters by surface and shadow mode", () => {
    const base = (over: Partial<LayaDecisionRecord>): LayaDecisionRecord => ({
      ts: "t",
      surface: "motion",
      mode: "shadow",
      state_sha256: "h",
      questions: {},
      answers: {},
      routing_model: "english",
      latency_ms: 1,
      acted: false,
      ...over,
    });
    const rows = [
      base({ agreed: true }),
      base({ agreed: false }),
      base({ answers: null }),
      base({ surface: "triage", agreed: false }),
      base({ mode: "on", agreed: true }), // on rows never scored
    ];
    const s = summarizeAgreement(rows, "motion");
    expect(s.total).toBe(3);
    expect(s.answered).toBe(2);
    expect(s.agreementPct).toBe(50);
  });
});
