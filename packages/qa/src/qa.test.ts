import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RenderPlan } from "@vf/vdsl";
import {
  buildRenderReport,
  detectBlackFrames,
  makeContactSheet,
  probeVideo,
} from "./index.js";

const execFileAsync = promisify(execFile);

/** 2s test pattern followed by 1s of true black — the "injected black
 * frames" fixture for the §28 report. */
async function makeFixtureVideo(outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "color=black:size=320x180:rate=30:duration=1",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[out]",
    "-map",
    "[out]",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

function makePlan(totalFrames: number): RenderPlan {
  return {
    project: {
      id: "qa-fixture",
      language: "zh-CN",
      fps: 30,
      width: 320,
      height: 180,
    },
    style: { theme: "dark-tech" },
    totalFrames,
    scenes: [
      {
        id: "scene-01",
        index: 0,
        startFrame: 0,
        durationInFrames: totalFrames,
        component: "Title",
        renderer: "remotion",
        props: { text: "x" },
        animation: { entrance: "none", emphasis: "none", exit: "none" },
        animations: [],
        transition: null,
        captions: null,
        audio: "assets/audio/does-not-exist.wav",
      },
    ],
  };
}

describe("@vf/qa render report (plan §28)", () => {
  let dir: string;
  let video: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-qa-"));
    video = path.join(dir, "fixture.mp4");
    await makeFixtureVideo(video);
  }, 60_000);

  afterEach(() => {
    // keep the shared fixture dir; individual files are per-test
  });

  it("probes duration, geometry, fps, and audio absence", async () => {
    const info = await probeVideo(video);
    expect(info.width).toBe(320);
    expect(info.height).toBe(180);
    expect(info.fps).toBe(30);
    expect(Math.abs(info.duration - 3)).toBeLessThan(0.2);
    expect(info.hasAudio).toBe(false);
  });

  it("detects the injected 1s black segment", async () => {
    const segs = await detectBlackFrames(video, { minDurationSec: 0.3 });
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const injected = segs.find((s) => s.start >= 1.5);
    expect(injected).toBeDefined();
    expect(injected!.duration).toBeGreaterThan(0.5);
  });

  it("buildRenderReport flags missing audio assets as errors", async () => {
    const report = await buildRenderReport(makePlan(90), video);
    expect(report.ok).toBe(false);
    expect(report.checks.assets.missing).toContain(
      "assets/audio/does-not-exist.wav",
    );
    expect(report.findings.some((f) => f.check === "assets")).toBe(true);
    // duration: plan 90 frames @30fps = 3s ≈ fixture duration
    expect(report.checks.duration.ok).toBe(true);
    expect(report.checks.resolution.ok).toBe(true);
    expect(report.checks.fps.ok).toBe(true);
    // fixture has no narration but declares audio → warn, not error
    expect(report.checks.audio.ok).toBe(false);
    expect(report.findings.find((f) => f.check === "audio")?.level).toBe(
      "warn",
    );
  });

  it("a plan matching the artifact passes ok despite warnings", async () => {
    const plan = makePlan(90); // 3s @30fps — matches the fixture
    plan.scenes[0]!.audio = null;
    const report = await buildRenderReport(plan, video);
    expect(report.ok).toBe(true);
    expect(report.checks.duration.ok).toBe(true);
    // The injected black segment is still surfaced — as a warning.
    expect(report.checks.blackFrames.length).toBeGreaterThanOrEqual(1);
    expect(report.findings.every((f) => f.level === "warn")).toBe(true);
  });

  it("writes a real PNG contact sheet", async () => {
    const out = path.join(dir, "sheet.png");
    await makeContactSheet(video, out, { frames: 4, thumbWidth: 160 });
    expect(existsSync(out)).toBe(true);
    // PNG signature: \x89 P N G \r \n \x1a \n — magic at bytes 1..3.
    const head = readFileSync(out).subarray(1, 4);
    expect(head.toString("latin1")).toBe("PNG");
  });
});
