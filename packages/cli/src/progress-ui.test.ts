import { describe, expect, it, vi, afterEach } from "vitest";
import { formatProgressEvent, withProgress } from "./ui.js";
import type { ProgressEvent } from "@video/make";

/**
 * video-progress/1 (v0.7.1 plan P2): the CLI's progress rendering —
 * §3 line vocabulary on stderr, stdout never touched.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatProgressEvent", () => {
  const base = { label: "tts scene_03" };

  it("renders a step/item start", () => {
    expect(formatProgressEvent({ kind: "start", ...base })).toBe(
      "  ▷ tts scene_03",
    );
  });

  it("renders a done line with position and elapsed seconds", () => {
    const e: ProgressEvent = {
      kind: "done",
      ...base,
      index: 3,
      total: 23,
      elapsedSec: 4,
    };
    expect(formatProgressEvent(e)).toBe("  ✓ [3/23] tts scene_03  4s");
  });

  it("renders a heartbeat as an alive marker with elapsed", () => {
    expect(
      formatProgressEvent({
        kind: "heartbeat",
        label: "render",
        elapsedSec: 95,
      }),
    ).toBe("  ⏳ render … 95s");
  });

  it("renders a failure with elapsed and a truncated message", () => {
    const e: ProgressEvent = {
      kind: "fail",
      ...base,
      elapsedSec: 12,
      message: "x".repeat(200),
    };
    const line = formatProgressEvent(e);
    expect(line.startsWith("  ✗ tts scene_03  12s: ")).toBe(true);
    expect(line.length).toBeLessThan(120);
  });
});

describe("withProgress", () => {
  it("prints start then done around a resolved call and returns its value", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const value = await withProgress("audio-plan", async () => 7);
    expect(value).toBe(7);
    const lines = errSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toBe("  ▷ audio-plan");
    expect(lines[lines.length - 1]).toMatch(/^  ✓ audio-plan  \d+s$/);
    // Fast call: no heartbeats in between.
    expect(lines.length).toBe(2);
  });

  it("never writes to stdout", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await withProgress("web search", async () => null);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("prints a fail line and rethrows the wrapped error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withProgress("laya visual assist", async () => {
        throw new Error("laya down");
      }),
    ).rejects.toThrow("laya down");
    const lines = errSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[lines.length - 1]).toMatch(
      /^  ✗ laya visual assist  \d+s: laya down$/,
    );
  });
});
