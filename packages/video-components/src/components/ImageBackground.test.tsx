import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageBackground } from "./ImageBackground.js";

const SRC = "data:image/png;base64,iVBORw0KGgo=";

describe("ImageBackground Ken-Burns scale", () => {
  it("mid-scene the eased push-in sits at half the range (scale 1.06)", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground kenBurnsScale={0.12} src={SRC} startFrame={0} frame={500} durationInFrames={1000} />,
    );
    expect(markup).toContain("scale(1.06");
  });

  it("end-frame reaches the full 0.12 push (scale 1.12)", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground kenBurnsScale={0.12} src={SRC} startFrame={0} frame={1000} durationInFrames={1000} />,
    );
    expect(markup).toContain("scale(1.12");
  });

  it("defaults to the full image without zoom", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground src={SRC} startFrame={0} frame={1000} durationInFrames={1000} />,
    );
    expect(markup).toContain("object-fit:contain");
    expect(markup).not.toContain("scale(1.");
  });

  it("uses only the theme background when an image is unavailable", () => {
    const markup = renderToStaticMarkup(
      <ImageBackground startFrame={0} frame={0} durationInFrames={60} />,
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("border-radius:50%");
    expect(markup).not.toContain("<svg");
  });
});
