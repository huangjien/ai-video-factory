import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RenderPlan } from "@video/vdsl";
import { renderSceneToVideo } from "./render.js";

/** T4.3 acceptance: a whiteboard/diagram scene — arrow draws on — renders
 * as a standalone MP4 through the normal pipeline. */
const svgScenePlan: RenderPlan = {
  project: {
    id: "svg-fixture",
    language: "zh-CN",
    fps: 30,
    width: 640,
    height: 360,
  },
  style: { theme: "dark-tech" },
  totalFrames: 90,
  scenes: [
    {
      id: "scene-01",
      index: 0,
      startFrame: 0,
      durationInFrames: 90,
      component: "SvgScene",
      renderer: "svg",
      props: {
        title: "MCP 请求流",
        nodes: [
          { id: "agent", kind: "rect", x: 60, y: 120, w: 180, h: 90, text: "Agent" },
          { id: "server", kind: "rect", x: 380, y: 120, w: 180, h: 90, text: "MCP Server" },
        ],
        edges: [{ id: "arrow-1", from: "agent", to: "server", label: "request" }],
      },
      animation: { entrance: "none", emphasis: "none", exit: "none" },
      animations: [
        {
          id: "draw-arrow",
          target: "arrow-1",
          type: "draw",
          start: 1,
          duration: 1.5,
          easing: "easeInOut",
        },
      ],
      transition: null,
      captions: null,
      audio: null,
    },
  ],
};

describe("svg renderer family (T4.3)", () => {
  it("renders an svg/SvgScene standalone: 3s MP4, geometry correct", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "video-svg-"));
    const mp4Path = path.join(outDir, "scene.mp4");
    await renderSceneToVideo(svgScenePlan, "scene-01", mp4Path);
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
    expect(Math.abs(parseFloat(s.duration) - 3)).toBeLessThan(0.2);
  }, 120_000);

  it("still fails loudly for genuinely unwired renderer combinations", async () => {
    const plan: RenderPlan = {
      ...svgScenePlan,
      scenes: [
        { ...svgScenePlan.scenes[0]!, renderer: "canvas", component: "SvgScene" },
      ],
    };
    await expect(
      renderSceneToVideo(plan, "scene-01", "/tmp/video-svg-unwired.mp4"),
    ).rejects.toThrow(/not wired yet/);
  });
});
