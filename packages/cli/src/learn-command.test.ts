import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findRepoRoot, runLearn } from "./learn-command.js";

/** Stand up a project tree that looks like the real repo: workspace
 *  file at the root, project dir below, article + a rendered MP4 +
 *  state.yaml (the latter is what `resolveProjectDir` keys on). */
function mkFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "video-learn-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  const proj = path.join(root, "projects", "demo");
  mkdirSync(path.join(proj, "output"), { recursive: true });
  writeFileSync(path.join(proj, "article.md"), "# Topic\n");
  writeFileSync(path.join(proj, "output", "final-mixed.mp4"), "fake-mp4-bytes");
  writeFileSync(path.join(proj, "state.yaml"), "status: DRAFT\n");
  return { root, proj };
}

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
});
function captureConsole() {
  console.log = (...a: unknown[]) => {
    consoleOutput.push(a.join(" "));
  };
  console.error = (...a: unknown[]) => {
    consoleErrors.push(a.join(" "));
  };
}

describe("findRepoRoot", () => {
  it("walks up to the pnpm-workspace.yaml", () => {
    const root = mkdtempSync(path.join(tmpdir(), "video-find-"));
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
    mkdirSync(path.join(root, "packages", "pkg-a"), { recursive: true });
    const nested = path.join(root, "packages", "pkg-a", "src", "deep");
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
  });

  it("falls back to the start path when no workspace marker is found", () => {
    const isolated = mkdtempSync(path.join(tmpdir(), "video-isolated-"));
    expect(findRepoRoot(isolated)).toBe(isolated);
  });
});

describe("runLearn — argument validation", () => {
  it("returns 1 with a usage hint when no project, --status, or --propose is given", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toContain("video learn needs a project");
  });

  it("returns 1 when the project does not exist", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ project: "no-such", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors[0]).toMatch(/no project matching/);
  });

  it("returns 1 when the artifact does not exist (no review possible yet)", async () => {
    const { root, proj } = mkFixture();
    // remove the rendered MP4 the fixture created
    require("node:fs").unlinkSync(path.join(proj, "output", "final-mixed.mp4"));
    captureConsole();
    const code = await runLearn({ project: "demo", cwd: root });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/nothing to review/);
  });
});

describe("runLearn — --ask", () => {
  it("emits a video-learn/1 JSON envelope on stdout and exits 2", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ project: "demo", cwd: root, ask: true });
    expect(code).toBe(2);
    const envelope = JSON.parse(consoleOutput.join("\n"));
    expect(envelope.protocol).toBe("video-learn/1");
    expect(envelope.command).toEqual(["learn", "demo"]);
    expect(envelope.questions.length).toBeGreaterThan(0);
    for (const q of envelope.questions) {
      expect(q.id).toBeTruthy();
      expect(q.options.length).toBeGreaterThan(0);
    }
    // artifact is path-relative to the project, defaulting to output/final-mixed.mp4
    expect(envelope.artifact).toBe("output/final-mixed.mp4");
  });
});

describe("runLearn — --answer", () => {
  it("returns 1 when the answer file is not valid YAML/JSON", async () => {
    const { root, proj } = mkFixture();
    const broken = path.join(proj, "review-broken.yaml");
    writeFileSync(broken, "this is: not: yaml: at: all: :: :");
    captureConsole();
    const code = await runLearn({
      project: "demo",
      cwd: root,
      answerFile: broken,
    });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(
      /could not read|not a valid learn-review/,
    );
  });

  it("rejects a file that is valid YAML but not a learn-review/1 session", async () => {
    const { root, proj } = mkFixture();
    const offShape = path.join(proj, "review-offshape.yaml");
    writeFileSync(
      offShape,
      [
        "schema: not-learn-review-1",
        "project: demo",
        "artifact: x.mp4",
        "reviewedAt: 2026-10-17T10:00:00.000Z",
        "answers: []",
      ].join("\n") + "\n",
    );
    captureConsole();
    const code = await runLearn({
      project: "demo",
      cwd: root,
      answerFile: offShape,
    });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/not a valid learn-review/);
  });

  it("merges a valid session into the store and returns 0", async () => {
    const { root, proj } = mkFixture();
    const valid = path.join(proj, "review.yaml");
    writeFileSync(
      valid,
      [
        "schema: learn-review/1",
        "project: demo",
        "artifact: output/final-mixed.mp4",
        "reviewedAt: 2026-10-17T10:00:00.000Z",
        "answers:",
        "  - id: image_text",
        "    answer: scene 4 came back covered in fake signage",
        "    highConfidence: true",
      ].join("\n") + "\n",
    );
    captureConsole();
    const code = await runLearn({
      project: "demo",
      cwd: root,
      answerFile: valid,
    });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/recorded 1 answer/);
    expect(consoleOutput.join("\n")).toMatch(/merged into/);
    // writeReviewSession drops a timestamped file under <projectRoot>/learnings/
    const learnings = path.join(proj, "learnings");
    const files = readdirSync(learnings);
    expect(
      files.some((f) => f.startsWith("review-") && f.endsWith(".yaml")),
    ).toBe(true);
  });
});

describe("runLearn — --status", () => {
  it("prints a summary and returns 0", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ cwd: root, status: true });
    expect(code).toBe(0);
    const out = consoleOutput.join("\n");
    // Fresh fixture: no lessons yet, the documented empty-store path.
    expect(out).toMatch(/learnings\/lessons\.yaml is empty/);
    expect(out).toMatch(/no image-prompt rules active yet/);
  });
});

describe("runLearn — --propose", () => {
  it("writes a proposal file and returns 0", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ cwd: root, propose: true });
    expect(code).toBe(0);
    const out = path.join(root, "learnings", "skill-update-proposal.md");
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8").length).toBeGreaterThan(0);
    expect(consoleOutput.join("\n")).toMatch(/NOT applied/);
  });

  it("respects a custom --out path", async () => {
    const { root } = mkFixture();
    const custom = path.join(root, "custom-proposal.md");
    captureConsole();
    const code = await runLearn({ cwd: root, propose: true, out: custom });
    expect(code).toBe(0);
    expect(existsSync(custom)).toBe(true);
  });
});

describe("runLearn — default (no flag)", () => {
  it("prints the review brief when nothing else is asked", async () => {
    const { root } = mkFixture();
    captureConsole();
    const code = await runLearn({ project: "demo", cwd: root });
    expect(code).toBe(0);
    const out = consoleOutput.join("\n");
    expect(out).toMatch(/Watch .*final-mixed\.mp4 before answering/);
    // Every REVIEW_QUESTION id is enumerated in the brief
    expect(out).toMatch(/image_text/);
    expect(out).toMatch(/video learn demo --answer/);
  });
});
