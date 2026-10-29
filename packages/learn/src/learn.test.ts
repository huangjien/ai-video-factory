import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REVIEW_QUESTIONS,
  emptyLessonStore,
  reviewQuestion,
  isActiveLesson,
  lessonId,
  listReviewSessions,
  loadLessonStore,
  mergeSession,
  promptRules,
  saveLessonStore,
  skillUpdateProposal,
  summarizeStore,
  toLessonStatement,
  writeReviewSession,
  type ReviewSession,
} from "./index.js";

function session(
  answers: { id: string; answer: string; highConfidence?: boolean }[],
  overrides: Partial<ReviewSession> = {},
): ReviewSession {
  return {
    schema: "learn-review/1",
    project: "p1",
    artifact: "output/final-mixed.mp4",
    reviewedAt: "2026-10-17T10:00:00.000Z",
    answers: answers.map((a) => ({
      id: a.id,
      answer: a.answer,
      ...(a.highConfidence !== undefined
        ? { highConfidence: a.highConfidence }
        : {}),
    })),
    ...overrides,
  };
}

describe("reviewQuestion", () => {
  it("returns the question with the requested id", () => {
    const q = reviewQuestion("image_text");
    expect(q?.id).toBe("image_text");
    expect(q?.options.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown id", () => {
    expect(reviewQuestion("not-a-question")).toBeUndefined();
  });
});

describe("REVIEW_QUESTIONS", () => {
  it("asks at least five open questions, every one with options", () => {
    expect(REVIEW_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    for (const q of REVIEW_QUESTIONS) {
      expect(q.prompt.length).toBeGreaterThan(20);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.hint.length).toBeGreaterThan(10);
    }
  });

  it("has unique ids", () => {
    const ids = REVIEW_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers image text, missing visuals, narration, audio and payoff", () => {
    const ids = REVIEW_QUESTIONS.map((q) => q.id);
    for (const required of [
      "image_text",
      "image_match",
      "missing_visuals",
      "narration_fit",
      "audio_balance",
      "topic_payoff",
    ]) {
      expect(ids).toContain(required);
    }
  });
});

describe("toLessonStatement", () => {
  it("rejects a bare option label — it is not an instruction", () => {
    expect(toLessonStatement("too busy")).toBeNull();
    expect(toLessonStatement("silent or near-silent")).toBeNull();
  });

  it("rejects too-short answers", () => {
    expect(toLessonStatement("bad")).toBeNull();
  });

  it("accepts a concrete statement and normalizes whitespace", () => {
    expect(
      toLessonStatement("  scenes   4 and 9\ncame back   full of signage  "),
    ).toBe("scenes 4 and 9 came back full of signage");
  });
});

describe("lessonId", () => {
  it("folds casing, trailing punctuation and spacing into one identity", () => {
    expect(lessonId("image-prompt", "Keep the lower third clear.")).toBe(
      lessonId("image-prompt", "  keep the lower third clear  "),
    );
  });

  it("does not merge across scopes", () => {
    expect(lessonId("image-prompt", "same words")).not.toBe(
      lessonId("draft", "same words"),
    );
  });
});

describe("mergeSession — the corroboration gate", () => {
  it("a first sighting is recorded but NOT active", () => {
    const { store } = mergeSession(
      emptyLessonStore(),
      session([
        { id: "image_text", answer: "scenes 4 and 9 carried fake signage" },
      ]),
    );
    expect(store.lessons).toHaveLength(1);
    expect(store.lessons[0]?.seenCount).toBe(1);
    expect(isActiveLesson(store.lessons[0]!)).toBe(false);
    expect(promptRules(store, "image-prompt")).toBe("");
  });

  it("a second sighting in another project activates it", () => {
    const answer = {
      id: "image_text" as const,
      answer: "scene 4 carried fake signage",
    };
    const first = mergeSession(emptyLessonStore(), session([answer])).store;
    const second = mergeSession(
      first,
      session([answer], {
        project: "p2",
        reviewedAt: "2026-10-18T10:00:00.000Z",
      }),
    ).store;
    expect(second.lessons[0]?.seenCount).toBe(2);
    expect(isActiveLesson(second.lessons[0]!)).toBe(true);
    expect(promptRules(second, "image-prompt")).toContain(
      "scene 4 carried fake signage",
    );
    expect(promptRules(second, "image-prompt")).toContain("raised 2×");
  });

  it("high confidence bypasses corroboration", () => {
    const { store } = mergeSession(
      emptyLessonStore(),
      session([
        {
          id: "audio_balance",
          answer: "the bgm tag resolved to a silent placeholder every run",
          highConfidence: true,
        },
      ]),
    );
    expect(isActiveLesson(store.lessons[0]!)).toBe(true);
  });

  it("tracks every project a lesson was seen in", () => {
    const answer = {
      id: "topic_payoff" as const,
      answer: "lost the thread after scene six",
    };
    let store = mergeSession(emptyLessonStore(), session([answer])).store;
    store = mergeSession(store, session([answer], { project: "p2" })).store;
    expect(store.lessons[0]?.projects.sort()).toEqual(["p1", "p2"]);
  });

  it("rejects vague answers without inventing a lesson", () => {
    const { store, rejected } = mergeSession(
      emptyLessonStore(),
      session([{ id: "image_match", answer: "mostly match" }]),
    );
    expect(store.lessons).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.id).toBe("image_match");
  });

  it("drops answers to questions this build does not know", () => {
    const { store, rejected } = mergeSession(
      emptyLessonStore(),
      session([
        { id: "colour_grading", answer: "everything looked washed out to me" },
      ]),
    );
    expect(store.lessons).toHaveLength(0);
    expect(rejected[0]?.id).toBe("colour_grading");
  });
});

