import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The pick flow wraps runDraft; stubbing the wrapper's draft dependency
// keeps the lifecycle tests offline (the real draft costs LLM calls).
const runDraft = vi.fn();
vi.mock("./draft-command.js", () => ({
  runDraft: (...a: unknown[]) =>
    (runDraft as (...x: unknown[]) => unknown)(...a),
}));

import { runDraftFromBacklog, draftingContext } from "./backlog-draft.js";
import {
  loadBacklogEntry,
  loadBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";

let repoRoot = "";
let consoleOutput: string[];
let consoleErrors: string[];
const origLog = console.log;
const origErr = console.error;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-draft-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
  runDraft.mockReset();
  runDraft.mockResolvedValue(0);
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  rmSync(repoRoot, { recursive: true, force: true });
});

/** What the pick flow hands to runDraft — the mock boundary's shape. */
interface DraftCall {
  topic: string;
  lang?: string;
  ideaFile?: string;
}

function firstDraftCall(): DraftCall {
  const raw = runDraft.mock.calls[0]?.[0];
  // Mock boundary: vi.fn() erases the argument type, so the call object
  // is asserted once to the interface above, then read typed.
  return raw as DraftCall;
}

function seed(partial: Partial<BacklogEntry>): BacklogEntry {
  const entry: BacklogEntry = {
    id: "2026-11-18-停火线",
    topic: "为什么停火线能冻结几十年",
    status: "idea",
    source: "manual",
    created: "2026-11-18",
    ...partial,
  };
  const store = loadBacklogStore(repoRoot);
  store.ideas.push(entry);
  saveBacklogStore(repoRoot, store);
  return entry;
}

const DRAFT = () => ({ cwd: repoRoot });

describe("draftingContext — the drafter's context", () => {
  it("uses an entry's own content when it has one", () => {
    const context = draftingContext({
      id: "a",
      topic: "t",
      status: "idea",
      source: "manual",
      created: "2026-11-18",
      content: "长笔记：监督机制、利益冻结……",
    });
    expect(context).toBe("长笔记：监督机制、利益冻结……");
  });

  it("composes the premise and the anchors when the entry has no content", () => {
    const context = draftingContext({
      id: "a",
      topic: "谁被允许下阴间",
      status: "proposed",
      source: "demand:神话比较",
      created: "2026-11-26",
      note: "日播 45.0 明显跑赢频道中位。 — 把三套地下世界当成三套官僚机构来查。 — ⚠ possible overlap: foo (a、b); bar (c) [按需采集·神话比较；锚点待核实] 日播与互动率都跑赢频道中位。",
      anchors: ["《西游记》第三回生死簿", "Brihadaranyaka Upanishad"],
    });
    expect(context).toContain("把三套地下世界当成三套官僚机构来查。");
    expect(context).toContain("《西游记》第三回生死簿");
    expect(context).toContain("Brihadaranyaka Upanishad");
    // The harvest's bookkeeping is not the episode.
    expect(context).not.toContain("跑赢频道中位");
    expect(context).not.toContain("possible overlap");
  });

  it("hands the composed context to the drafter as the idea file", async () => {
    seed({
      note: "证据 — 前提：三个人怎么分工。",
      anchors: ["《左传》阏伯受谗"],
    });
    let seen = "";
    runDraft.mockImplementation(async (opts: { ideaFile?: string }) => {
      if (opts.ideaFile !== undefined) {
        seen = readFileSync(opts.ideaFile, "utf8");
      }
      return 0;
    });
    const code = await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: DRAFT(),
    });
    expect(code).toBe(0);
    expect(seen).toContain("前提：三个人怎么分工。");
    expect(seen).toContain("《左传》阏伯受谗");
  });
});

