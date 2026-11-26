import { describe, expect, it } from "vitest";
import {
  parseMetObject,
  parseOpenverseResults,
  parseSmithsonianObject,
} from "./museum.js";

describe("parseMetObject", () => {
  it("accepts a public-domain object", () => {
    const c = parseMetObject(
      {
        objectID: 1,
        title: "Portrait of a Man",
        artistDisplayName: "Anonymous",
        isPublicDomain: true,
        primaryImage:
          "https://images.metmuseum.org/CRDImages/ep/original/DP-1.jpg",
        objectURL: "https://www.metmuseum.org/art/collection/search/1",
      },
      "portrait",
    );
    expect(c?.license).toBe("PD");
    expect(c?.source).toBe("met");
    expect(c?.author).toBe("Anonymous");
  });

  it("rejects an object the museum does not mark public domain", () => {
    // A record with no license statement is not a free license.
    expect(
      parseMetObject(
        { objectID: 2, title: "A Loan", primaryImage: "https://x/y.jpg" },
        "q",
      ),
    ).toBeNull();
    expect(
      parseMetObject(
        {
          objectID: 3,
          title: "A Loan",
          isPublicDomain: false,
          primaryImage: "https://x/y.jpg",
        },
        "q",
      ),
    ).toBeNull();
  });
});

describe("parseSmithsonianObject", () => {
  it("accepts a CC0 object", () => {
    const c = parseSmithsonianObject(
      {
        title: "A Portrait",
        url: "https://www.si.edu/object/x",
        contentUrl: "https://ids.si.edu/ids/deliveryService/x.jpg",
        usage: { access: "Usage conditions apply", termsOfUse: "CC0 1.0" },
      },
      "portrait",
    );
    expect(c?.license).toBe("CC0");
    expect(c?.source).toBe("smithsonian");
  });

  it("rejects an object whose terms are not CC0", () => {
    expect(
      parseSmithsonianObject(
        {
          title: "A Portrait",
          contentUrl: "https://ids.si.edu/ids/deliveryService/x.jpg",
          usage: { termsOfUse: "Usage conditions apply" },
        },
        "q",
      ),
    ).toBeNull();
  });
});

describe("parseOpenverseResults", () => {
  it("keeps the per-item license", () => {
    const out = parseOpenverseResults(
      {
        results: [
          {
            title: "Portrait",
            url: "https://example.com/a.jpg",
            thumbnail: "https://example.com/a-thumb.jpg",
            foreign_landing_url: "https://example.com/a",
            creator: "Someone",
            license: "cc0",
            license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
            width: 1000,
            height: 1200,
          },
        ],
      },
      "portrait",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.license).toBe("CC0");
    expect(out[0]?.owned).toBe(false);
  });

  it("skips a vector original — Openverse cannot rasterize it either", () => {
    // Wikimedia's own file for the Mask of Tutankhamun is an SVG, and
    // Openverse's thumbnail endpoint answers 424 for exactly that file.
    // Offering it would produce a candidate that can never be used.
    const out = parseOpenverseResults(
      {
        results: [
          {
            title: "Mask of Tutankhamun",
            url: "https://upload.wikimedia.org/wikipedia/commons/6/68/Mask_of_Tutankhamun.svg",
            thumbnail: "https://api.openverse.org/v1/images/e58c93e8/thumb/",
            foreign_landing_url: "https://example.com/mask",
            creator: "",
            license: "cc0",
            width: 640,
            height: 900,
          },
          {
            title: "Funeral mask",
            url: "https://live.staticflickr.org/578/21871530520_b.jpg",
            thumbnail: "https://live.staticflickr.org/578/21871530520_b.jpg",
            foreign_landing_url: "https://example.com/funeral",
            creator: "Someone",
            license: "cc0",
            width: 1024,
            height: 1024,
          },
        ],
      },
      "mask of tutankhamun",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.fileUrl).toContain("staticflickr");
  });

  it("survives an empty payload", () => {
    expect(parseOpenverseResults({}, "q")).toEqual([]);
    expect(parseOpenverseResults({ results: [] }, "q")).toEqual([]);
  });
});
