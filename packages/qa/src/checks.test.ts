import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import type { RenderPlan } from "@video/vdsl";
import {
  buildRenderReport,
  checkCaptions,
  checkSceneAudioSync,
  checkSceneBoundaries,
  parseSrt,
} from "./index.js";

const execFileAsync = promisify(execFile);

/** Fixture: 2s test pattern + 1s true black, hard cut at 2.0s — the
 * "injected defect" video for §28/T6.1 acceptance. */
async function makeFixtureVideo(outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2",
    "-f", "lavfi", "-i", "color=black:size=320x180:rate=30:duration=1",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[out]",
    "-map", "[out]",
    "-pix_fmt", "yuv420p",
    outPath,
  ]);
}

function plan(scenes: Partial<RenderPlan["scenes"][number]>[] = []): RenderPlan {
  return {
    project: { id: "qa", language: "zh-CN", fps: 30, width: 320, height: 180 },
    style: { theme: "dark-tech" },
    totalFrames: 90,
    scenes: scenes.length > 0
      ? (scenes.map((s, i) => ({
          id: `scene-0${i + 1}`,
          index: i,
          startFrame: i * 90,
          durationInFrames: 90,
          component: "Title",
          renderer: "remotion",
          props: {},
          animation: { entrance: "none", emphasis: "none", exit: "none" },
          animations: [],
          transition: null,
          captions: null,
          audio: null,
          ...s,
        })) as RenderPlan["scenes"])
      : [
          {
            id: "scene-01",
            index: 0,
            startFrame: 0,
            durationInFrames: 90,
            component: "Title",
            renderer: "remotion",
            props: {},
            animation: { entrance: "none", emphasis: "none", exit: "none" },
            animations: [],
            transition: null,
            captions: null,
            audio: null,
          },
        ],
  };
}

describe("T6.1 extended QA checks — injected defects are caught with fixes", () => {
  let dir: string;
  let video: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "video-qa-checks-"));
    video = path.join(dir, "fixture.mp4");
    await makeFixtureVideo(video);
  }, 60_000);

  it("parses SRT cues", () => {
    const cues = parseSrt(
      "1\n00:00:00,000 --> 00:00:02,000\nhello\n\n2\n00:00:02,000 --> 00:00:03,500\nworld\n",
    );
    expect(cues).toHaveLength(2);
    expect(cues[1]!.endSec).toBeCloseTo(3.5);
  });

  it("DEFECT 1 — narration longer than its scene is an error with a fix", async () => {
    // 3s narration WAV vs a 1s scene (30 frames @30fps).
    const wav = path.join(dir, "long.wav");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      wav,
    ]);
    mkdirSync(path.join(dir, "assets", "audio"), { recursive: true });
    const rel = path.join("assets", "audio", "long.wav");
    writeFileSync(path.join(dir, rel), readFileSync(wav));
    const p = plan([{ audio: rel, durationInFrames: 30 }]);
    const { findings } = await checkSceneAudioSync(p, dir);
    const hit = findings.find((f) => f.check === "sceneAudioSync");
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toMatch(/video make/);
  });

  it("DEFECT 2 — non-monotonic captions are an error with a fix", async () => {
    mkdirSync(path.join(dir, "captions"), { recursive: true });
    writeFileSync(
      path.join(dir, "captions", "zh-CN.srt"),
      "1\n00:00:02,000 --> 00:00:02,500\nlater\n\n2\n00:00:00,500 --> 00:00:01,000\nearlier\n",
    );
    const p = plan([{ captions: { lines: ["x"] } }]);
    const { findings } = await checkCaptions(p, dir, 3);
    const hit = findings.find((f) => f.message.includes("non-monotonic"));
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toContain("video make");
  });

  it("DEFECT 3 — captions ending past the video are a warn with a fix", async () => {
    writeFileSync(
      path.join(dir, "captions", "zh-CN.srt"),
      "1\n00:00:00,000 --> 00:00:09,900\nway past the 3s video\n",
    );
    const p = plan([{ captions: { lines: ["x"] } }]);
    const { findings } = await checkCaptions(p, dir, 3);
    const hit = findings.find((f) => f.message.includes("past the video") || f.message.includes("ends at"));
    expect(hit?.level).toBe("warn");
    expect(hit?.fix).toContain("video make");
  });

  it("DEFECT 4 — captions overflowing the safe area are an error", async () => {
    const p = plan([
      { captions: { lines: ["line1", "line2", "line3", "line4"] } },
    ]);
    const { findings } = await checkCaptions(p, dir, 3);
    const hit = findings.find((f) => f.check === "captionFit");
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toMatch(/Shorten|split/);
  });

  it("DEFECT 5 — missing referenced assets error with a fix (full report)", async () => {
    const p = plan([{ audio: "assets/audio/ghost.wav" }]);
    const report = await buildRenderReport(p, video);
    const hit = report.findings.find((f) => f.check === "assets");
    expect(hit?.level).toBe("error");
    expect(hit?.fix).toContain("video make");
    // black segment from the fixture is a warn with contact-sheet pointer
    const black = report.findings.find((f) => f.check === "blackFrames");
    expect(black).toBeDefined();
    expect(report.checks.blackFrames.length).toBeGreaterThanOrEqual(1);
  });

  it("scene-boundary detection finds the hard cut at 2.0s", async () => {
    const p = plan([
      {},
      { startFrame: 60, durationInFrames: 30 },
    ]);
    p.totalFrames = 90;
    const { checks } = await checkSceneBoundaries(p, video);
    expect(checks.expectedStartsSec).toEqual([2]);
    expect(
      checks.detectedCutsSec.some((d) => Math.abs(d - 2) <= 0.5),
    ).toBe(true);
    expect(checks.ok).toBe(true);
  });
});
