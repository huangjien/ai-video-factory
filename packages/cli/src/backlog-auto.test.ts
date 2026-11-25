import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Write a file and backdate its mtime (the idle scanner reads mtimes). */
function touch(file: string, when: number): void {
  writeFileSync(
    file,
    existsSync(file) ? readFileSync(file, "utf8") : "",
    "utf8",
  );
  utimesSync(file, new Date(when), new Date(when));
}

// The auto producer orchestrates four stages; every one is stubbed so the
// trigger/lock/pick logic runs offline.
const draftMock = vi.fn();
const makeMock = vi.fn();
const translateMock = vi.fn();
const judgeMock = vi.fn();
const approveMock = vi.fn();
vi.mock("./backlog-draft.js", () => ({
  runDraftFromBacklog: (...a: unknown[]) =>
    (draftMock as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("./make-command.js", () => ({
  runMakeCli: (...a: unknown[]) =>
    (makeMock as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("./translate-command.js", () => ({
  runTranslate: (...a: unknown[]) =>
    (translateMock as (...x: unknown[]) => unknown)(...a),
  l10nRootOrThrow: (projectRoot: string) =>
    path.join(projectRoot, "l10n", "en-US"),
}));
const shortsMock = vi.fn();
vi.mock("./shorts-command.js", () => ({
  runShorts: (...a: unknown[]) =>
    (shortsMock as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("./youtube-command.js", () => ({
  resolveYouTubeCredentials: async () => {
    throw new Error("offline test");
  },
  runYouTube: vi.fn(),
}));
const verticalMock = vi.fn();
vi.mock("./vertical-command.js", () => ({
  runVertical: (...a: unknown[]) =>
    (verticalMock as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("./backlog-score.js", () => ({
  runBacklogJudge: (...a: unknown[]) =>
    (judgeMock as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@video/workflow", () => ({
  writeRun: vi.fn(async () => undefined),
  formatRunId: (stage: string) => `${stage}-test`,
  approveCheckpoint: (...a: unknown[]) =>
    (approveMock as (...x: unknown[]) => unknown)(...a),
}));

import {
  runBacklogAuto,
  stageTook,
  minimaxIdleMinutes,
  acquireAutoLock,
  fetchMiniMaxQuota,
  publishModel,
  shortsDescription,
} from "./backlog-auto.js";
import {
  loadBacklogStore,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";
import {
  expectedJudgeIds,
  judgeFingerprint,
  judgeRoute,
  makeJudgeCacheRecord,
  writeJudgeCache,
} from "./backlog-judge-cache.js";
import { loadProviderConfig } from "@video/llm";
import { writeRun } from "@video/workflow";

let repoRoot: string;
let consoleOutput: string[];
let consoleErrors: string[];
const origLog = console.log;
const origErr = console.error;
const NOW = Date.parse("2026-11-19T12:00:00Z");

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-auto-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
  draftMock.mockReset().mockResolvedValue(0);
  makeMock.mockReset().mockResolvedValue(0);
  translateMock.mockReset().mockResolvedValue(0);
  verticalMock.mockReset().mockResolvedValue(0);
  shortsMock
    .mockReset()
    .mockImplementation(async ({ project }: { project: string }) => {
      mkdirSync(path.join(project, "youtube"), { recursive: true });
      writeFileSync(path.join(project, "youtube", "shorts.mp4"), "test");
      return 0;
    });
  // The real judge writes a ranking the contract accepts; the stub must
  // do the same or the auto flow refuses the pick it just judged.
  judgeMock.mockReset().mockImplementation(async () => {
    writeValidJudgeCache();
    return 0;
  });
  approveMock.mockReset().mockResolvedValue({ ok: true });
  process.env["MINIMAX_API_KEY"] = "test-key";
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  rmSync(repoRoot, { recursive: true, force: true });
  delete process.env["MINIMAX_API_KEY"];
});

function seed(partial: Partial<BacklogEntry>): BacklogEntry {
  const store = loadBacklogStore(repoRoot);
  const entry: BacklogEntry = {
    id: "2026-11-19-top-idea",
    topic: "为什么停火线能冻结几十年",
    status: "proposed",
    source: "harvest:docs/plans/x.md",
    created: "2026-11-19",
    ...partial,
  };
  store.ideas.push(entry);
  saveBacklogStore(repoRoot, store);
  return entry;
}

/** Write a judge cache the CURRENT contract accepts: one row per OPEN
 *  idea (the ranking length must match), under the fingerprint of the
 *  current inputs. `rankFirstId`, when still open, goes first. */
function writeValidJudgeCache(rankFirstId?: string): void {
  const store = loadBacklogStore(repoRoot);
  const fingerprint = judgeFingerprint(
    repoRoot,
    store,
    judgeRoute(loadProviderConfig()),
  );
  const ids = expectedJudgeIds(store);
  const first =
    rankFirstId !== undefined && ids.includes(rankFirstId)
      ? rankFirstId
      : ids[0];
  const ordered =
    first !== undefined ? [first, ...ids.filter((id) => id !== first)] : [];
  writeJudgeCache(
    repoRoot,
    makeJudgeCacheRecord({
      fingerprint,
      provider: "glm",
      created: "2026-11-19T00:00:00.000Z",
      ranking: ordered.map((id, index) => ({
        id,
        rank: index + 1,
        reason: "r",
      })),
    }),
  );
}

function seedJudgeCache(rankFirstId: string): void {
  writeValidJudgeCache(rankFirstId);
}

/** The quota fetch is the network seam: default = healthy (both windows 90%). */
function quotaOk(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 90,
            current_weekly_remaining_percent: 90,
          },
        ],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

function readyToFire(): Record<string, unknown> {
  seed({ status: "proposed" });
  seedJudgeCache("2026-11-19-top-idea");
  return {
    cwd: repoRoot,
    fetchImpl: quotaOk(),
    runPublish: async () => 0,
  };
}

describe("fetchMiniMaxQuota", () => {
  it("returns the general-bucket window percentages", async () => {
    const q = await fetchMiniMaxQuota(quotaOk());
    expect(q).toEqual({ intervalRemaining: 90, weeklyRemaining: 90 });
  });

  it("fails loudly without a key or without the general bucket", async () => {
    delete process.env["MINIMAX_API_KEY"];
    await expect(fetchMiniMaxQuota(quotaOk())).rejects.toThrow(
      /MINIMAX_API_KEY is not set/,
    );
    process.env["MINIMAX_API_KEY"] = "test-key";
    const noBucket = (async () =>
      new Response(
        JSON.stringify({ model_remains: [{ model_name: "video" }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await expect(fetchMiniMaxQuota(noBucket)).rejects.toThrow(
      /no general-bucket percentages/,
    );
  });
});
describe("stageTook", () => {
  it("reads seconds under a minute, then minutes, then hours and minutes", () => {
    expect(stageTook(45_400)).toBe("45s");
    expect(stageTook(59_900)).toBe("1m");
    expect(stageTook(3_301_000)).toBe("55m");
    expect(stageTook(4_320_000)).toBe("1h12m");
  });
});

describe("minimaxIdleMinutes", () => {
  it("is Infinity with no minimax evidence anywhere", () => {
    expect(minimaxIdleMinutes(repoRoot, NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("sees a fresh minimax run record as recent work", () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    const f = path.join(runs, "draft-judge-x.yaml");
    writeFileSync(f, "provider: minimax\nmodel: MiniMax-M3\n");
    touch(f, NOW - 5 * 60 * 1000);
    expect(minimaxIdleMinutes(repoRoot, NOW)).toBeLessThan(10);
  });

  it("a glm-only record is NOT minimax work", () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    const f = path.join(runs, "draft-judge-x.yaml");
    writeFileSync(f, "provider: glm\n");
    touch(f, NOW - 5 * 60 * 1000);
    expect(minimaxIdleMinutes(repoRoot, NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("fresh TTS audio counts even without a run record", () => {
    const audio = path.join(repoRoot, "projects", "demo", "assets", "audio");
    mkdirSync(audio, { recursive: true });
    const f = path.join(audio, "scene-1.wav");
    writeFileSync(f, "wav");
    touch(f, NOW - 30 * 60 * 1000);
    expect(minimaxIdleMinutes(repoRoot, NOW)).toBeLessThan(60);
  });
});

describe("acquireAutoLock", () => {
  it("second acquire fails while the first holds it", () => {
    expect(acquireAutoLock(repoRoot, NOW).acquired).toBe(true);
    const second = acquireAutoLock(repoRoot, NOW);
    expect(second.acquired).toBe(false);
    expect(second.acquired === false ? second.reason : "").toMatch(
      /another backlog auto is running/,
    );
  });

  it("a stale lock from a dead pid is taken over after 3h", () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    const lock = path.join(runs, "backlog-auto.lock");
    writeFileSync(lock, "pid: 999999999\ntaken: 2026-11-19T00:00:00Z\n");
    utimesSync(
      lock,
      new Date(NOW - 4 * 60 * 60 * 1000),
      new Date(NOW - 4 * 60 * 60 * 1000),
    );
    expect(acquireAutoLock(repoRoot, NOW).acquired).toBe(true);
  });
});

describe("runBacklogAuto — trigger gates", () => {
  it("refuses when either quota window is below the bar", async () => {
    seedJudgeCache("2026-11-19-top-idea");
    seed({});
    const lowWeekly = (async () =>
      new Response(
        JSON.stringify({
          model_remains: [
            {
              model_name: "general",
              current_interval_remaining_percent: 90,
              current_weekly_remaining_percent: 40,
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const code = await runBacklogAuto({ cwd: repoRoot, fetchImpl: lowWeekly });
    expect(code).toBe(0);
    expect(draftMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/quota below 80%/);
  });

  it("refuses when MiniMax worked within the hour", async () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    const f = path.join(runs, "tts-x.yaml");
    writeFileSync(f, "provider: minimax\n");
    const code = await runBacklogAuto(readyToFire());
    expect(code).toBe(0);
    expect(draftMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/worked .* ago/);
    void f;
  });

  it("refuses while an idea is stuck mid-pipeline", async () => {
    seed({
      id: "2026-11-19-stuck",
      topic: "卡住的点子",
      status: "drafting",
      drafting_at: new Date().toISOString(),
    });
    const code = await runBacklogAuto(readyToFire());
    expect(code).toBe(0);
    expect(draftMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/mid-pipeline.*2026-11-19-stuck/);
  });
});

describe("runBacklogAuto — the pipeline", () => {
  it("fires all four stages in order and auto-approves the idea", async () => {
    const code = await runBacklogAuto(readyToFire());
    expect(code).toBe(0);
    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(draftMock.mock.calls[0]?.[0]).toMatchObject({
      id: "2026-11-19-top-idea",
      draft: { cwd: repoRoot, noAsk: true },
    });
    expect(makeMock).toHaveBeenCalledTimes(2);
    expect(makeMock.mock.calls[0]?.[0]).toMatchObject({
      project: "为什么停火线能冻结几十年",
      cwd: repoRoot,
    });
    expect(makeMock.mock.calls[1]?.[0]).toMatchObject({
      project: "为什么停火线能冻结几十年",
      lang: "en-US",
    });
    expect(translateMock).toHaveBeenCalledTimes(1);
    expect(translateMock.mock.calls[0]?.[0]).toMatchObject({
      project: "为什么停火线能冻结几十年",
      lang: "en-US",
    });
    // Both storyboards are approved before their renders — the gate that
    // killed the first real auto run (render-preview refuses otherwise).
    expect(approveMock).toHaveBeenCalledTimes(2);
    expect(approveMock.mock.calls[0]?.[1]).toMatchObject({
      stage: "storyboard",
    });
    expect(String(approveMock.mock.calls[0]?.[0])).toContain("projects");
    expect(String(approveMock.mock.calls[1]?.[0])).toContain(
      path.join("l10n", "en-US"),
    );
    // The draft stage is mocked here, so the FINAL drafted stamp belongs
    // to the real draft — auto's own visible effect is the approval.
    const entry = loadBacklogStore(repoRoot).ideas.find(
      (e) => e.id === "2026-11-19-top-idea",
    );
    expect(entry?.status).toBe("idea");
    expect(existsSync(path.join(repoRoot, "runs", "backlog-auto.lock"))).toBe(
      false,
    );
  });

  it("records how long each stage took", async () => {
    // Only Date is faked — the make stub moves the clock, nothing waits.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      makeMock.mockImplementationOnce(async () => {
        vi.setSystemTime(NOW + 37 * 60_000);
        return 0;
      });
      const code = await runBacklogAuto(readyToFire());
      expect(code).toBe(0);
      const written = vi.mocked(writeRun).mock.calls.at(-1)?.[1] as {
        error?: string;
      };
      expect(written?.error).toMatch(
        /draft-zh 0s \| approve-storyboard-zh 0s \| make-zh 37m \| translate-en 0s/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("records stage timings when production fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      makeMock.mockImplementationOnce(async () => {
        vi.setSystemTime(NOW + 37 * 60_000);
        return 1;
      });
      await runBacklogAuto(readyToFire());
      expect(vi.mocked(writeRun).mock.calls.at(-1)?.[1]).toMatchObject({
        status: "failed",
        error: expect.stringMatching(/draft-zh 0s .* make-zh 37m/),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-approves a proposed entry and takes the first OPEN ranked idea when the top one is drafted", async () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      path.join(runs, "backlog-judge-" + "b".repeat(64) + ".yaml"),
      `schema: backlog-judge/1\nranking:\n  - id: 2026-11-19-top-idea\n    rank: 1\n    reason: stale — drafted since\n  - id: 2026-11-19-second\n    rank: 2\n    reason: next open\n`,
      "utf8",
    );
    seed({ id: "2026-11-19-second", topic: "第二个点子", status: "idea" });
    seed({ id: "2026-11-19-top-idea", status: "drafted", project: "x" });

    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
    });
    expect(code).toBe(0);
    expect(draftMock.mock.calls[0]?.[0]).toMatchObject({
      id: "2026-11-19-second",
    });
  });

  it("a failed stage aborts, keeps the lock released, and leaves the idea approved-but-unstamped", async () => {
    makeMock.mockResolvedValueOnce(1); // make-zh fails
    const code = await runBacklogAuto(readyToFire());
    expect(code).toBe(1);
    expect(translateMock).not.toHaveBeenCalled();
    expect(draftMock).toHaveBeenCalledTimes(1);
    const entry = loadBacklogStore(repoRoot).ideas.find(
      (e) => e.id === "2026-11-19-top-idea",
    );
    // The real draft stamps drafting→drafted; with it mocked the entry
    // rests at the auto-approved state, ready for a manual resume.
    expect(entry?.status).toBe("idea");
    expect(existsSync(path.join(repoRoot, "runs", "backlog-auto.lock"))).toBe(
      false,
    );
    expect(consoleErrors.join("\n")).toMatch(/stage make-zh failed/);
  });

  it("a live lock blocks the run", async () => {
    acquireAutoLock(repoRoot, NOW);
    const code = await runBacklogAuto(readyToFire());
    expect(code).toBe(0);
    expect(draftMock).not.toHaveBeenCalled();
    expect(consoleOutput.join("\n")).toMatch(/another backlog auto is running/);
  });

  it("dry run decides but writes nothing", async () => {
    const code = await runBacklogAuto({ ...readyToFire(), dryRun: true });
    expect(code).toBe(0);
    expect(draftMock).not.toHaveBeenCalled();
    expect(loadBacklogStore(repoRoot).ideas[0]?.status).toBe("proposed");
    expect(existsSync(path.join(repoRoot, "runs", "backlog-auto.lock"))).toBe(
      false,
    );
    expect(consoleOutput.join("\n")).toMatch(/dry run — nothing executed/);
  });

  it("ignores the legacy per-hash judge caches", async () => {
    // The judge cache is ONE file (runs/backlog-judge.yaml, fingerprinted
    // against the current inputs). The old per-hash files are removed on
    // sight and must never decide the pick — here they rank a stale entry
    // first, and the pick must still be the open idea.
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      path.join(runs, "backlog-judge-" + "f".repeat(64) + ".yaml"),
      `schema: backlog-judge/1\nranking:\n  - id: stale-entry\n    rank: 1\n    reason: old\n`,
      "utf8",
    );
    const newer = path.join(runs, "backlog-judge-" + "0".repeat(64) + ".yaml");
    writeFileSync(
      newer,
      `schema: backlog-judge/1\nranking:\n  - id: 2026-11-19-top-idea\n    rank: 1\n    reason: fresh\n`,
      "utf8",
    );
    seed({});
    // backdate the stale cache so mtime order = [newer, stale]
    const st = statSync(newer);
    utimesSync(
      path.join(runs, "backlog-judge-" + "f".repeat(64) + ".yaml"),
      new Date(st.mtimeMs - 60_000),
      new Date(st.mtimeMs - 60_000),
    );
    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
    });
    expect(code).toBe(0);
    expect(draftMock.mock.calls[0]?.[0]).toMatchObject({
      id: "2026-11-19-top-idea",
    });
  });

  it("runs the judge first when no cache exists", async () => {
    seed({});
    judgeMock.mockImplementation(async () => {
      seedJudgeCache("2026-11-19-top-idea");
      return 0;
    });
    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
    });
    expect(code).toBe(0);
    expect(judgeMock).toHaveBeenCalledTimes(1);
    expect(draftMock).toHaveBeenCalled();
  });

  it("publishes every lane after make-en; a publish failure is non-fatal", async () => {
    const publishCalls: string[] = [];
    const fire = (ytZhFails: boolean): Promise<number> => {
      const id = `2026-11-19-idea-${publishCalls.length}`;
      seed({ id, topic: `点子 ${publishCalls.length}`, status: "idea" });
      seedJudgeCache(id);
      return runBacklogAuto({
        cwd: repoRoot,
        fetchImpl: quotaOk(),
        runPublish: async (step) => {
          publishCalls.push(step.kind);
          return step.kind === "yt-zh" && ytZhFails ? 1 : 0;
        },
      });
    };

    let code = await fire(false);
    expect(code).toBe(0);
    expect(publishCalls).toEqual([
      "bili-zh",
      "yt-zh",
      "yt-en",
      "bili-en",
      "douyin-zh",
      "douyin-en",
    ]);

    // One lane failing must not fail the run — the MP4s exist, uploads
    // are individually retryable by hand.
    consoleErrors = [];
    code = await fire(true);
    expect(code).toBe(0);
    expect(publishCalls.slice(6)).toEqual([
      "bili-zh",
      "yt-zh",
      "yt-en",
      "bili-en",
      "douyin-zh",
      "douyin-en",
    ]);
    expect(consoleErrors.join("\n")).toMatch(
      /publish-yt-zh failed .* non-fatal/,
    );
  });

  it("runs the shorts derivative + uploads to YouTube Shorts + writes the TikTok lane", async () => {
    const uploads: { slug: string; topic: string }[] = [];
    const seeded = seed({});
    seedJudgeCache(seeded.id);
    const enYoutube = path.join(
      repoRoot,
      "projects",
      seeded.topic,
      "l10n/en-US/youtube",
    );
    mkdirSync(enYoutube, { recursive: true });
    writeFileSync(
      path.join(enYoutube, "title.txt"),
      "Why ceasefire lines freeze",
    );
    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
      uploadShorts: async (input) => {
        uploads.push(input);
        return 0;
      },
      shortsCredentials: {
        clientId: "c",
        clientSecret: "s",
        refreshToken: "r",
      },
    });
    expect(code).toBe(0);
    expect(uploads).toMatchObject([
      {
        slug: "为什么停火线能冻结几十年",
        topic: seeded.topic,
      },
      {
        slug: seeded.topic + "/l10n/en-US",
        topic: "Why ceasefire lines freeze",
      },
    ]);
    const tiktokPath = path.join(
      repoRoot,
      "projects",
      "为什么停火线能冻结几十年",
      "tiktok",
      "package.json",
    );
    expect(existsSync(tiktokPath)).toBe(true);
    const tiktok = JSON.parse(readFileSync(tiktokPath, "utf8")) as {
      platform: string;
      visibility: string;
    };
    expect(tiktok.platform).toBe("tiktok");
    expect(tiktok.visibility).toBe("public");
  });

  it("fails the run when the English Shorts export is missing", async () => {
    const entry = seed({});
    seedJudgeCache(entry.id);
    shortsMock
      .mockImplementationOnce(async ({ project }: { project: string }) => {
        mkdirSync(path.join(project, "youtube"), { recursive: true });
        writeFileSync(path.join(project, "youtube", "shorts.mp4"), "test");
        return 0;
      })
      .mockResolvedValueOnce(0);
    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
      uploadShorts: async () => 0,
    });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toContain("shorts-en");
  });

  it("--no-shorts skips the derivative, the upload, and the TikTok lane", async () => {
    seed({});
    seedJudgeCache("2026-11-19-top");
    const uploadShorts = vi.fn(async () => 0);
    const code = await runBacklogAuto({
      cwd: repoRoot,
      fetchImpl: quotaOk(),
      runPublish: async () => 0,
      uploadShorts,
      noShorts: true,
    });
    expect(code).toBe(0);
    expect(uploadShorts).not.toHaveBeenCalled();
    expect(verticalMock).not.toHaveBeenCalled();
    const runsDir = path.join(
      repoRoot,
      "projects",
      "为什么停火线能冻结几十年",
      "tiktok",
    );
    expect(existsSync(runsDir)).toBe(false);
  });
});

describe("runBacklogAuto — scheduler flags", () => {
  it("delegates --install-scheduler to the auto LaunchAgent", async () => {
    const launchArgs: string[][] = [];
    const code = await runBacklogAuto({
      installScheduler: true,
      plistDir: path.join(repoRoot, "LaunchAgents"),
      videoPath: "/usr/local/bin/video",
      runLaunchctl: async (args) => {
        launchArgs.push(args);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(launchArgs[0]?.[0]).toBe("load");
    const plist = readFileSync(
      path.join(
        repoRoot,
        "LaunchAgents",
        "com.aivideofactory.backlog-auto.plist",
      ),
      "utf8",
    );
    expect(plist).toContain("com.aivideofactory.backlog-auto");
    expect(plist).toContain("StartCalendarInterval");
    expect(plist).toContain("VIDEO_ASK");
  });
});

describe("minimaxIdleMinutes — self-poisoning guard", () => {
  it("the auto verb's own run records are NOT minimax work", () => {
    const runs = path.join(repoRoot, "runs");
    mkdirSync(runs, { recursive: true });
    const f = path.join(runs, "backlog-auto-2026-11-19T17:04:31Z-001.yaml");
    writeFileSync(
      f,
      "provider: minimax+glm\nstage: backlog-auto\nstatus: succeeded\n",
    );
    touch(f, NOW - 5 * 60 * 1000);
    expect(minimaxIdleMinutes(repoRoot, NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("publishModel", () => {
  afterEach(() => {
    delete process.env["BACKLOG_PUBLISH_MODEL"];
  });

  it("defaults to minimax — the GLM lane content-filters and breaks bilibili tags", () => {
    expect(publishModel()).toBe("minimax");
  });

  it("honours an explicit BACKLOG_PUBLISH_MODEL=glm override", () => {
    process.env["BACKLOG_PUBLISH_MODEL"] = "glm";
    expect(publishModel()).toBe("glm");
  });
});

describe("shortsDescription", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "video-shorts-desc-"));
    mkdirSync(path.join(dir, "youtube"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps only the spoken section of the hook file, not the cover prompt", () => {
    writeFileSync(
      path.join(dir, "youtube", "shorts-hook.txt"),
      "古代中国武士、战车车夫 · 镜头采用连续三个中景\n\n口播钩子（0—5秒）：\n同样是英雄，为什么有人等待封神？\n",
      "utf8",
    );
    const out = shortsDescription(dir, "TOPIC");
    expect(out).toContain("同样是英雄，为什么有人等待封神？");
    expect(out).not.toContain("镜头采用连续三个中景");
    expect(out.endsWith("TOPIC")).toBe(true);
  });

  it("falls back to the film description when the hook has no spoken section", () => {
    writeFileSync(
      path.join(dir, "youtube", "shorts-hook.txt"),
      "cover prompt only, no spoken script\n",
      "utf8",
    );
    writeFileSync(
      path.join(dir, "youtube", "description.md"),
      "FILM DESCRIPTION\n",
      "utf8",
    );
    const out = shortsDescription(dir, "TOPIC");
    expect(out).toContain("FILM DESCRIPTION");
    expect(out).not.toContain("cover prompt only");
  });

  it("falls back to the topic when neither file exists", () => {
    expect(shortsDescription(dir, "TOPIC")).toBe("TOPIC");
  });
});
