import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLayaAsk, runLayaEval, runLayaHealth } from "./laya-command.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

describe("runLayaHealth", () => {
  it("prints the resolved-config line on either success or failure", async () => {
    captureConsole();
    const code = await runLayaHealth({});
    const out = consoleOutput.join("\n");
    if (code === 0) {
      expect(out).toMatch(/laya: .+\(mode=/);
      expect(out).toMatch(/✓ status=/);
    } else {
      expect(out).toMatch(/laya: .+\(mode=/);
      expect(consoleErrors.join("\n")).toMatch(/unreachable|unhealthy/);
    }
  });
});

describe("runLayaAsk", () => {
  it("returns 1 with a clear error when the input is not JSON", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-laya-"));
    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{ not really json");
    captureConsole();
    const code = await runLayaAsk(broken, {});
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/not valid JSON/);
  });

  it("returns 1 when the JSON is valid but the shape is wrong", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-laya-"));
    const offShape = path.join(dir, "offshape.json");
    writeFileSync(offShape, JSON.stringify({ state: 1, questions: "nope" }));
    captureConsole();
    const code = await runLayaAsk(offShape, {});
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/input must be/);
  });
});

describe("runLayaEval", () => {
  it("returns 1 with a usage hint when no project and no --file", async () => {
    captureConsole();
    const code = await runLayaEval(undefined, { cwd: "/tmp" });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toMatch(/pass a project|--file/);
  });

  it("returns 0 with `no decisions` message when the file is empty", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-laya-eval-"));
    const file = path.join(dir, "laya-decisions.jsonl");
    writeFileSync(file, "");
    captureConsole();
    const code = await runLayaEval(undefined, { file });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/no decisions in|no decisions/);
  });

  it("prints a 3-line gate table with PASS/FAIL for each surface", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-laya-eval-"));
    const file = path.join(dir, "laya-decisions.jsonl");
    // motion: 1/1 agreed in shadow → 100%, gate 90 → PASS
    // visual: 1/5 agreed in shadow →  20%, gate 85 → FAIL
    function rec(over: Record<string, unknown>): string {
      return JSON.stringify({
        ts: "2026-10-17T10:00:00.000Z",
        surface: "motion",
        mode: "shadow",
        state_sha256: "h",
        questions: {},
        answers: { q1: "x" },
        routing_model: "english",
        latency_ms: 12,
        acted: false,
        agreed: true,
        ...over,
      });
    }
    const rows = [
      rec({}),                                       // motion agree
      rec({ surface: "visual", agreed: true }),      // visual agree
      rec({ ts: "2026-10-17T10:02:00.000Z", surface: "visual", agreed: false }),
      rec({ ts: "2026-10-17T10:03:00.000Z", surface: "visual", agreed: false }),
      rec({ ts: "2026-10-17T10:04:00.000Z", surface: "visual", agreed: false }),
      rec({ ts: "2026-10-17T10:05:00.000Z", surface: "visual", agreed: false }),
    ].join("\n");
    writeFileSync(file, rows);
    captureConsole();
    const code = await runLayaEval(undefined, { file });
    expect(code).toBe(0);
    const out = consoleOutput.join("\n");
    expect(out).toMatch(/surface  shadow-rows  answered  agreed/);
    expect(out).toMatch(/motion/);
    expect(out).toMatch(/100%/);
    expect(out).toMatch(/PASS/);
    expect(out).toMatch(/visual/);
    expect(out).toMatch(/20%/);
    expect(out).toMatch(/FAIL/);
  });
});