describe("runDraftFromBacklog — guards", () => {
  it("names the audience the proposal's lane is written for", async () => {
    // A demand proposal knows its lane; the lane knows who watches it.
    // Drafting a mythology episode for "developers" comes back as an
    // access-control explainer.
    seed({ source: "demand:神话比较" });
    await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: DRAFT(),
    });
    const call = runDraft.mock.calls[0]?.[0] as { audience?: string };
    expect(call.audience).toContain("神话");
  });

  it("leaves the audience alone for an entry with no lane", async () => {
    seed({ source: "manual" });
    await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: DRAFT(),
    });
    const call = runDraft.mock.calls[0]?.[0] as { audience?: string };
    expect(call.audience).toBeUndefined();
  });

  it("rejects unknown ids", async () => {
    expect(await runDraftFromBacklog({ id: "no-such", draft: DRAFT() })).toBe(
      1,
    );
    expect(runDraft).not.toHaveBeenCalled();
  });

  it("rejects already-drafted and dropped entries", async () => {
    seed({ status: "drafted", project: "为什么停火线能冻结几十年" });
    expect(
      await runDraftFromBacklog({ id: "2026-11-18-停火线", draft: DRAFT() }),
    ).toBe(1);

    rmSync(repoRoot, { recursive: true, force: true });
    repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-draft-"));
    seed({ status: "dropped" });
    expect(
      await runDraftFromBacklog({ id: "2026-11-18-停火线", draft: DRAFT() }),
    ).toBe(1);
    expect(runDraft).not.toHaveBeenCalled();
  });

  it("refuses a proposed entry without --force, drafts it with --force", async () => {
    seed({ status: "proposed", source: "harvest:docs/plans/x.md" });
    expect(
      await runDraftFromBacklog({ id: "2026-11-18-停火线", draft: DRAFT() }),
    ).toBe(1);
    expect(runDraft).not.toHaveBeenCalled();

    const code = await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      force: true,
      draft: DRAFT(),
    });
    expect(code).toBe(0);
    expect(runDraft).toHaveBeenCalledTimes(1);
    expect(loadBacklogEntry(repoRoot, "2026-11-18-停火线")?.status).toBe(
      "drafted",
    );
  });
});

describe("runDraftFromBacklog — the loop", () => {
  it("stamps drafted with the project backlink and injects content", async () => {
    seed({ content: "长笔记：监督机制、利益冻结……" });
    const code = await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: { ...DRAFT(), lang: "en-US" },
    });
    expect(code).toBe(0);
    expect(runDraft).toHaveBeenCalledTimes(1);

    const call = firstDraftCall();
    expect(call.topic).toBe("为什么停火线能冻结几十年");
    expect(call.ideaFile).toBeDefined();
    expect(existsSync(call.ideaFile!)).toBe(false); // temp idea file cleaned up

    const entry = loadBacklogEntry(repoRoot, "2026-11-18-停火线")!;
    expect(entry.status).toBe("drafted");
    expect(entry.project).toBe("为什么停火线能冻结几十年");
    expect(entry.drafted_at).toBeDefined();
    expect(entry.drafting_at).toBeDefined();
  });

  it("explicit --lang wins over the entry's preferred language", async () => {
    seed({ lang: "zh-CN" });
    await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: { ...DRAFT(), lang: "en-US" },
    });
    expect(firstDraftCall().lang).toBe("en-US");
  });

  it("entry lang is used when the caller set none", async () => {
    seed({ lang: "en-US" });
    await runDraftFromBacklog({ id: "2026-11-18-停火线", draft: DRAFT() });
    expect(firstDraftCall().lang).toBe("en-US");
  });

  it("a failed draft reverts the stamp", async () => {
    seed({});
    runDraft.mockResolvedValue(1);
    const code = await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: DRAFT(),
    });
    expect(code).toBe(1);
    const entry = loadBacklogEntry(repoRoot, "2026-11-18-停火线")!;
    expect(entry.status).toBe("idea");
    expect(entry.drafting_at).toBeUndefined();
    expect(consoleErrors.join("\n")).toMatch(/draft failed/);
  });

  it("the ask gate's exit 2 reverts cleanly as not-started", async () => {
    seed({});
    runDraft.mockResolvedValue(2);
    const code = await runDraftFromBacklog({
      id: "2026-11-18-停火线",
      draft: DRAFT(),
    });
    expect(code).toBe(2);
    const entry = loadBacklogEntry(repoRoot, "2026-11-18-停火线")!;
    expect(entry.status).toBe("idea");
    expect(consoleErrors.join("\n")).toMatch(/questions pending/);
  });

  it("scaffolds the project before drafting", async () => {
    seed({});
    await runDraftFromBacklog({ id: "2026-11-18-停火线", draft: DRAFT() });
    expect(
      existsSync(path.join(repoRoot, "projects", "为什么停火线能冻结几十年")),
    ).toBe(true);
  });
});
