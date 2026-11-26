import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";

// Swap the real providers for a canned chat reply — the harvest must run
// with no network and no API key. extractFencedYaml/loadProviderConfig stay
// real so the parsing path under test is the production one.
const chatMock = vi.fn();
vi.mock("@video/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/llm")>();
  class FakeProvider {
    readonly name: string;
    constructor(name: string) {
      this.name = name;
    }
    chat(...a: unknown[]) {
      return chatMock(...a);
    }
  }
  return {
    ...actual,
    GLMProvider: FakeProvider,
    MiniMaxProvider: FakeProvider,
  };
});

import { addHarvestCommand, runBacklogHarvest } from "./backlog-harvest.js";
import {
  initBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
  type BacklogStore,
} from "./backlog-store.js";

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
let fixtureRoot: string | undefined;

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  chatMock.mockReset();
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});
function captureConsole() {
  console.log = (...a: unknown[]) => {
    consoleOutput.push(a.join(" "));
  };
  console.error = (...a: unknown[]) => {
    consoleErrors.push(a.join(" "));
  };
}

const LONG_DOC = (title: string) =>
  [
    `# ${title}`,
    "",
    "A long planning document with enough prose to pass the 200-character",
    "minimum gate for harvest candidates. ".repeat(6),
    "",
    "## Why this matters",
    "",
    "The mechanism behind ceasefire lines is that neither side can win",
    "outright, so supervision machinery freezes the front instead.",
  ].join("\n");

function reply(
  topics: { topic: string; note?: string; anchors?: string[]; why?: string }[],
): string {
  const body = topics
    .map((t) => {
      const lines = [`  - topic: ${t.topic}`];
      if (t.note !== undefined) lines.push(`    note: ${t.note}`);
      if (t.anchors !== undefined)
        lines.push(`    anchors: [${t.anchors.join(", ")}]`);
      if (t.why !== undefined) lines.push(`    why: ${t.why}`);
      return lines.join("\n");
    })
    .join("\n");
  return `\`\`\`yaml\ntopics:\n${body}\n\`\`\``;
}

function mkFixture() {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "video-harvest-"));
  writeFileSync(path.join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n");
  const docs = path.join(fixtureRoot, "docs", "plans");
  mkdirSync(docs, { recursive: true });
  writeFileSync(path.join(docs, "alpha.md"), LONG_DOC("Ceasefire Lines"));
  return fixtureRoot;
}

function loadStore(root: string): BacklogStore {
  return parseYaml(readFileSync(path.join(root, "backlog.yaml"), "utf8"));
}

