import { describe, expect, it } from "vitest";
import type { RenderPlanScene } from "@video/vdsl";
import { captionWiring, sceneCaptionOwner } from "./Root.js";

/**
 * A generated-image scene can reach a caption twice: once from the
 * `CaptionsOverlay` track, once from `ImageBackground`'s own `caption` prop
 * (which `video make` fills by copying the scene's text into it). Both draw
 * at the bottom of the frame, so a scene carrying both rendered two different
 * lines on top of each other — literally unreadable, on every image scene in
 * the shipped projects.
 *
 * Precedence: the component's own caption wins. It carries the scene's
 * `caption:` field — the human's short on-screen label, a few words — while
 * the track falls back to the narration when `captions.source` is
 * `narration`, which is a sentence or two and far too long to burn in. The
 * track still owns every non-image scene.
 */

const IMAGE = "ImageBackground";
const OTHER = "Callout";
const CAPTIONS = {
  cues: [
    { lines: ["一段很长的旁白字幕"], startSec: 0, endSec: 1 },
  ],
} as RenderPlanScene["captions"];

describe("sceneCaptionOwner — the component's label beats the narration track", () => {
  it("gives an image scene to the component when it has a caption", () => {
    expect(
      sceneCaptionOwner(IMAGE, { caption: "一个技能 = 一个文件夹" }, CAPTIONS),
    ).toBe("component");
  });

  it("gives a NON-image scene to the track even if props carry a caption", () => {
    // No other registered component draws a `caption`, so the track is the
    // only caption that would appear.
    expect(sceneCaptionOwner(OTHER, { caption: "ignored" }, CAPTIONS)).toBe(
      "track",
    );
  });

  it("falls back to the track when the image scene has no caption", () => {
    expect(sceneCaptionOwner(IMAGE, {}, CAPTIONS)).toBe("track");
    expect(sceneCaptionOwner(IMAGE, undefined, CAPTIONS)).toBe("track");
  });

  it("treats a blank caption as no caption", () => {
    expect(sceneCaptionOwner(IMAGE, { caption: "" }, CAPTIONS)).toBe("track");
    expect(sceneCaptionOwner(IMAGE, { caption: "   " }, CAPTIONS)).toBe(
      "track",
    );
  });

  it("ignores a non-string caption rather than rendering an object", () => {
    expect(sceneCaptionOwner(IMAGE, { caption: 42 }, CAPTIONS)).toBe("track");
  });

  it("draws nothing when neither source has text", () => {
    expect(sceneCaptionOwner(IMAGE, {}, null)).toBe("none");
    expect(
      sceneCaptionOwner(OTHER, {}, {
        cues: [],
      } as RenderPlanScene["captions"]),
    ).toBe("none");
  });

  it("prefers the component even when the track has several lines", () => {
    const many = {
      cues: [{ lines: ["第一行", "第二行", "第三行"], startSec: 0, endSec: 1 }],
    } as RenderPlanScene["captions"];
    expect(sceneCaptionOwner(IMAGE, { caption: "短标签" }, many)).toBe(
      "component",
    );
  });
});
describe("captionWiring — both halves of the decision together", () => {
  // `scene.props` is spread into `baseProps` FIRST, so the owner decision
  // has to actively unset the prop when the component should not draw it.
  // Inverting that override is invisible to `sceneCaptionOwner`'s tests: the
  // component loses its caption while the track stays gated off, and the
  // scene renders with no text at all. It is asserted here, and it was
  // caught by rendering a still rather than by a unit test.

  it("keeps the caption on the component and gates the track off", () => {
    const w = captionWiring(
      IMAGE,
      { caption: "一个技能 = 一个文件夹" },
      CAPTIONS,
    );
    expect(w.owner).toBe("component");
    expect(w.componentPropOverride).toStrictEqual({});
    expect(w.renderTrack).toBe(false);
  });

  it("strips the caption from the component when the track owns it", () => {
    const w = captionWiring(IMAGE, {}, CAPTIONS);
    expect(w.owner).toBe("track");
    expect(w.componentPropOverride).toStrictEqual({ caption: undefined });
    expect(w.renderTrack).toBe(true);
  });

  it("keeps the component's caption when there is no track to compete", () => {
    // No track at all ⇒ nothing to overlap with, so the label stays.
    const w = captionWiring(IMAGE, { caption: "一个技能 = 一个文件夹" }, null);
    expect(w.owner).toBe("component");
    expect(w.componentPropOverride).toStrictEqual({});
    expect(w.renderTrack).toBe(false);
  });

  it("never lets both layers draw at once, for any combination", () => {
    const propSets: (Record<string, unknown> | undefined)[] = [
      { caption: "短标签" },
      {},
      undefined,
    ];
    const capSets: RenderPlanScene["captions"][] = [
      CAPTIONS,
      null,
      { cues: [] },
      { cues: [{ lines: ["a", "b", "c"], startSec: 0, endSec: 1 }] },
    ];
    for (const comp of [IMAGE, OTHER]) {
      for (const props of propSets) {
        for (const caps of capSets) {
          const w = captionWiring(comp, props, caps);
          const label = `${comp} ${JSON.stringify(props)} ${JSON.stringify(caps)}`;
          const componentDraws = w.owner === "component";
          expect(componentDraws && w.renderTrack, label).toBe(false);
          if (w.owner === "component") {
            expect(w.componentPropOverride, label).toStrictEqual({});
          } else {
            expect(w.componentPropOverride, label).toStrictEqual({
              caption: undefined,
            });
          }
          expect(w.renderTrack, label).toBe(w.owner === "track");
        }
      }
    }
  });
});
