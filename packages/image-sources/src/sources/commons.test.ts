import { describe, expect, it } from "vitest";
import { parseCommonsResponse } from "./commons.js";

/** A Commons `action=query` response as the API returns it (v2 output). */
function response(
  overrides: Record<string, unknown> = {},
  meta: Record<string, { value: string }> = {},
): unknown {
  return {
    query: {
      pages: [
        {
          pageid: 1,
          title: "File:Portrait of Li Shimin.jpg",
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.jpg",
              thumburl:
                "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Portrait.jpg/1600px-Portrait.jpg",
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Portrait_of_Li_Shimin.jpg",
              width: 2400,
              height: 3000,
              extmetadata: {
                License: { value: "pd-old-100" },
                LicenseShortName: { value: "Public domain" },
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">X</a>' },
                LicenseUrl: { value: "https://en.wikipedia.org/wiki/Public_domain" },
                ...meta,
              },
            },
          ],
          ...overrides,
        },
      ],
    },
  };
}

describe("parseCommonsResponse", () => {
  it("reads the license, the author and the thumbnail URL", () => {
    const out = parseCommonsResponse(response(), "li shimin portrait");
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.source).toBe("commons");
    expect(c.license).toBe("PD");
    expect(c.author).toBe("X");
    // The HTML in the artist field is stripped, the tags are not kept.
    expect(c.author).not.toContain("<");
    expect(c.licenseUrl).toContain("Public_domain");
    expect(c.title).toBe("Portrait of Li Shimin.jpg");
    // The scaled thumbnail is preferred over the master file.
    expect(c.fileUrl).toContain("1600px-Portrait.jpg");
    expect(c.pageUrl).toContain("File:Portrait_of_Li_Shimin.jpg");
    expect(c.owned).toBe(false);
    expect(c.digestKey).toContain("PD");
  });

  it("drops a file Wikimedia flags as copyrighted", () => {
    const out = parseCommonsResponse(
      response({}, { Copyrighted: { value: "True" } }),
      "q",
    );
    expect(out).toHaveLength(0);
  });

  it("falls back to the short license name when the code is absent", () => {
    const out = parseCommonsResponse(
      response({}, { License: { value: "" } }),
      "q",
    );
    expect(out[0]?.license).toBe("PD");
  });

  it("survives a response that is not a Commons payload", () => {
    expect(parseCommonsResponse({}, "q")).toEqual([]);
    expect(parseCommonsResponse(null, "q")).toEqual([]);
    expect(parseCommonsResponse({ query: {} }, "q")).toEqual([]);
  });
});
