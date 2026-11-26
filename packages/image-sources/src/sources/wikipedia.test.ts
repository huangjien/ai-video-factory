import { describe, expect, it } from "vitest";
import { commonsFileTitle, parseCommonsTitleResponse } from "./wikipedia.js";

describe("commonsFileTitle", () => {
  it("maps a Commons-hosted image to its file title", () => {
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.jpg",
      ),
    ).toBe("File:Portrait.jpg");
  });

  it("decodes a percent-encoded file name", () => {
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/commons/1/12/Li_Shimin%2C_Tang.jpg",
      ),
    ).toBe("File:Li_Shimin,_Tang.jpg");
  });

  it("rejects a non-Commons upload — a fair-use file has no Commons record", () => {
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/en/3/3a/Example.jpg",
      ),
    ).toBeNull();
    expect(commonsFileTitle("https://example.com/a.jpg")).toBeNull();
  });
});

describe("parseCommonsTitleResponse", () => {
  it("reads the license off the Commons file record", () => {
    const candidate = parseCommonsTitleResponse(
      {
        query: {
          pages: [
            {
              title: "File:Portrait.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.jpg",
                  descriptionurl:
                    "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
                  width: 800,
                  height: 1000,
                  extmetadata: {
                    License: { value: "cc0" },
                    Artist: { value: "Anonymous" },
                  },
                },
              ],
            },
          ],
        },
      },
      "File:Portrait.jpg",
    );
    expect(candidate?.license).toBe("CC0");
    expect(candidate?.author).toBe("Anonymous");
    expect(candidate?.source).toBe("wikipedia");
  });

  it("returns null when the file is not on Commons", () => {
    expect(
      parseCommonsTitleResponse({ query: { pages: [] } }, "File:X"),
    ).toBeNull();
    expect(parseCommonsTitleResponse({}, "File:X")).toBeNull();
  });

  it("returns null for a file Wikipedia flags as copyrighted", () => {
    const candidate = parseCommonsTitleResponse(
      {
        query: {
          pages: [
            {
              title: "File:Portrait.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Portrait.jpg",
                  extmetadata: {
                    License: { value: "cc-by-4.0" },
                    Copyrighted: { value: "True" },
                  },
                },
              ],
            },
          ],
        },
      },
      "File:Portrait.jpg",
    );
    expect(candidate).toBeNull();
  });
});
