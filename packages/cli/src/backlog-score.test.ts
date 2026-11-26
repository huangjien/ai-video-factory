import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatRequest, ChatResponse } from "@video/llm";
import type * as LlmModule from "@video/llm";

// The provider classes are the network seam: both fakes delegate to one
// shared mock so tests can count every LLM call across runs. Everything
// else from @video/llm (chatWithFallback, extractFencedYaml,
// loadProviderConfig) stays REAL.
const { chatMock, makeFake } = vi.hoisted(() => {
  const chatMock = vi.fn();
  const makeFake = (name: string) =>
    class {
      readonly name = name;
      chat = (req: unknown) => chatMock(req);
    };
  return { chatMock, makeFake };
});

vi.mock("@video/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof LlmModule>();
  return {
    ...actual,
    GLMProvider: makeFake("glm"),
    MiniMaxProvider: makeFake("minimax"),
  };
});

import {
  evidenceExcerpt,
  parseJudgeRanking,
  runBacklogJudge,
  scoreBacklogEntry,
  sortForList,
} from "./backlog-score.js";
import {
  initBacklogStore,
  loadBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let repoRoot: string;
let consoleOutput: string[];
let consoleErrors: string[];
const origLog = console.log;
const origErr = console.error;
const origLlConfig = process.env["LL_CONFIG"];

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-score-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
  chatMock.mockReset();
  delete process.env["LL_CONFIG"];
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  if (origLlConfig !== undefined) process.env["LL_CONFIG"] = origLlConfig;
  rmSync(repoRoot, { recursive: true, force: true });
});

function seedEntry(partial: Partial<BacklogEntry>): BacklogEntry {
  const store = initBacklogStore(repoRoot);
  const entry: BacklogEntry = {
    id: partial.id ?? "2026-01-01-seeded",
    topic: partial.topic ?? "播种的点子",
    status: partial.status ?? "idea",
    source: partial.source ?? "manual",
    created: partial.created ?? "2026-01-01",
    ...partial,
  };
  store.ideas.push(entry);
  saveBacklogStore(repoRoot, store);
  return entry;
}

function entryWith(overrides: Partial<BacklogEntry>): BacklogEntry {
  return {
    id: "2026-11-18-entry",
    topic: "基础条目",
    status: "idea",
    source: "manual",
    created: "2026-11-18",
    ...overrides,
  };
}

const FRESH_COMPLETE = entryWith({
  note: "有机制摘要",
  anchors: ["板门店"],
  content: "长笔记正文",
});

function judgeYaml(
  rows: { id?: string; n?: number; rank: number; reason: string }[],
): string {
  const lines = ["ranking:"];
  for (const r of rows) {
    const key = r.n !== undefined ? `n: ${r.n}` : `id: ${r.id}`;
    lines.push(`  - ${key}`);
    lines.push(`    rank: ${r.rank}`);
    lines.push(`    reason: ${r.reason}`);
  }
  return "```yaml\n" + lines.join("\n") + "\n```";
}

function chatReplyOnce(reply: string): void {
  chatMock.mockImplementation(
    async (req: ChatRequest): Promise<ChatResponse> => {
      void req;
      return { content: reply, usage: { input: 10, output: 5 } };
    },
  );
}

/** The judge keeps ONE snapshot (runs/backlog-judge.yaml) — the legacy
 *  per-hash files are removed on sight. */
function cacheFiles(): string[] {
  const file = path.join(repoRoot, "runs", "backlog-judge.yaml");
  return existsSync(file) ? ["backlog-judge.yaml"] : [];
}

