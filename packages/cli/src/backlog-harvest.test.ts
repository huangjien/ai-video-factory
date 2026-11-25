import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import type { BacklogStore } from "./backlog-store.js";

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
      "schema: backlog/1\nideas:\n  - id: 2026-01-01-existing\n    topic: 为什么停火线能冻结几十年\n    status: idea\n    source: manual\n    created: \"2026-01-01\"\n",
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
        { topic: "停战协定的监督机制", anchors: ["板门店停战协定"], why: "covered" },
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
    writeFileSync(path.join(root, "docs", "plans", "index.md"), "# Plans\n\nA table of documents.\n");
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
    writeFileSync(
      path.join(learnings, "beta.md"),
      LONG_DOC("Learning Notes"),
    );
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
        path.join(root, "runs", readdirSync(path.join(root, "runs")).find((f) => f.startsWith("backlog-harvest-2") && !f.includes("failed")) ?? ""),
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
