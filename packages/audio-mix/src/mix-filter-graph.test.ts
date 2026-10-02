import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUCKER_THRESHOLD_DB,
  buildBgmFadeChain,
  buildBgmSegments,
  buildMixFilterGraph,
  dbToLinear,
} from "./mix.js";

/** Pure filter-graph tests — no ffmpeg. They pin the string contracts the
 * mixers hand to `ffmpeg -filter_complex`:
 *   - amix must carry normalize=0 (default scaling drops narration 6 dB)
 *   - the BGM chain must be padded to the narration length so fades land
 *   - the sidechain threshold must be linear, not dB */
describe("mix filter graphs — string contracts", () => {
  it("keeps both inputs at unity with normalize=0 in the basic mix", () => {
    const filter = buildMixFilterGraph({
      bgmLinear: "0.1259",
      duckerThreshold: "0.05",
    });
    expect(filter).toContain(
      "[0:a][bgm]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[out]",
    );
    expect(filter).toContain("sidechaincompress=threshold=0.05:");
  });

  it("pads the BGM to the narration length so a short BGM spans the video", () => {
    const segments = buildBgmSegments({
      bgmLinear: "0.1259",
      duckerThreshold: "0.05",
      narrationDurationSec: 10,
    });
    expect(segments).toEqual([
      "[1:a]aresample=44100,volume=0.1259,apad=whole_dur=10[bgm_pre]",
      "[bgm_pre][nar]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=400[bgm]",
    ]);
  });

  it("computes the fade-out against the padded (narration) length", () => {
    // 10s narration, BGM file only 4s: before the apad fix, st=8 fell past
    // the BGM's end and the fade silently never fired.
    const fade = buildBgmFadeChain({
      narrationDurationSec: 10,
      fadeInSec: 0.5,
      fadeOutSec: 2,
    });
    expect(fade.segments).toEqual([
      "[bgm]afade=in:st=0:d=0.5[bgm_fi]",
      "[bgm_fi]afade=out:st=8:d=2[bgm_fo]",
    ]);
    expect(fade.outputLabel).toBe("bgm_fo");
  });

  it("clamps the fade-out start at 0 for very short narrations", () => {
    const fade = buildBgmFadeChain({
      narrationDurationSec: 1,
      fadeInSec: 0,
      fadeOutSec: 2,
    });
    expect(fade.segments).toEqual(["[bgm]afade=out:st=0:d=2[bgm_fo]"]);
    expect(fade.outputLabel).toBe("bgm_fo");
  });

  it("labels a fade-in-only chain and leaves the BGM untouched without fades", () => {
    expect(
      buildBgmFadeChain({
        narrationDurationSec: 10,
        fadeInSec: 1,
        fadeOutSec: 0,
      }),
    ).toEqual({
      segments: ["[bgm]afade=in:st=0:d=1[bgm_fi]"],
      outputLabel: "bgm_fi",
    });
    expect(
      buildBgmFadeChain({
        narrationDurationSec: 10,
        fadeInSec: 0,
        fadeOutSec: 0,
      }),
    ).toEqual({ segments: [], outputLabel: "bgm" });
  });

  it("converts the ducker threshold default from dB to a linear 0.05", () => {
    // sidechaincompress expects linear amplitude in [0.000976563, 1];
    // -26 dB ≈ 0.0501 reproduces the pre-fix default (0.05, tuned linear).
    expect(parseFloat(dbToLinear(DEFAULT_DUCKER_THRESHOLD_DB))).toBeCloseTo(
      0.05,
      2,
    );
  });
});
