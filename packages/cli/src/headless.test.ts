import { afterEach, describe, expect, it } from "vitest";
import { isHeadless } from "./headless.js";

describe("isHeadless", () => {
  const original = process.env.VIDEO_HEADLESS;
  afterEach(() => {
    if (original === undefined) delete process.env.VIDEO_HEADLESS;
    else process.env.VIDEO_HEADLESS = original;
  });

  it("is off unless the variable says otherwise", () => {
    delete process.env.VIDEO_HEADLESS;
    expect(isHeadless()).toBe(false);
    process.env.VIDEO_HEADLESS = "0";
    expect(isHeadless()).toBe(false);
    process.env.VIDEO_HEADLESS = "false";
    expect(isHeadless()).toBe(false);
    process.env.VIDEO_HEADLESS = "off";
    expect(isHeadless()).toBe(false);
    process.env.VIDEO_HEADLESS = "";
    expect(isHeadless()).toBe(false);
  });

  it("is on for the usual truthy spellings", () => {
    process.env.VIDEO_HEADLESS = "1";
    expect(isHeadless()).toBe(true);
    process.env.VIDEO_HEADLESS = "true";
    expect(isHeadless()).toBe(true);
    process.env.VIDEO_HEADLESS = "yes";
    expect(isHeadless()).toBe(true);
  });
});
