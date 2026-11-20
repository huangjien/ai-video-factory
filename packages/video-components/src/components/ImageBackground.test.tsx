import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageBackground } from "./ImageBackground.js";

const SRC = "data:image/png;base64,iVBORw0KGgo=";

describe("ImageBackground Ken-Burns scale", () => {
  it("mid-scene the eased push-in sits at half the range (scale 1.06)", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground src={SRC} startFrame={0} frame={500} durationInFrames={1000} />,
    );
    expect(markup).toContain("scale(1.06");
  });

  it("end-frame reaches the full 0.12 push (scale 1.12)", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground src={SRC} startFrame={0} frame={1000} durationInFrames={1000} />,
    );
    expect(markup).toContain("scale(1.12");
  });

  it("kenBurnsScale 0 renders a bare img (no zoom wrapper)", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground src={SRC} startFrame={0} frame={1000} durationInFrames={1000} kenBurnsScale={0} />,
    );
    // The still path skips the Ken-Burns transform entirely — no scale()
    // appears in the wrapper's inline style.
    expect(markup).not.toContain("scale(1.");
  });
});
