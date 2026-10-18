import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPrompts } from "./prompts-command.js";

async function run(args: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerPrompts(program);
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await program.parseAsync(["prompts", ...args], { from: "user" });
    return logged.mock.calls.map((c) => c.join(" ")).join("\n");
  } finally {
    logged.mockRestore();
  }
}

afterEach(() => {
  process.exitCode = 0;
});

describe("video prompts", () => {
  it("lists every prompt file with a preview", async () => {
    const out = await run([]);
    expect(out).toContain("storyboard.md");
    expect(out).toContain("draft-article.md");
    expect(out).toContain("music.json");
    expect(out).toMatch(/1[5678] prompts — edit under/);
  });

  it("shows a prompt body by stem", async () => {
    const out = await run(["show", "qa-triage"]);
    expect(out).toContain("pass = nothing beyond the normal human gate");
  });

  it("shows a structured file by exact name", async () => {
    const out = await run(["show", "image-styles.yaml"]);
    expect(out).toContain("FLAT VECTOR ILLUSTRATION");
  });

  it("path prints the registry directory", async () => {
    const out = await run(["path"]);
    expect(out).toMatch(/packages[/\\]prompts[/\\]prompts/);
  });

  it("unknown prompt sets exit code and names the fix", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let first = "";
    try {
      await run(["show", "nope"]);
      first = String(err.mock.calls[0]?.[0] ?? "");
    } finally {
      err.mockRestore();
    }
    expect(process.exitCode).toBe(1);
    expect(first).toMatch(/unknown prompt: nope/);
  });
});
