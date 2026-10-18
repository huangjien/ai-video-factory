import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  BgmTimelineError,
  buildBgmTimelineArgs,
  planBgmWindows,
  renderBgmTimeline,
} from "./bgm-timeline.js";

const execFileAsync = promisify(execFile);
const resolve = (track: string) => `/assets/${track}.wav`;

describe("planBgmWindows", () => {
  it("cuts ordered windows and runs the last one to the end", () => {
    const w = planBgmWindows(
      [
        { track: "calm", until_sec: 18 },
        { track: "epic" },
      ],
      332,
      resolve,
    );
    expect(w).toEqual([
      { path: "/assets/calm.wav", startSec: 0, endSec: 18 },
      { path: "/assets/epic.wav", startSec: 18, endSec: 332 },
    ]);
  });

  it("keeps going for three tracks", () => {
    const w = planBgmWindows(
      [
        { track: "a", until_sec: 10 },
        { track: "b", until_sec: 20 },
        { track: "c" },
      ],
      30,
      resolve,
    );
    expect(w.map((x) => x.path)).toEqual([
      "/assets/a.wav",
      "/assets/b.wav",
      "/assets/c.wav",
    ]);
    expect(w[2]!.endSec).toBe(30);
  });

  it("throws on non-ascending until_sec", () => {
    expect(() =>
      planBgmWindows(
        [
          { track: "a", until_sec: 20 },
          { track: "b", until_sec: 10 },
        ],
        60,
        resolve,
      ),
    ).toThrow(BgmTimelineError);
  });

  it("throws when a mid-list entry omits until_sec", () => {
    expect(() =>
      planBgmWindows([{ track: "a" }, { track: "b" }], 60, resolve),
    ).toThrow(/only the LAST entry/);
  });

  it("throws on an empty track list", () => {
    expect(() => planBgmWindows([], 60, resolve)).toThrow(/empty/);
  });
});

describe("buildBgmTimelineArgs", () => {
  it("builds a looped, trimmed, real-acrossfade filtergraph", () => {
    const windows = planBgmWindows(
      [
        { track: "calm", until_sec: 18 },
        { track: "epic" },
      ],
      40,
      resolve,
    );
    const { args, filter } = buildBgmTimelineArgs(windows, "/out/tl.wav", {
      crossfadeSec: 1,
    });
    expect(args.filter((a) => a === "-stream_loop")).toHaveLength(2);
    expect(args).toContain("/assets/calm.wav");
    expect(args).toContain("/assets/epic.wav");
    expect(filter).toContain("[0:a]aresample=44100");
    // Window 0 extends by the 1s crossfade (18+1); the last does not.
    expect(filter).toContain("atrim=duration=19.000");
    expect(filter).toContain("atrim=duration=22.000");
    // One real crossfade at the boundary — NOT the old fade-out+fade-in
    // pair that dipped both sides to silence.
    expect(filter).toContain("acrossfade=d=1.000:c1=tri:c2=tri[out]");
    expect(filter).not.toContain("afade");
    expect(filter).not.toContain("concat=");
    expect(args[args.length - 1]).toBe("/out/tl.wav");
  });

  it("caps the crossfade at the shortest window", () => {
    const windows = [
      { path: "/a.wav", startSec: 0, endSec: 0.4 },
      { path: "/b.wav", startSec: 0.4, endSec: 5 },
    ];
    const { filter } = buildBgmTimelineArgs(windows, "/out/t.wav", {
      crossfadeSec: 1,
    });
    // acrossfade needs every input ≥ d, so a 0.4s window caps d at 0.4.
    expect(filter).toContain("acrossfade=d=0.400");
  });
});

describe("renderBgmTimeline (ffmpeg)", () => {
  it("concatenates two sine beds into one timeline wav of the planned length", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bgm-tl-"));
    try {
      const mk = async (name: string, freq: string) => {
        const p = path.join(dir, name);
        await execFileAsync("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${freq}:duration=5`,
          "-ac",
          "2",
          p,
        ]);
        return p;
      };
      const a = await mk("a.wav", "440");
      const b = await mk("b.wav", "660");
      const windows = [
        { path: a, startSec: 0, endSec: 4 },
        { path: b, startSec: 4, endSec: 7 },
      ];
      const out = await renderBgmTimeline(windows, path.join(dir, "tl.wav"));
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        out,
      ]);
      const dur = Number.parseFloat(stdout);
      expect(dur).toBeGreaterThan(6.8);
      expect(dur).toBeLessThan(7.3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