describe("a RESOLVED lesson stops steering prompts", () => {
  // A lesson records a defect. Once the defect is FIXED, the advice the
  // lesson carries is stale by definition — "delete scenes/*.mp4 before
  // re-rendering" is now wrong advice. A lesson that lies is worse than
  // no lesson, so a resolved one must not reach a prompt.
  const answer = {
    id: "image_match" as const,
    answer: "scene 4 carried a stale render",
  };

  it("a corroborated lesson is active", () => {
    let store = mergeSession(emptyLessonStore(), session([answer])).store;
    store = mergeSession(store, session([answer], { project: "p2" })).store;
    expect(isActiveLesson(store.lessons[0]!)).toBe(true);
    expect(promptRules(store, "image-prompt")).toContain("stale render");
  });

  it("a resolved lesson is NOT active, however corroborated", () => {
    let store = mergeSession(emptyLessonStore(), session([answer])).store;
    store = mergeSession(store, session([answer], { project: "p2" })).store;
    store.lessons[0]!.resolved = true;
    store.lessons[0]!.resolvedAt = "2026-10-24";
    store.lessons[0]!.resolution =
      "the cache key now includes the image digest";
    expect(isActiveLesson(store.lessons[0]!)).toBe(false);
    expect(promptRules(store, "image-prompt")).toBe("");
  });

  it("a resolved lesson survives a merge — a later sighting does not revive it", () => {
    let store = mergeSession(emptyLessonStore(), session([answer])).store;
    store.lessons[0]!.resolved = true;
    store.lessons[0]!.resolution = "fixed";
    store = mergeSession(store, session([answer], { project: "p2" })).store;
    expect(store.lessons[0]?.seenCount).toBe(2);
    expect(store.lessons[0]?.resolved).toBe(true);
    expect(isActiveLesson(store.lessons[0]!)).toBe(false);
  });

  it("the resolution fields survive a store round-trip", () => {
    // The schema must accept them, or saveLessonStore would silently
    // drop the record of the fix on the next write.
    const root = mkdtempSync(path.join(tmpdir(), "learn-resolved-"));
    let store = mergeSession(emptyLessonStore(), session([answer])).store;
    store.lessons[0]!.resolved = true;
    store.lessons[0]!.resolvedAt = "2026-10-24";
    store.lessons[0]!.resolution =
      "the cache key now includes the image digest";
    saveLessonStore(root, store);
    const reloaded = loadLessonStore(root);
    expect(reloaded.lessons[0]?.resolved).toBe(true);
    expect(reloaded.lessons[0]?.resolvedAt).toBe("2026-10-24");
    expect(reloaded.lessons[0]?.resolution).toBe(
      "the cache key now includes the image digest",
    );
  });
});

describe("persistence", () => {
  it("round-trips the store and session files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "learn-"));
    const projectRoot = path.join(root, "projects", "p1");
    mkdirSync(projectRoot, { recursive: true });

    const { store } = mergeSession(
      emptyLessonStore(),
      session([
        {
          id: "image_text",
          answer: "every editorial scene came back as a book page",
        },
      ]),
    );
    const file = saveLessonStore(root, store);
    expect(existsSync(file)).toBe(true);

    const reloaded = loadLessonStore(root);
    expect(reloaded.lessons).toHaveLength(1);
    expect(reloaded.lessons[0]?.scope).toBe("image-prompt");

    const sessionFile = writeReviewSession(
      projectRoot,
      session([
        {
          id: "image_text",
          answer: "every editorial scene came back as a book page",
        },
      ]),
    );
    expect(readFileSync(sessionFile, "utf8")).toContain("learn-review/1");
    expect(listReviewSessions(projectRoot)).toHaveLength(1);
  });

  it("degrades to no lessons when the hand-edited store is corrupt", () => {
    const root = mkdtempSync(path.join(tmpdir(), "learn-bad-"));
    mkdirSync(path.join(root, "learnings"), { recursive: true });
    writeFileSync(
      path.join(root, "learnings", "lessons.yaml"),
      "{{{ not yaml",
      "utf8",
    );
    expect(loadLessonStore(root).lessons).toEqual([]);
  });

  it("returns an empty store when the file is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "learn-none-"));
    expect(loadLessonStore(root).lessons).toEqual([]);
  });
});

describe("proposal + status", () => {
  it("proposes rather than applies, and says so", () => {
    const { store } = mergeSession(
      emptyLessonStore(),
      session([
        {
          id: "audio_balance",
          answer: "the bgm tag always resolved to a silent placeholder",
          highConfidence: true,
        },
      ]),
    );
    const proposal = skillUpdateProposal(store);
    expect(proposal).toContain("Not applied");
    expect(proposal).toContain("silent placeholder");
  });

  it("status explains the corroboration threshold", () => {
    const { store } = mergeSession(
      emptyLessonStore(),
      session([
        { id: "audio_balance", answer: "narration was too quiet throughout" },
      ]),
    );
    const status = summarizeStore(store);
    expect(status.join("\n")).toContain("after 2 reviews");
  });
});