describe("scoreBacklogEntry — weights", () => {
  it("fresh+complete beats old+bare, and hits the documented extremes", () => {
    const freshComplete = scoreBacklogEntry(FRESH_COMPLETE, NOW);
    const oldBare = scoreBacklogEntry(
      entryWith({ created: "2024-01-01" }),
      NOW,
    );
    expect(freshComplete).toBe(100);
    expect(oldBare).toBe(30);
    expect(freshComplete).toBeGreaterThan(oldBare);
  });

  it("recency decays linearly over the ~90d window and clamps after it", () => {
    // entryWith's base carries no note/anchors/content — a bare entry.
    const at = (ageDays: number) =>
      scoreBacklogEntry(
        entryWith({ created: new Date(NOW - ageDays * DAY_MS).toISOString() }),
        NOW,
      );
    expect(at(0)).toBe(60);
    expect(at(45)).toBe(45);
    expect(at(90)).toBe(30);
    // linear: the drop over the first half equals the drop over the second
    expect(at(0) - at(45)).toBe(at(45) - at(90));
    // past the window recency is 0, not negative
    expect(at(100)).toBe(30);
  });

  it("completeness parts contribute additively", () => {
    const none = entryWith({});
    expect(scoreBacklogEntry(none, NOW)).toBe(60);
    expect(scoreBacklogEntry({ ...none, note: "n" }, NOW)).toBe(75);
    expect(scoreBacklogEntry({ ...none, anchors: ["a"] }, NOW)).toBe(70);
    expect(scoreBacklogEntry({ ...none, content: "c" }, NOW)).toBe(75);
    expect(
      scoreBacklogEntry(
        { ...none, note: "n", anchors: ["a"], content: "c" },
        NOW,
      ),
    ).toBe(100);
    // whitespace-only fields are not completeness
    expect(scoreBacklogEntry({ ...none, note: "   " }, NOW)).toBe(60);
  });

  it("readiness orders idea > drafting > proposed > drafted > dropped", () => {
    const score = (status: BacklogEntry["status"]) =>
      scoreBacklogEntry(entryWith({ status }), NOW);
    const idea = score("idea");
    const drafting = score("drafting");
    const proposed = score("proposed");
    const drafted = score("drafted");
    const dropped = score("dropped");
    expect(idea).toBeGreaterThan(drafting);
    expect(drafting).toBeGreaterThan(proposed);
    expect(proposed).toBeGreaterThan(drafted);
    expect(drafted).toBeGreaterThan(dropped);
  });

  it("an unreadable created date yields a finite score with no recency credit", () => {
    const s = scoreBacklogEntry(entryWith({ created: "not-a-date" }), NOW);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBe(30);
  });
});

