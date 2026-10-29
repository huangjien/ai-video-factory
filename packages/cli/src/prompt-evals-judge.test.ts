import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The layer-2 (judge) path of `video prompts eval`. The judge provider
 * is the boundary under test: the stub keeps the run offline and lets
 * the error rows be produced deterministically.
 */
const chatError = vi.hoisted(() => new Error("provider offline"));

vi.mock("@video/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/llm")>();
  class OfflineProvider {
    readonly name = "glm";
    async chat(): Promise<never> {
      throw chatError;
    }
  }
  class OfflineMiniMaxProvider {
    readonly name = "minimax";
    async chat(): Promise<never> {
      throw chatError;
    }
  }
  return {
    ...actual,
    GLMProvider: OfflineProvider,
    MiniMaxProvider: OfflineMiniMaxProvider,
  };
});

const { registerPrompts } = await import("./prompts-command.js");

/** `video prompts eval` always rewrites the committed report file. The
 *  judge run below produces error rows, so the file is saved and put
 *  back — a test must not leave a different artifact in the tree. */
const REPORT_PATH = path.resolve(
  import.meta.dirname,
  "../../prompts/evals/report.yaml",
);

describe("video prompts eval — layer 2 (judge)", () => {
  let savedReport = "";

  beforeEach(() => {
    savedReport = readFileSync(REPORT_PATH, "utf8");
  });

  afterEach(() => {
    writeFileSync(REPORT_PATH, savedReport, "utf8");
  });

  async function run(args: string[]): Promise<{ out: string; code: number }> {
    const program = new Command();
    program.exitOverride();
    registerPrompts(program);
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const original = process.exitCode;
    process.exitCode = 0;
    try {
      await program.parseAsync(["prompts", ...args], { from: "user" });
      return {
        out: logged.mock.calls.map((c) => c.join(" ")).join("\n"),
        code: process.exitCode ?? 0,
      };
    } finally {
      logged.mockRestore();
      process.exitCode = original;
    }
  }

  it("records a provider failure as an error row, never as a pass", async () => {
    const { out, code } = await run([
      "eval",
      "--judge",
      "glm",
      "--agent",
      "storyboard",
      "--case",
      "xuanwumen-scene-count-fits-180s",
    ]);
    // A broken judge call must not read as a pass.
    expect(code).toBe(2);
    expect(out).toContain("could not be measured");
  }, 30_000);

  it("says that layer 2 was skipped in offline mode", async () => {
    const { out } = await run([
      "eval",
      "--offline",
      "--judge",
      "glm",
      "--agent",
      "storyboard",
      "--case",
      "xuanwumen-scene-count-fits-180s",
    ]);
    expect(out).toContain("layer 2 skipped");
  }, 30_000);
});
