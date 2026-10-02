import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RenderPlan } from "@vf/vdsl";
import { renderSceneToVideo } from "./render.js";

/** T4.4 acceptance (§18 "hand-drawn"): a canvas/DoodleScene renders a 5s
 * hand-drawn-style MP4 through the normal pipeline. */
const doodlePlan: RenderPlan = {
  project: {
    id: "doodle-fixture",
    language: "zh-CN",
    fps: 30,
    width: 640,
    height: 360,
  },
  style: { theme: "dark-tech" },
  totalFrames: 150,
  scenes: [
    {
      id: "scene-01",
      index: 0,
      startFrame: 0,
      durationInFrames: 150,
      component: "DoodleScene",
      renderer: "canvas",
      props: {
        background: "paper",
        seed: 7,
        strokes: [
          { id: "sun", shape: "circle", x: 420, y: 200, size: 90, color: "#B8860B" },
          { id: "ground", shape: "zigzag", x: 320, y: 280, size: 60 },
          { id: "spark", shape: "star", x: 200, y: 140, size: 70 },
        ],
      },
      animation: { entrance: "none", emphasis: "none", exit: "none" },
      animations: [],
      transition: null,
      captions: null,
      audio: null,
    },
  ],
};

describe("canvas renderer family (T4.4)", () => {
  it("renders a 5s hand-drawn DoodleScene standalone", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "vf-doodle-"));
    const mp4Path = path.join(outDir, "doodle.mp4");
    await renderSceneToVideo(doodlePlan, "scene-01", mp4Path);
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration",
        "-of", "json", mp4Path,
      ],
      { encoding: "utf8" },
    );
    const s = JSON.parse(out).streams[0];
    expect(s.width).toBe(640);
    expect(s.height).toBe(360);
    expect(s.r_frame_rate).toBe("30/1");
    expect(Math.abs(parseFloat(s.duration) - 5)).toBeLessThan(0.2);
  }, 120_000);
});