describe("sortForList", () => {
  it("orders by score desc", () => {
    const old = entryWith({ id: "a-old", created: "2020-01-01" });
    const fresh = entryWith({ id: "b-fresh", created: "2026-11-18" });
    expect(sortForList([old, fresh], NOW).map((e) => e.id)).toEqual([
      "b-fresh",
      "a-old",
    ]);
  });

  it("breaks score ties by created desc", () => {
    const earlier = entryWith({ id: "a", created: "2026-11-10" });
    const later = entryWith({ id: "b", created: "2026-11-15" });
    const sorted = sortForList([earlier, later], NOW);
    expect(sorted.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("is stable when score and created are equal, and does not mutate the input", () => {
    const x = entryWith({ id: "x" });
    const y = entryWith({ id: "y" });
    const z = entryWith({ id: "z" });
    const input = [x, y, z];
    const sorted = sortForList(input, NOW);
    expect(sorted.map((e) => e.id)).toEqual(["x", "y", "z"]);
    expect(sorted).not.toBe(input);
    expect(input.map((e) => e.id)).toEqual(["x", "y", "z"]);
  });
});

describe("parseJudgeRanking", () => {
  it("accepts string ranks and returns rows sorted by rank", () => {
    const rows = parseJudgeRanking(
      judgeYaml([
        { id: "b", rank: 2, reason: "second" },
        { id: "a", rank: 1, reason: "first" },
      ]),
      ["a", "b"],
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("rejects unknown, duplicated, or missing ids and duplicated ranks", () => {
    expect(() =>
      parseJudgeRanking(judgeYaml([{ id: "zzz", rank: 1, reason: "r" }]), [
        "a",
      ]),
    ).toThrow(/neither a valid position n nor an exact open id/);
    expect(() =>
      parseJudgeRanking(
        judgeYaml([
          { id: "a", rank: 1, reason: "r" },
          { id: "a", rank: 2, reason: "r" },
        ]),
        ["a"],
      ),
    ).toThrow(/twice/);
    expect(() => parseJudgeRanking("```yaml\nranking: []\n```", ["a"])).toThrow(
      /missing ids/,
    );
    expect(() =>
      parseJudgeRanking(
        judgeYaml([
          { id: "a", rank: 1, reason: "r" },
          { id: "b", rank: 1, reason: "r" },
        ]),
        ["a", "b"],
      ),
    ).toThrow(/ranks must be unique/);
  });

  it("resolves position numbers to ids in expected order", () => {
    const rows = parseJudgeRanking(
      judgeYaml([
        { n: 2, rank: 1, reason: "first" },
        { n: 1, rank: 2, reason: "second" },
      ]),
      ["alpha", "beta"],
    );
    expect(rows.map((r) => r.id)).toEqual(["beta", "alpha"]);
  });

  it("reads reasons that carry prose instead of failing on the YAML", () => {
    // Both shapes the judge actually produced on 2026-11-25 — a reason
    // with ": " and a quoted phrase followed by bare text.
    const raw = [
      "```yaml",
      "ranking:",
      "  - n: 1",
      "    rank: 1",
      "    reason: 59 stale mp4s incident: dashboard-lies tension plus a fix",
      "  - n: 2",
      "    rank: 2",
      "    reason: 'We cannot even measure this' as a decisive answer; tight scope",
      "```",
    ].join("\n");
    const rows = parseJudgeRanking(raw, ["a", "b"]);
    expect(rows.map((r) => r.reason)).toEqual([
      "59 stale mp4s incident: dashboard-lies tension plus a fix",
      "'We cannot even measure this' as a decisive answer; tight scope",
    ]);
  });

  it("names what a duplication left out — a retry needs to hear both", () => {
    expect(() =>
      parseJudgeRanking(
        judgeYaml([
          { id: "a", rank: 1, reason: "r" },
          { id: "a", rank: 2, reason: "r" },
          { id: "c", rank: 3, reason: "r" },
        ]),
        ["a", "b", "c"],
      ),
    ).toThrow(/ranking lists "a" twice and missing ids: b/);
  });

  it("the judge reads the digest and the lane table, not the lists after them", () => {
    const report = [
      "# 频道分析 2026-11-25",
      "",
      "## 评委证据摘要",
      "",
      "- 平台分工：…",
      "",
      "## 1. 题材赛道 × 播放与参与",
      "",
      "| 平台 | 赛道 |",
      "|---|---|",
      "",
      "## 2. 长度 × 播放",
      "",
      "| 长度段 |",
      "",
      "## 3. 长度 × 参与度",
      "",
    ].join("\n");
    // Whole sections, cut between them — never a table half-way through.
    expect(evidenceExcerpt(report)).toBe(
      report.slice(0, report.indexOf("## 2. 长度 × 播放")),
    );
    // A report without that heading (the views-only format) is read to
    // the cap.
    expect(evidenceExcerpt("- x".repeat(5000))).toHaveLength(6000);
    // The supply table is section 2 when a backlog was given. It stays
    // out of the judge's evidence like every other list after the lanes:
    // how many ideas are waiting is not evidence about any one of them.
    const withSupply = [
      "# 频道分析 2026-11-25",
      "",
      "## 评委证据摘要",
      "",
      "- 平台分工：…",
      "",
      "## 1. 题材赛道 × 播放与参与",
      "",
      "| 军制与战争史 |",
      "",
      "## 2. 供给 vs 需求（backlog 待选选题 × 频道表现）",
      "",
      "| 神话比较 | 1 | 供给表的秘密行 |",
    ].join("\n");
    expect(evidenceExcerpt(withSupply)).toBe(
      withSupply.slice(0, withSupply.indexOf("## 2. 供给")),
    );
  });

  it("rejects out-of-range positions", () => {
    expect(() =>
      parseJudgeRanking(judgeYaml([{ n: 3, rank: 1, reason: "r" }]), [
        "a",
        "b",
      ]),
    ).toThrow(/not a position between 1 and 2/);
    expect(() =>
      parseJudgeRanking(judgeYaml([{ n: 0, rank: 1, reason: "r" }]), ["a"]),
    ).toThrow(/not a position between 1 and 1/);
  });
});

describe("runBacklogJudge — viewing-data evidence", () => {
  it("embeds the newest analytics report and its date in the prompt", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    mkdirSync(path.join(repoRoot, "docs", "analytics"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "docs", "analytics", "2026-11-11-report.md"),
      "# 频道分析 2026-11-11\n\n- 陆军班排连营 13.9 播放/天\n- AI幻觉评测 0.4 播放/天",
    );
    let userMessage = "";
    let systemMessage = "";
    chatMock.mockImplementation(
      async (req: ChatRequest): Promise<ChatResponse> => {
        systemMessage = req.messages[0]?.content ?? "";
        userMessage = req.messages[1]?.content ?? "";
        return {
          content: judgeYaml([{ n: 1, rank: 1, reason: "r" }]),
          usage: { input: 10, output: 5 },
        };
      },
    );
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(userMessage).toContain("REAL viewing data");
    expect(userMessage).toContain("analytics report 2026-11-11");
    expect(userMessage).toContain("陆军班排连营 13.9 播放/天");
    expect(consoleOutput.join("\n")).toMatch(
      /viewing-data evidence: analytics report 2026-11-11/,
    );
    // The report carries engagement and topic lanes now; the framing says
    // so, and the system prompt says how to read them.
    expect(userMessage).toContain("ENGAGEMENT");
    expect(userMessage).toContain("topic lanes");
    expect(systemMessage).toContain("engagement (likes, comments, coins,");
    expect(systemMessage).toContain("actually watched");
  });

  it("a NEW report date invalidates the cache → re-judge", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    mkdirSync(path.join(repoRoot, "docs", "analytics"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "docs", "analytics", "2026-11-04-report.md"),
      "# old\n",
    );
    chatReplyOnce(judgeYaml([{ n: 1, rank: 1, reason: "r" }]));
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(cacheFiles()).toHaveLength(1);

    writeFileSync(
      path.join(repoRoot, "docs", "analytics", "2026-11-11-report.md"),
      "# new\n",
    );
    chatReplyOnce(judgeYaml([{ n: 1, rank: 1, reason: "r" }]));
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(chatMock).toHaveBeenCalledTimes(2);
    // One snapshot — but the new report changed the fingerprint, so the
    // judge ran again and rewrote it.
    expect(cacheFiles()).toHaveLength(1);
  });

  it("a RICHER report under the same date invalidates the cache → re-judge", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    mkdirSync(path.join(repoRoot, "docs", "analytics"), { recursive: true });
    const report = path.join(
      repoRoot,
      "docs",
      "analytics",
      "2026-11-25-report.md",
    );
    // 2026-11-25: the day's first report held views only; running
    // `video analytics` again wrote one with engagement under the same name.
    writeFileSync(report, "# 频道分析 2026-11-25\n\nviews only\n");
    chatReplyOnce(judgeYaml([{ n: 1, rank: 1, reason: "r" }]));
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    writeFileSync(
      report,
      "# 频道分析 2026-11-25\n\n## 评委证据摘要\n\n- engagement\n",
    );
    chatReplyOnce(judgeYaml([{ n: 1, rank: 1, reason: "r" }]));
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("the retry is told what was wrong with the first reply", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    seedEntry({ id: "2026-11-02-beta", topic: "深海热泉", status: "idea" });
    const prompts: ChatRequest["messages"][] = [];
    chatMock.mockImplementation(
      async (req: ChatRequest): Promise<ChatResponse> => {
        prompts.push(req.messages);
        return {
          // First reply: the first entry twice, the second one left out.
          content:
            prompts.length === 1
              ? judgeYaml([
                  { n: 1, rank: 1, reason: "r" },
                  { n: 1, rank: 2, reason: "r" },
                ])
              : judgeYaml([
                  { n: 2, rank: 1, reason: "r" },
                  { n: 1, rank: 2, reason: "r" },
                ]),
          usage: { input: 10, output: 5 },
        };
      },
    );
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(prompts[0]!.map((turn) => turn.role)).toEqual(["system", "user"]);
    // The task again, the rejected reply, then the complaint about it.
    const retry = prompts[1]!;
    expect(retry.map((turn) => turn.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(retry[2]!.content).toContain("n: 1");
    expect(retry[3]!.content).toBe(
      'That reply was rejected: ranking lists "2026-11-01-alpha" twice and missing ids: 2026-11-02-beta. Answer again in the SAME yaml shape. List all 2 entries: every number n from 1 to 2 EXACTLY once, and each rank from 1 to 2 exactly once.',
    );
  });

  it("lists ALREADY PRODUCED stories and re-judges when the produced set grows", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    let userMessage = "";
    chatMock.mockImplementation(
      async (req: ChatRequest): Promise<ChatResponse> => {
        userMessage = req.messages[1]?.content ?? "";
        return {
          content: judgeYaml([{ n: 1, rank: 1, reason: "r" }]),
          usage: { input: 10, output: 5 },
        };
      },
    );
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(userMessage).not.toContain("ALREADY PRODUCED");

    const store = loadBacklogStore(repoRoot);
    store.ideas.push({
      id: "2026-11-02-produced",
      topic: "玄武门之变：一场改变唐朝走向的宫门伏杀",
      status: "drafted",
      project: "玄武门之变",
      source: "manual",
      created: "2026-11-02",
    });
    saveBacklogStore(repoRoot, store);
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(userMessage).toContain("ALREADY PRODUCED");
    expect(userMessage).toContain("玄武门之变：一场改变唐朝走向的宫门伏杀");
    // producing a video changes the produced set → cache re-judged
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("no report → ranks anyway and says evidence is missing", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    chatReplyOnce(judgeYaml([{ n: 1, rank: 1, reason: "r" }]));
    const code = await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/no analytics report/);
  });
});

describe("runBacklogJudge", () => {
  it("ranks open entries in one LLM call, prints reasons, writes the cache", async () => {
    const alpha = seedEntry({
      id: "2026-11-01-alpha",
      topic: "停电的城市",
      status: "idea",
    });
    const beta = seedEntry({
      id: "2026-11-02-beta",
      topic: "深海热泉",
      status: "proposed",
    });
    seedEntry({ id: "2026-11-03-closed", topic: "已画完", status: "drafted" });
    chatReplyOnce(
      judgeYaml([
        { id: beta.id, rank: 1, reason: "钩子更强" },
        { id: alpha.id, rank: 2, reason: "题材偏门" },
      ]),
    );

    const code = await runBacklogJudge({ model: "glm", cwd: repoRoot });

    expect(code).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(1);
    const out = consoleOutput.join("\n");
    const betaLine = out.indexOf("2026-11-02-beta");
    const alphaLine = out.indexOf("2026-11-01-alpha");
    expect(betaLine).toBeGreaterThan(-1);
    expect(alphaLine).toBeGreaterThan(betaLine);
    expect(out).toContain("钩子更强");
    expect(out).not.toContain("2026-11-03-closed");

    const caches = cacheFiles();
    expect(caches).toHaveLength(1);
    expect(caches[0]).toBe("backlog-judge.yaml");
    const cached = readFileSync(
      path.join(repoRoot, "runs", caches[0]!),
      "utf8",
    );
    expect(cached).toContain("schema: backlog-judge/2");
    expect(cached).toContain("fingerprint:");
    expect(cached).toContain("provider: glm");
    expect(cached).toContain("钩子更强");
  });

  it("second run with unchanged entries hits the cache and never calls the LLM again", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    chatReplyOnce(
      judgeYaml([{ id: "2026-11-01-alpha", rank: 1, reason: "唯一候选" }]),
    );
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(consoleOutput.join("\n")).toContain("judge cache hit");
  });

  it("changing an entry's topic changes the fingerprint → re-judge, same snapshot rewritten", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    chatReplyOnce(
      judgeYaml([{ id: "2026-11-01-alpha", rank: 1, reason: "先做" }]),
    );
    await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(cacheFiles()).toHaveLength(1);
    const first = readFileSync(
      path.join(repoRoot, "runs", "backlog-judge.yaml"),
      "utf8",
    );

    const store = loadBacklogStore(repoRoot);
    const alpha = store.ideas.find((e) => e.id === "2026-11-01-alpha");
    if (alpha === undefined) throw new Error("fixture entry vanished");
    alpha.topic = "城市大面积停电之谜";
    saveBacklogStore(repoRoot, store);
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);

    expect(chatMock).toHaveBeenCalledTimes(2);
    // One snapshot file, but a DIFFERENT fingerprint — that is what
    // invalidated the cache.
    expect(cacheFiles()).toHaveLength(1);
    const second = readFileSync(
      path.join(repoRoot, "runs", "backlog-judge.yaml"),
      "utf8",
    );
    expect(second).not.toBe(first);
  });

  it("--model override reaches the fallback seam and lands in the cache record", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    chatReplyOnce(
      judgeYaml([{ id: "2026-11-01-alpha", rank: 1, reason: "先做" }]),
    );
    expect(
      await runBacklogJudge({ model: "minimax", cwd: repoRoot, json: true }),
    ).toBe(0);
    const parsed = JSON.parse(consoleOutput[0] ?? "") as { provider: string };
    expect(parsed.provider).toBe("minimax");
  });

  it("unparseable reply → one retry, still bad → exit 1, raw dumped to <hash>-failed.yaml, no good cache", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    const raw = "抱歉，我无法以 yaml 排名这些条目。";
    chatReplyOnce(raw);

    const code = await runBacklogJudge({ model: "glm", cwd: repoRoot });

    expect(code).toBe(1);
    expect(chatMock).toHaveBeenCalledTimes(2);
    // The failure lands in the single snapshot as a failure record (no
    // ranking) — there is no separate "-failed" file any more.
    const caches = cacheFiles();
    expect(caches).toHaveLength(1);
    const recorded = readFileSync(
      path.join(repoRoot, "runs", caches[0]!),
      "utf8",
    );
    expect(recorded).toContain("failure:");
    expect(recorded).toContain("judge output unusable after retry");
    expect(recorded).toContain(raw);
    expect(recorded).not.toContain("ranking:");
    expect(consoleErrors.join("\n")).toContain(
      "judge output unusable after retry",
    );
  });

  it("a duplicate-row reply retries once and the fresh sample wins", async () => {
    seedEntry({ id: "2026-11-01-alpha", topic: "停电的城市", status: "idea" });
    chatMock
      .mockImplementationOnce(async (): Promise<ChatResponse> => ({
        content:
          "```yaml\nranking:\n  - id: 2026-11-01-alpha\n    rank: 1\n    reason: r\n  - id: 2026-11-01-alpha\n    rank: 2\n    reason: dup\n```",
        usage: { input: 10, output: 5 },
      }))
      .mockImplementationOnce(async (): Promise<ChatResponse> => ({
        content:
          "```yaml\nranking:\n  - n: 1\n    rank: 1\n    reason: fresh sample parses\n```",
        usage: { input: 10, output: 5 },
      }));
    const code = await runBacklogJudge({ model: "glm", cwd: repoRoot });
    expect(code).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(cacheFiles().some((f) => f.endsWith("-failed.yaml"))).toBe(false);
  });

  it("--json prints one parseable ranked object sorted by rank", async () => {
    const alpha = seedEntry({
      id: "2026-11-01-alpha",
      topic: "停电的城市",
      status: "idea",
    });
    const beta = seedEntry({
      id: "2026-11-02-beta",
      topic: "深海热泉",
      status: "proposed",
    });
    chatReplyOnce(
      judgeYaml([
        { id: alpha.id, rank: 2, reason: "次之" },
        { id: beta.id, rank: 1, reason: "最优" },
      ]),
    );
    expect(
      await runBacklogJudge({ model: "glm", cwd: repoRoot, json: true }),
    ).toBe(0);
    const parsed = JSON.parse(consoleOutput[0] ?? "") as {
      schema: string;
      ranking: { id: string; rank: number; reason: string }[];
    };
    expect(parsed.schema).toBe("backlog-judge/2");
    expect(parsed.ranking.map((r) => r.id)).toEqual([beta.id, alpha.id]);
    expect(parsed.ranking[0]!).toMatchObject({ rank: 1, reason: "最优" });
  });

  it("no backlog / no open entries → friendly exit 0, LLM untouched", async () => {
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(chatMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toContain("backlog is empty");

    seedEntry({ id: "2026-11-03-closed", topic: "已画完", status: "drafted" });
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);
    expect(chatMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toContain("no open entries to judge");
  });

  it("corrupt store fails loudly instead of judging", async () => {
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(
      path.join(repoRoot, "backlog.yaml"),
      "schema: wrong/9\nideas: []\n",
      "utf8",
    );
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(1);
    expect(chatMock).not.toHaveBeenCalled();
    expect(consoleErrors.join("\n")).toContain("unsupported schema");
  });

  it("prompt carries number/topic/capped note/anchors but never the full content or the id", async () => {
    const longNote = "甲".repeat(400);
    seedEntry({
      id: "2026-11-01-alpha",
      topic: "停电的城市",
      note: longNote,
      anchors: ["电网调度", "负荷曲线"],
      content: "SECRET-CONTENT-BODY 十万字的头脑风暴",
      status: "idea",
    });
    let userMessage = "";
    chatMock.mockImplementation(
      async (req: ChatRequest): Promise<ChatResponse> => {
        expect(req.messages).toHaveLength(2);
        expect(req.messages[0]?.role).toBe("system");
        userMessage = req.messages[1]?.content ?? "";
        return {
          content: judgeYaml([{ n: 1, rank: 1, reason: "r" }]),
          usage: { input: 10, output: 5 },
        };
      },
    );
    expect(await runBacklogJudge({ model: "glm", cwd: repoRoot })).toBe(0);

    // The model ranks by position number — ids never enter the prompt,
    // so nothing can be mistyped (the 2026-11-19 mangled-slug failure).
    expect(userMessage).toContain("n: 1");
    expect(userMessage).not.toContain("2026-11-01-alpha");
    expect(userMessage).toContain("topic: 停电的城市");
    expect(userMessage).toContain(`note: ${"甲".repeat(200)}`);
    expect(userMessage).not.toContain("甲".repeat(201));
    expect(userMessage).toContain("anchors: 电网调度, 负荷曲线");
    expect(userMessage).not.toContain("SECRET-CONTENT-BODY");
  });
});