describe("runBacklogHarvest — happy path", () => {
  it("appends proposed entries from a fixture doc and records one run", async () => {
    const root = mkFixture();
    chatMock.mockResolvedValue({
      content: reply([
        {
          topic: "为什么停火线能冻结几十年",
          note: "停火≠和平：监督机制冻结利益",
          anchors: ["板门店停战协定"],
          why: "机制反直觉，故事性强",
        },
        { topic: "The oddly stable DMZ ecosystem", why: "nature reclaims war" },
      ]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    const store = loadStore(root);
    expect(store.ideas).toHaveLength(2);
    expect(store.ideas[0]?.status).toBe("proposed");
    expect(store.ideas[0]?.source).toBe("harvest:docs/plans/alpha.md");
    expect(store.ideas[0]?.note).toContain("from docs/plans/alpha.md");
    expect(store.ideas[0]?.anchors).toEqual(["板门店停战协定"]);
    const runsDir = path.join(root, "runs");
    const runFiles = readdirSync(runsDir).filter((f) =>
      f.startsWith("backlog-harvest-"),
    );
    expect(runFiles).toHaveLength(1);
    const record = parseYaml(
      readFileSync(path.join(runsDir, runFiles[0] ?? ""), "utf8"),
    ) as { stage: string; status: string; tool: string; actor: string };
    expect(record.stage).toBe("backlog-harvest");
    expect(record.status).toBe("succeeded");
    expect(record.tool).toBe("video-backlog");
    expect(record.actor).toBe("agent");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("reads a note that carries prose instead of dropping the candidate", async () => {
    const root = mkFixture();
    chatMock.mockResolvedValue({
      content: reply([
        {
          topic: "为什么停火线能冻结几十年",
          note: "停火≠和平: 监督机制冻结利益",
        },
      ]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    const store = loadStore(root);
    expect(store.ideas).toHaveLength(1);
    expect(store.ideas[0]?.note).toContain("停火≠和平: 监督机制冻结利益");
  });

  it("dedups candidates whose topic slug already exists", async () => {
    const root = mkFixture();
    writeFileSync(
      path.join(root, "backlog.yaml"),
      'schema: backlog/1\nideas:\n  - id: 2026-01-01-existing\n    topic: 为什么停火线能冻结几十年\n    status: idea\n    source: manual\n    created: "2026-01-01"\n',
      "utf8",
    );
    chatMock.mockResolvedValue({
      content: reply([
        { topic: "为什么停火线能冻结几十年", why: "dup" },
        { topic: "为什么地图会撒谎", why: "fresh" },
      ]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    const store = loadStore(root);
    expect(store.ideas.map((e) => e.topic)).toEqual([
      "为什么停火线能冻结几十年",
      "为什么地图会撒谎",
    ]);
    expect(consoleOutput.join("\n")).toMatch(/1 deduped/);
  });

  it("flags covered candidates in the note instead of dropping them", async () => {
    const root = mkFixture();
    const proj = path.join(root, "projects", "panmunjom");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      path.join(proj, "article.md"),
      "# 板门店停战协定\n\n这篇成片已经讲过板门店停战协定的监督机制。\n",
      "utf8",
    );
    chatMock.mockResolvedValue({
      content: reply([
        {
          topic: "停战协定的监督机制",
          anchors: ["板门店停战协定"],
          why: "covered",
        },
        { topic: "全新的量子纠错故事", why: "fresh" },
      ]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    // The overlap candidate is PROPOSED with a warning, not discarded —
    // the human approve step owns that call.
    const store = loadStore(root);
    expect(store.ideas.map((e) => e.topic)).toEqual([
      "停战协定的监督机制",
      "全新的量子纠错故事",
    ]);
    const flagged = store.ideas.find((e) => e.topic === "停战协定的监督机制");
    expect(flagged?.note).toContain("possible overlap");
    expect(flagged?.note).toContain("panmunjom");
    expect(consoleOutput.join("\n")).toMatch(/possible overlap/);
  });

  it("skips index/README files — they describe docs, not topics", async () => {
    const root = mkFixture();
    writeFileSync(
      path.join(root, "docs", "plans", "index.md"),
      "# Plans\n\nA table of documents.\n",
    );
    chatMock.mockResolvedValue({
      content: reply([{ topic: "为什么地图会撒谎", why: "fresh" }]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    // Only the fixture doc got an LLM call — index.md never scanned.
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});

describe("runBacklogHarvest — dry run", () => {
  it("prints would-be additions and writes nothing at all", async () => {
    const root = mkFixture();
    chatMock.mockResolvedValue({
      content: reply([{ topic: "为什么地图会撒谎", why: "fresh" }]),
    });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root, dryRun: true });
    expect(code).toBe(0);
    expect(existsSync(path.join(root, "backlog.yaml"))).toBe(false);
    expect(existsSync(path.join(root, "runs"))).toBe(false);
    expect(consoleOutput.join("\n")).toMatch(/would add: 为什么地图会撒谎/);
  });
});

describe("runBacklogHarvest — failure handling", () => {
  it("dumps unparseable output and still processes the next doc", async () => {
    const root = mkFixture();
    const learnings = path.join(root, "learnings");
    mkdirSync(learnings, { recursive: true });
    writeFileSync(path.join(learnings, "beta.md"), LONG_DOC("Learning Notes"));
    chatMock
      .mockResolvedValueOnce({ content: "I refuse to produce yaml, sorry." })
      .mockResolvedValueOnce({
        content: reply([{ topic: "为什么地图会撒谎", why: "fresh" }]),
      });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(0);
    const runsDir = path.join(root, "runs");
    const dumps = readdirSync(runsDir).filter((f) =>
      f.startsWith("backlog-harvest-failed-"),
    );
    expect(dumps).toHaveLength(1);
    expect(readFileSync(path.join(runsDir, dumps[0] ?? ""), "utf8")).toContain(
      "I refuse to produce yaml",
    );
    const store = loadStore(root);
    expect(store.ideas.map((e) => e.topic)).toEqual(["为什么地图会撒谎"]);
    expect(store.ideas[0]?.source).toBe("harvest:learnings/beta.md");
    expect(consoleErrors.join("\n")).toMatch(/unparseable LLM output/);
  });

  it("exits 1 when every doc failed extraction", async () => {
    const root = mkFixture();
    chatMock.mockResolvedValue({ content: "no yaml here at all" });
    captureConsole();
    const code = await runBacklogHarvest({ cwd: root });
    expect(code).toBe(1);
    expect(existsSync(path.join(root, "backlog.yaml"))).toBe(false);
    expect(consoleErrors.join("\n")).toMatch(/every doc failed/);
    const record = parseYaml(
      readFileSync(
        path.join(
          root,
          "runs",
          readdirSync(path.join(root, "runs")).find(
            (f) => f.startsWith("backlog-harvest-2") && !f.includes("failed"),
          ) ?? "",
        ),
        "utf8",
      ),
    ) as { status: string };
    expect(record.status).toBe("failed");
  });
});

describe("addHarvestCommand", () => {
  it("registers the harvest subcommand with the default paths", () => {
    const backlog = new Command("backlog");
    addHarvestCommand(backlog);
    const harvest = backlog.commands.find((c) => c.name() === "harvest");
    expect(harvest).toBeDefined();
    const opts = harvest?.options.map((o) => o.long) ?? [];
    expect(opts).toContain("--dry-run");
    expect(opts).toContain("--paths");
    expect(opts).toContain("--model");
    const defaults = harvest?.opts() as { paths?: string } | undefined;
    expect(defaults?.paths).toBe("docs/plans,learnings");
  });
});

describe("runBacklogHarvest — the channel's evidence, and the demand pass", () => {
  /** A snapshot in which 神话比较 launched big yesterday and nothing else
   *  is in demand: three quiet old videos set the channel's medians, two
   *  mythology videos sit far above them. */
  const writeSnapshot = (root: string): string => {
    const dir = path.join(root, "docs", "analytics");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "2026-11-25-data.json");
    const row = (title: string, publishedAt: string, views: number) => ({
      platform: "bilibili",
      id: title,
      title,
      durationSec: 300,
      publishedAt,
      views,
      likes: 0,
      comments: 0,
    });
    writeFileSync(
      file,
      JSON.stringify({
        schema: "channel-analytics/1",
        generatedAt: "2026-11-25T12:00:00.000Z",
        notes: [],
        rows: [
          row("网文写作", "2026-11-10", 2),
          row("写好小说的本质", "2026-11-10", 2),
          row("编剧的悬念", "2026-11-10", 2),
          row("盘古、原人与伊米尔", "2026-11-24", 300),
          row("中印欧神话对比③", "2026-11-24", 50),
        ],
      }),
      "utf8",
    );
    return path.relative(root, file);
  };
  const seedIdea = (
    root: string,
    idea: Pick<BacklogEntry, "id" | "topic" | "status"> & Partial<BacklogEntry>,
  ): void => {
    const store = initBacklogStore(root);
    store.ideas.push({ source: "manual", created: "2026-11-01", ...idea });
    saveBacklogStore(root, store);
  };
  const promptOf = (call: number): string =>
    String(chatMock.mock.calls[call]?.[0].messages[1].content);
  const evidence = "Bilibili 新发布 2 部、最高 300 播放（频道中位 2）";
  const docReply = {
    content: reply([{ topic: "为什么停火线能冻结几十年", why: "机制反直觉" }]),
  };
  const runRecord = (root: string): Record<string, unknown> =>
    parseYaml(
      readFileSync(
        path.join(
          root,
          "runs",
          readdirSync(path.join(root, "runs")).find(
            (f) => f.startsWith("backlog-harvest-2") && !f.includes("failed"),
          ) ?? "",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
  const demandIdeas = (root: string): BacklogEntry[] =>
    loadStore(root).ideas.filter((e) => e.source.startsWith("demand:"));

  it("the document prompt carries the channel's evidence for ORDER and `why` — and never the supply table", async () => {
    const root = mkFixture();
    mkdirSync(path.join(root, "docs", "analytics"), { recursive: true });
    writeFileSync(
      path.join(root, "docs", "analytics", "2026-11-25-report.md"),
      [
        "# 频道分析 2026-11-25",
        "",
        "## 评委证据摘要",
        "",
        "- 平台分工：测试证据行",
        "",
        "## 1. 题材赛道 × 播放与参与",
        "",
        "| 平台 | 赛道 |",
        "|---|---|",
        "",
        "## 2. 供给 vs 需求（backlog 待选选题 × 频道表现）",
        "",
        "| 供给表的秘密行 |",
        "",
      ].join("\n"),
    );
    chatMock.mockResolvedValue(docReply);
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    // A report is not a snapshot: the demand pass has nothing to go on.
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(consoleOutput.join("\n")).toContain(
      "the demand pass needs `video analytics` first",
    );
    const prompt = promptOf(0);
    expect(prompt).toContain(
      "## The channel's own evidence — for ORDER and `why` only",
    );
    expect(prompt).toContain("The document still decides what is possible");
    expect(prompt).toContain("- 平台分工：测试证据行");
    expect(prompt).not.toContain("供给表的秘密行");
    expect(prompt.indexOf("The channel's own evidence")).toBeLessThan(
      prompt.indexOf("## Selection and ranking"),
    );
  });

  it("without a report the document prompt carries no evidence", async () => {
    const root = mkFixture();
    chatMock.mockResolvedValue(docReply);
    captureConsole();
    await runBacklogHarvest({ cwd: root });
    expect(promptOf(0)).not.toContain("channel's own evidence");
  });

  it("proposes topics for a lane the audience rewards and the backlog cannot feed", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    seedIdea(root, {
      id: "2026-11-01-published",
      topic: "盘古、原人与伊米尔：同一个创世母题",
      status: "drafted",
      project: "myth",
    });
    seedIdea(root, {
      id: "2026-11-02-open",
      topic: "神话里的王权：谁该统治",
      status: "idea",
    });
    chatMock.mockResolvedValueOnce(docReply).mockResolvedValueOnce({
      content: reply([
        {
          topic: "大洪水神话：为什么三个文明都讲同一场灾难",
          note: "比较 Noah、杜卡利翁与鲧禹治水",
          anchors: ["杜卡利翁"],
          why: "跨文明的同一个母题，对照感强",
        },
        {
          topic: "神话里的死者之路：三条冥界为何都有一条河",
          why: "冥界地理可以画成图",
        },
      ]),
    });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    // One call for the document, one for the lane.
    expect(chatMock).toHaveBeenCalledTimes(2);
    const prompt = promptOf(1);
    expect(prompt).toContain("**神话比较** — ");
    expect(prompt).toContain(`Propose up to 3 topics in that area`);
    expect(prompt).toContain(
      `## Why this area, in the channel's own numbers\n\n- ${evidence}`,
    );
    // The model is told what the channel already made and already holds.
    expect(prompt).toContain(
      "## Already published in this area (do not retell)\n\n- 盘古、原人与伊米尔：同一个创世母题",
    );
    expect(prompt).toContain(
      "## Already in the backlog in this area (do not duplicate)\n\n- 神话里的王权：谁该统治",
    );

    const demand = loadStore(root).ideas.filter(
      (e) => e.source === "demand:神话比较",
    );
    expect(demand.map((e) => e.topic)).toEqual([
      "大洪水神话：为什么三个文明都讲同一场灾难",
      "神话里的死者之路：三条冥界为何都有一条河",
    ]);
    expect(demand[0]).toMatchObject({
      status: "proposed",
      anchors: ["杜卡利翁"],
    });
    // The note says why it is compelling, then why it was asked for.
    expect(demand[0]?.note).toBe(
      `跨文明的同一个母题，对照感强 — 比较 Noah、杜卡利翁与鲧禹治水 [按需采集·神话比较；锚点待核实] ${evidence}`,
    );
    expect(consoleOutput.join("\n")).toContain(
      `demand 神话比较: 2 candidate(s), 2 added — ${evidence}`,
    );
    expect(runRecord(root)["input_files"]).toEqual([
      "docs/plans/alpha.md",
      "docs/analytics/2026-11-25-data.json",
    ]);
  });

  it("asks for at most three topics per lane", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    // Four distinct proposals: near-twins would be deduped for that
    // instead, and this test is about the cap.
    const topics = [
      "杜卡利翁的大洪水：希腊人如何讲同一场灾难",
      "鲧禹治水：中国的洪水神话为何讲治不讲逃",
      "吉尔伽美什与乌特纳皮什提：洪水幸存者的证词",
      "曼努与大鱼：印度创世神话里的第一次毁灭",
    ];
    chatMock.mockResolvedValueOnce(docReply).mockResolvedValueOnce({
      content: reply(topics.map((topic) => ({ topic, why: "w" }))),
    });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    expect(demandIdeas(root).map((e) => e.topic)).toEqual(topics.slice(0, 3));
  });

  it("a proposal that retells a published video is not a proposal", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    seedIdea(root, {
      id: "2026-11-01-published",
      topic: "盘古、原人与伊米尔：同一个创世母题",
      status: "drafted",
      project: "myth",
    });
    chatMock.mockResolvedValueOnce(docReply).mockResolvedValueOnce({
      content: reply([
        { topic: "盘古、原人与伊米尔：同一个创世母题", why: "the same story" },
        { topic: "神话里的死者之路：三条冥界为何都有一条河", why: "new" },
      ]),
    });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    expect(demandIdeas(root).map((e) => e.topic)).toEqual([
      "神话里的死者之路：三条冥界为何都有一条河",
    ]);
    // An exact retelling is caught by the slug check, which counts and
    // says nothing: the total is where it shows.
    expect(consoleOutput.join("\n")).toMatch(/1 deduped/);
  });

  it("a lane that is in demand but already stocked asks for nothing", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    for (const n of [1, 2, 3, 4]) {
      seedIdea(root, {
        id: `2026-11-0${n}-open`,
        topic: `神话选题 ${n}`,
        status: "idea",
      });
    }
    chatMock.mockResolvedValue(docReply);
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(consoleOutput.join("\n")).toContain(
      "no lane is both in demand and under-supplied — nothing to propose",
    );
  });

  it("--no-demand skips the pass even with a snapshot", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    chatMock.mockResolvedValue(docReply);
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root, demand: false })).toBe(0);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(consoleOutput.join("\n")).not.toMatch(/demand 神话比较/);
  });

  it("a dry run lists what the demand pass would add, and writes nothing", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    chatMock.mockResolvedValueOnce(docReply).mockResolvedValueOnce({
      content: reply([
        { topic: "神话里的死者之路：三条冥界为何都有一条河", why: "w" },
      ]),
    });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root, dryRun: true })).toBe(0);
    expect(existsSync(path.join(root, "backlog.yaml"))).toBe(false);
    expect(existsSync(path.join(root, "runs"))).toBe(false);
    expect(consoleOutput.join("\n")).toMatch(
      /would add: 神话里的死者之路：三条冥界为何都有一条河 \[[^\]]+\] \(demand:神话比较\)/,
    );
  });

  it("an unparseable demand reply is dumped and the harvest continues", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    chatMock
      .mockResolvedValueOnce(docReply)
      .mockResolvedValueOnce({ content: "no yaml for this lane" });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(0);
    const runsDir = path.join(root, "runs");
    const dumps = readdirSync(runsDir).filter((f) =>
      f.startsWith("backlog-harvest-failed-"),
    );
    expect(dumps).toHaveLength(1);
    expect(readFileSync(path.join(runsDir, dumps[0] ?? ""), "utf8")).toContain(
      "unparseable demand output for 神话比较",
    );
    expect(demandIdeas(root)).toEqual([]);
    expect(consoleOutput.join("\n")).toMatch(/1 failed demand lane\(s\)/);
    expect(consoleErrors.join("\n")).toMatch(
      /demand 神话比较: unparseable LLM output/,
    );
  });

  it("exits 1 only when the document AND every demand lane failed", async () => {
    const root = mkFixture();
    writeSnapshot(root);
    chatMock.mockResolvedValue({ content: "no yaml at all" });
    captureConsole();
    expect(await runBacklogHarvest({ cwd: root })).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/every source failed extraction/);
  });
});
