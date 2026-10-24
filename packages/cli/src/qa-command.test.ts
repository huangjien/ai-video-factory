import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const writeQaArtifacts = vi.fn();
const loadOrCompileStoryboard = vi.fn();

vi.mock("@video/qa", () => ({
  writeQaArtifacts: (...a: unknown[]) =>
    (writeQaArtifacts as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@video/video-renderer", () => ({
  loadOrCompileStoryboard: (...a: unknown[]) =>
    (loadOrCompileStoryboard as (...x: unknown[]) => unknown)(...a),
}));

import { runQa } from "./qa-command.js";

/** A project dir the resolver accepts: storyboard/storyboard.yaml present. */
function mkProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-cmd-"));
  mkdirSync(path.join(dir, "storyboard"), { recursive: true });
  writeFileSync(path.join(dir, "storyboard", "storyboard.yaml"), "scenes: []");
  mkdirSync(path.join(dir, "output"), { recursive: true });
  writeFileSync(path.join(dir, "output", "preview.mp4"), "mp4");
  return dir;
}

const plan = { scenes: [] } as unknown as Parameters<
  typeof loadOrCompileStoryboard
> extends never
  ? Record<string, never>
  : Record<string, unknown>;

beforeEach(() => {
  writeQaArtifacts.mockReset();
  loadOrCompileStoryboard.mockReset();
  loadOrCompileStoryboard.mockResolvedValue({ renderPlan: plan });
});

describe("runQa (cli surface)", () => {
  it("missing preview.mp4 → message + exit 1, no QA run", async () => {
    const dir = mkProject();
    try {
      rmSync(path.join(dir, "output", "preview.mp4"));
      const code = await runQa({ project: dir, strict: false });
      expect(code).toBe(1);
      expect(writeQaArtifacts).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clean report: exit 0 and 'no findings'", async () => {
    const dir = mkProject();
    try {
      writeQaArtifacts.mockResolvedValue({
        ok: true,
        findings: [],
        checks: {},
      });
      const code = await runQa({ project: dir, strict: true });
      expect(code).toBe(0);
      expect(writeQaArtifacts).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warn-level finding: reported, exit stays 0 when report.ok", async () => {
    const dir = mkProject();
    try {
      writeQaArtifacts.mockResolvedValue({
        ok: true,
        findings: [
          {
            level: "warn",
            check: "sceneBoundaries",
            message: "only 0/3 cuts detected",
            fix: "check the contact sheet",
          },
        ],
        checks: {},
      });
      const code = await runQa({ project: dir, strict: true });
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("error-level finding with report.ok=false: strict exits 1, --no-strict exits 0", async () => {
    const dir = mkProject();
    try {
      writeQaArtifacts.mockResolvedValue({
        ok: false,
        findings: [
          {
            level: "error",
            check: "duration",
            message: "video is 3.00s but the plan says 5.00s",
            fix: "re-render",
          },
        ],
        checks: {},
      });
      const strict = await runQa({ project: dir, strict: true });
      expect(strict).toBe(1);
      const lenient = await runQa({ project: dir, strict: false });
      expect(lenient).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unknown project name: resolver error + exit 1", async () => {
    const code = await runQa({
      project: path.join(tmpdir(), "does-not-exist-xyz"),
      strict: true,
    });
    expect(code).toBe(1);
  });
});
