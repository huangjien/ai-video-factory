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
 * Precedence: the narration track wins. It carries the full narration —
 * the same cues the exported SRT is built from — while the component's
 * `caption` prop is the scene's short static label (a few words for the
 * whole scene), which reads as noise next to a real subtitle. The label
 * survives only when the scene has no cue track at all (placeholder
 * images with no narration).
 */

const IMAGE = "ImageBackground";
const OTHER = "Callout";
const CAPTIONS = {
  cues: [{ lines: ["一段很长的旁白字幕"], startSec: 0, endSec: 1 }],
} as RenderPlanScene["captions"];

describe("sceneCaptionOwner — the narration track beats the component's label", () => {
  it("gives the bottom line to the track on an image scene with both sources", () => {
    expect(
      sceneCaptionOwner(IMAGE, { caption: "一个技能 = 一个文件夹" }, CAPTIONS),
    ).toBe("track");
  });

  it("gives a NON-image scene to the track even if props carry a caption", () => {
    // No other registered component draws a `caption`, so the track is the
    // only caption that would appear.
    expect(sceneCaptionOwner(OTHER, { caption: "ignored" }, CAPTIONS)).toBe(
      "track",
    );
  });

  it("falls back to the component label when the scene has no cue track", () => {
    expect(sceneCaptionOwner(IMAGE, { caption: "短标签" }, null)).toBe(
      "component",
    );
    expect(
      sceneCaptionOwner(IMAGE, { caption: "短标签" }, { cues: [] }),
    ).toBe("component");
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

  it("prefers the track even when it has several lines", () => {
    const many = {
      cues: [{ lines: ["第一行", "第二行", "第三行"], startSec: 0, endSec: 1 }],
    } as RenderPlanScene["captions"];
    expect(sceneCaptionOwner(IMAGE, { caption: "短标签" }, many)).toBe(
      "track",
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

  it("strips the caption from the component when the track owns it", () => {
    const w = captionWiring(
      IMAGE,
      { caption: "一个技能 = 一个文件夹" },
      CAPTIONS,
    );
    expect(w.owner).toBe("track");
    expect(w.componentPropOverride).toStrictEqual({ caption: undefined });
    expect(w.renderTrack).toBe(true);
  });

  it("renders the track and needs no override when the component has no caption", () => {
    const w = captionWiring(IMAGE, {}, CAPTIONS);
    expect(w.owner).toBe("track");
    expect(w.componentPropOverride).toStrictEqual({ caption: undefined });
    expect(w.renderTrack).toBe(true);
  });

  it("keeps the component's caption when there is no track to compete", () => {
    // No track at all ⇒ the label is the only caption, so it stays
    // (placeholder-image fallback).
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
