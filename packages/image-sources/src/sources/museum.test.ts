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
        primaryImage: "https://images.metmuseum.org/CRDImages/ep/original/DP-1.jpg",
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

  it("survives an empty payload", () => {
    expect(parseOpenverseResults({}, "q")).toEqual([]);
    expect(parseOpenverseResults({ results: [] }, "q")).toEqual([]);
  });
});
