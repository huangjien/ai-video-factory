import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runBacklogAdd,
  runBacklogApprove,
  runBacklogDrop,
  runBacklogList,
  runBacklogReset,
} from "./backlog-command.js";
import {
  loadBacklogEntry,
  loadBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
  type BacklogStore,
} from "./backlog-store.js";

let repoRoot: string;
let consoleOutput: string[];
let consoleErrors: string[];
const origLog = console.log;
const origErr = console.error;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-cmd-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  rmSync(repoRoot, { recursive: true, force: true });
});

function addArticle(project: string, body: string): void {
  const dir = path.join(repoRoot, "projects", project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "article.md"), body, "utf8");
}

function seedEntry(partial: Partial<BacklogEntry>): BacklogEntry {
  const store = initStore();
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

function initStore(): BacklogStore {
  try {
    return loadBacklogStore(repoRoot);
  } catch {
    // unreachable for a fresh fixture — loadBacklogStore never throws on missing
    return { schema: "backlog/1", ideas: [] };
  }
}

describe("runBacklogAdd", () => {
  it("creates the store and stamps the entry", async () => {
    const code = await runBacklogAdd({
      topic: "为什么军官要定期轮岗",
      note: "防山头 vs 经验连续性",
      cwd: repoRoot,
    });
    expect(code).toBe(0);
    expect(existsSync(path.join(repoRoot, "backlog.yaml"))).toBe(true);
    const store = loadBacklogStore(repoRoot);
    expect(store.ideas).toHaveLength(1);
    expect(store.ideas[0]?.status).toBe("idea");
    expect(store.ideas[0]?.source).toBe("manual");
    expect(store.ideas[0]?.topic).toBe("为什么军官要定期轮岗");
  });

  it("carries note, anchors, content and lang", async () => {
    const contentFile = path.join(repoRoot, "note.md");
    writeFileSync(contentFile, "一段很长的头脑风暴内容。".repeat(20), "utf8");
    await runBacklogAdd({
      topic: "停火线机制",
      note: "监督机制与利益冻结",
      anchors: ["板门店停战协定", "克什米尔 LoC"],
      contentFile,
      lang: "zh-CN",
      cwd: repoRoot,
    });
    const entry = loadBacklogStore(repoRoot).ideas[0]!;
    expect(entry.anchors).toEqual(["板门店停战协定", "克什米尔 LoC"]);
    expect(entry.content).toContain("头脑风暴");
    expect(entry.lang).toBe("zh-CN");
  });

  it("rejects a missing or empty --content-file", async () => {
    expect(
      (await runBacklogAdd({ topic: "t", contentFile: "no-such.md", cwd: repoRoot })),
    ).toBe(1);
    const empty = path.join(repoRoot, "empty.md");
    writeFileSync(empty, "   \n", "utf8");
    expect(
      (await runBacklogAdd({ topic: "t", contentFile: empty, cwd: repoRoot })),
    ).toBe(1);
    expect(existsSync(path.join(repoRoot, "backlog.yaml"))).toBe(false);
  });

  it("blocks on catalog overlap and --force overrules", async () => {
    addArticle(
      "任务式指挥",
      "---\nproject: t\n---\n\n# 任务式指挥\n\n条令与放权的历史。",
    );
    const blocked = await runBacklogAdd({
      topic: "任务式指挥",
      cwd: repoRoot,
    });
    expect(blocked).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/overlap with the existing catalog/);
    expect(consoleErrors.join("\n")).toMatch(/任务式指挥/);
    expect(loadBacklogStore(repoRoot).ideas).toHaveLength(0);

    const forced = await runBacklogAdd({
      topic: "任务式指挥",
      force: true,
      cwd: repoRoot,
    });
    expect(forced).toBe(0);
    expect(loadBacklogStore(repoRoot).ideas).toHaveLength(1);
    expect(consoleOutput.join("\n")).toMatch(/overridden by --force/);
  });

  it("does NOT false-positive on a fresh topic", async () => {
    addArticle("航母与军种文化", "# 航母组织\n\n舰载机联队。");
    const code = await runBacklogAdd({ topic: "军官轮岗制度", cwd: repoRoot });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).not.toMatch(/overlap/);
  });
});

describe("list / approve / drop / reset lifecycle", () => {
  it("list hides dropped by default and filters by status", async () => {
    const dropped = seedEntry({ id: "2026-01-01-dropped", status: "dropped", drop_reason: "写过了" });
    const kept = seedEntry({ id: "2026-01-02-kept" });

    await runBacklogList({ cwd: repoRoot });
    const text = consoleOutput.join("\n");
    expect(text).toContain(kept.id);
    expect(text).not.toContain(dropped.id);

    await runBacklogList({ status: "dropped", cwd: repoRoot });
    expect(consoleOutput.join("\n")).toMatch(/dropped: 写过了/);
  });

  it("approve moves proposed → idea and rejects illegal moves", async () => {
    seedEntry({ id: "2026-01-01-harvested", status: "proposed", source: "harvest:docs/plans/x.md" });

    expect(await runBacklogApprove({ id: "2026-01-01-harvested", cwd: repoRoot })).toBe(0);
    expect(loadBacklogEntry(repoRoot, "2026-01-01-harvested")?.status).toBe("idea");

    consoleErrors = [];
    expect(
      (await runBacklogApprove({ id: "2026-01-01-harvested", cwd: repoRoot })),
    ).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/cannot move/);
  });

  it("reset recovers a stuck drafting entry", async () => {
    const seeded = seedEntry({ status: "drafting", drafting_at: new Date().toISOString() });

    expect(await runBacklogReset({ id: seeded.id, cwd: repoRoot })).toBe(0);
    const entry = loadBacklogEntry(repoRoot, seeded.id)!;
    expect(entry.status).toBe("idea");
    expect(entry.drafting_at).toBeUndefined();
  });

  it("reports unknown ids with the available list", async () => {
    seedEntry({});
    consoleErrors = [];
    expect(await runBacklogDrop({ id: "no-such-id", cwd: repoRoot })).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/no backlog entry "no-such-id" — ids:/);
  });
});
