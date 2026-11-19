import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertTransition,
  canTransition,
  initBacklogStore,
  isStaleDrafting,
  loadBacklogEntry,
  loadBacklogStore,
  nextBacklogId,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";

let repoRoot: string;
beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-store-"));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function entry(partial: Partial<BacklogEntry>): BacklogEntry {
  return {
    id: "2026-11-18-demo",
    topic: "为什么停火线能冻结几十年",
    status: "idea",
    source: "manual",
    created: "2026-11-18",
    ...partial,
  };
}

describe("loadBacklogStore — missing and corrupt files", () => {
  it("reads a missing file as an empty store", () => {
    const store = loadBacklogStore(repoRoot);
    expect(store.schema).toBe("backlog/1");
    expect(store.ideas).toEqual([]);
  });

  it("throws with the file path when the YAML is corrupt", () => {
    writeFileSync(path.join(repoRoot, "backlog.yaml"), "schema: [unclosed");
    expect(() => loadBacklogStore(repoRoot)).toThrow(/backlog\.yaml is malformed/);
  });

  it("rejects an unknown schema instead of guessing", () => {
    writeFileSync(path.join(repoRoot, "backlog.yaml"), "schema: backlog/9\nideas: []\n");
    expect(() => loadBacklogStore(repoRoot)).toThrow(/unsupported schema backlog\/9/);
  });

  it("names the offending entry when a status is misspelled", () => {
    writeFileSync(
      path.join(repoRoot, "backlog.yaml"),
      "schema: backlog/1\nideas:\n  - id: x\n    topic: t\n    status: drafter\n",
    );
    expect(() => loadBacklogStore(repoRoot)).toThrow(/ideas\[0\] \(x\) has unknown status drafter/);
  });
});

describe("init and round-trip", () => {
  it("creates the file with the schema header on first write", () => {
    initBacklogStore(repoRoot);
    expect(existsSync(path.join(repoRoot, "backlog.yaml"))).toBe(true);
    expect(readFileSync(path.join(repoRoot, "backlog.yaml"), "utf8")).toMatch(
      /schema: backlog\/1/,
    );
  });

  it("round-trips entries including the long content block", () => {
    const store = initBacklogStore(repoRoot);
    store.ideas.push(
      entry({
        content: "长笔记第一行\n\n第二段也是长文……".repeat(50),
        anchors: ["板门店停战协定"],
      }),
    );
    saveBacklogStore(repoRoot, store);
    const loaded = loadBacklogEntry(repoRoot, "2026-11-18-demo");
    expect(loaded?.content).toContain("第二段也是长文");
    expect(loaded?.anchors).toEqual(["板门店停战协定"]);
  });
});

describe("nextBacklogId — stable, never reused", () => {
  it("builds the id from date + slugified topic", () => {
    expect(nextBacklogId("为什么停火线能冻结几十年", [], "2026-11-18")).toBe(
      "2026-11-18-为什么停火线能冻结几十年",
    );
  });

  it("suffixes -2, -3 when the base id is taken", () => {
    const ideas = [
      entry({ id: "2026-11-18-停火线" }),
      entry({ id: "2026-11-18-停火线-2" }),
    ];
    expect(nextBacklogId("停火线", ideas, "2026-11-18")).toBe("2026-11-18-停火线-3");
  });
});

describe("status transitions", () => {
  it("allows the designed lifecycle", () => {
    expect(canTransition("proposed", "idea")).toBe(true);
    expect(canTransition("idea", "drafting")).toBe(true);
    expect(canTransition("drafting", "drafted")).toBe(true);
    expect(canTransition("idea", "dropped")).toBe(true);
    expect(canTransition("proposed", "dropped")).toBe(true);
  });

  it("rejects skipping and un-drafting a finished idea", () => {
    expect(canTransition("proposed", "drafting")).toBe(false);
    expect(canTransition("drafted", "dropped")).toBe(false);
    expect(canTransition("dropped", "idea")).toBe(false);
  });

  it("allows drafting → idea only via reset", () => {
    expect(canTransition("drafting", "idea")).toBe(false);
    expect(canTransition("drafting", "idea", true)).toBe(true);
  });

  it("assertTransition explains the legal moves", () => {
    const e = entry({ status: "proposed" });
    expect(() => assertTransition(e, "drafting")).toThrow(
      /legal from proposed: idea\|dropped/,
    );
  });
});

describe("isStaleDrafting", () => {
  it("flags drafting entries older than a day", () => {
    const stale = entry({
      status: "drafting",
      drafting_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    expect(isStaleDrafting(stale)).toBe(true);
  });

  it("does not flag fresh drafting or other statuses", () => {
    const fresh = entry({ status: "drafting", drafting_at: new Date().toISOString() });
    expect(isStaleDrafting(fresh)).toBe(false);
    expect(isStaleDrafting(entry({ status: "idea" }))).toBe(false);
  });
});
