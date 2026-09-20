import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderPlan } from "@vf/vdsl";
import { renderPlanToVideo } from "./render.js";

const samplePlan: RenderPlan = {
  project: { id: "fixture", language: "zh-CN", fps: 30, width: 1920, height: 1080 },
  style: { theme: "dark-tech" },
  totalFrames: 210,
  scenes: [
    {
      id: "scene-01",
      index: 0,
      startFrame: 0,
      durationInFrames: 90,
      component: "Title",
      props: { text: "测试 1" },
      animation: { entrance: "fade", emphasis: "none", exit: "none" },
      captions: null,
      audio: null,
    },
    {
      id: "scene-02",
      index: 1,
      startFrame: 90,
      durationInFrames: 120,
      component: "Paragraph",
      props: { text: "测试 2" },
      animation: { entrance: "fade", emphasis: "none", exit: "none" },
      captions: null,
      audio: null,
    },
  ],
};

describe("renderPlanToVideo (todo 10)", () => {
  let outDir: string;
  let mp4Path: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), "vf-render-"));
    mp4Path = path.join(outDir, "out.mp4");
    await renderPlanToVideo(samplePlan, mp4Path);
  }, 120_000);

  afterAll(() => {
    // best-effort cleanup (no rm available in vitest by default; tmpdir is auto-cleaned)
  });

  it("produces a 1920x1080 30fps MP4 with duration ~7s", () => {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration",
        "-of",
        "json",
        mp4Path,
      ],
      { encoding: "utf8" },
    );
    const s = JSON.parse(out).streams[0];
    expect(s.width).toBe(1920);
    expect(s.height).toBe(1080);
    expect(s.r_frame_rate).toBe("30/1");
    expect(Math.abs(parseFloat(s.duration) - 7.0)).toBeLessThan(0.2);
  });
});
