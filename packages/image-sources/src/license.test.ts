import { describe, expect, it } from "vitest";
import {
  FREE_LICENSES,
  isFreeLicense,
  normalizeLicense,
  OWNED_LICENSE,
} from "./license.js";

describe("normalizeLicense", () => {
  it("maps every Wikimedia vocabulary onto one code", () => {
    // The three shapes a license arrives in.
    expect(normalizeLicense("pd-old-100")).toBe("PD");
    expect(normalizeLicense("Public domain")).toBe("PD");
    expect(normalizeLicense("cc0")).toBe("CC0");
    expect(normalizeLicense("CC0")).toBe("CC0");
    expect(normalizeLicense("pdm")).toBe("PDM");
    expect(normalizeLicense("Public Domain Mark")).toBe("PDM");
  });

  it("does not read a PDM as a PD — the mark is checked first", () => {
    // "Public Domain Mark" CONTAINS "public domain"; the order matters.
    expect(normalizeLicense("Public Domain Mark 1.0")).toBe("PDM");
    expect(normalizeLicense("Public domain")).toBe("PD");
  });

  it("keeps an unknown license unknown", () => {
    expect(normalizeLicense("")).toBe("");
    expect(normalizeLicense("CC BY-SA 4.0")).toBe("CC BY-SA 4.0");
  });
});

describe("isFreeLicense", () => {
  it("accepts only the public-domain family", () => {
    expect(isFreeLicense("pd-old-100")).toBe(true);
    expect(isFreeLicense("cc0")).toBe(true);
    expect(isFreeLicense("pdm")).toBe(true);
  });

  it("rejects the licenses that oblige a credit line", () => {
    // "No copyright issue" means no credit line to maintain either.
    expect(isFreeLicense("CC BY 4.0")).toBe(false);
    expect(isFreeLicense("cc-by-sa-4.0")).toBe(false);
    expect(isFreeLicense("Fair use")).toBe(false);
    expect(isFreeLicense("")).toBe(false);
  });

  it("honours an explicit allowlist", () => {
    expect(isFreeLicense("CC BY 4.0", [...FREE_LICENSES, "CC BY 4.0"])).toBe(
      true,
    );
  });

  it("keeps the project-owned marker out of the free list", () => {
    // OWNED is not a third-party license — it is handled by the owned
    // flag on the candidate, never by the license filter.
    expect(isFreeLicense(OWNED_LICENSE)).toBe(false);
  });
});
