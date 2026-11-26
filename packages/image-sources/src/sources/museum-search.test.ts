import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MetPictureSource,
  OpenversePictureSource,
  SmithsonianPictureSource,
} from "./museum.js";

/** The network is the boundary under test: the stub answers each URL
 *  from a table, so a source's own request shape is what is asserted. */
const fetchMock = vi.hoisted(() => vi.fn());
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  fetchMock.mockReset();
});

/** Answer by URL substring; anything unlisted gets an empty object. */
function stubFetch(table: Record<string, unknown>): void {
  fetchMock.mockImplementation(async (url: string) => {
    const key = Object.keys(table).find((k) => url.includes(k));
    const body = key === undefined ? {} : table[key];
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const searchOpts = { limit: 5 };

describe("MetPictureSource.search", () => {
  const metObject = {
    objectID: 1,
    title: "A painting",
    primaryImage: "https://images.metmuseum.org/full.jpg",
    objectURL: "https://www.metmuseum.org/art/collection/search/1",
    isPublicDomain: true,
    artistDisplayName: "A Painter",
  };

  it("asks for objects with images and reads the first one", async () => {
    stubFetch({
      "/search": { objectIDs: [1] },
      "/objects/1": metObject,
    });
    const source = new MetPictureSource({ apiBase: "https://met.test" });
    const out = await source.search("Yama", searchOpts);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("met");
    expect(out[0]?.title).toBe("A painting");
    expect(out[0]?.license).toBe("PD");
    const asked = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(asked[0]).toContain("hasImages=true");
    expect(asked[0]).toContain("q=Yama");
  });

  it("asks for nothing when the query is blank", async () => {
    stubFetch({});
    const source = new MetPictureSource({ apiBase: "https://met.test" });
    expect(await source.search("   ", searchOpts)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing when the search lists no objects", async () => {
    stubFetch({ "/search": { objectIDs: [] } });
    const source = new MetPictureSource({ apiBase: "https://met.test" });
    expect(await source.search("Yama", searchOpts)).toEqual([]);
  });

  it("reads at most the number of objects it was configured for", async () => {
    stubFetch({
      "/search": { objectIDs: [1, 2, 3, 4, 5] },
      "/objects/": {
        ...metObject,
        primaryImage: "https://images.metmuseum.org/full.jpg",
      },
    });
    const source = new MetPictureSource({
      apiBase: "https://met.test",
      maxObjects: 2,
    });
    const out = await source.search("Yama", searchOpts);
    expect(out).toHaveLength(2);
  });

  it("skips an object the archive will not hand over", async () => {
    stubFetch({
      "/search": { objectIDs: [1] },
      "/objects/1": { ...metObject, primaryImage: "", isPublicDomain: false },
    });
    const source = new MetPictureSource({ apiBase: "https://met.test" });
    expect(await source.search("Yama", searchOpts)).toEqual([]);
  });
});

describe("SmithsonianPictureSource.search", () => {
  it("stays dark without a key, instead of asking a server that answers 403", async () => {
    stubFetch({});
    const source = new SmithsonianPictureSource({
      apiBase: "https://si.test",
      apiKey: "",
    });
    expect(await source.search("Yama", searchOpts)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a CC0 object the archive returned", async () => {
    stubFetch({
      "/search": {
        response: {
          rows: [
            {
              id: "edanmdm:1",
              content: {
                url: "https://ids.si.edu/ids/deliveryService?id=edanmdm-1",
              },
            },
          ],
        },
      },
      "/content/": {
        response: {
          content: {
            title: "A photograph",
            url: "https://www.si.edu/object/a-photograph",
            contentUrl: "https://ids.si.edu/ids/deliveryService?id=edanmdm-1",
            usage: { access: "CC0", termsOfUse: "Usage conditions apply." },
          },
        },
      },
    });
    const source = new SmithsonianPictureSource({
      apiBase: "https://si.test",
      apiKey: "key",
    });
    const out = await source.search("Yama", searchOpts);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("smithsonian");
    expect(out[0]?.license).toBe("CC0");
    expect(out[0]?.title).toBe("A photograph");
  });

  it("skips an object whose terms are not CC0", async () => {
    stubFetch({
      "/search": {
        response: {
          rows: [
            {
              id: "edanmdm:1",
              content: { url: "https://ids.si.edu/x/edanmdm-1" },
            },
          ],
        },
      },
      "/content/": {
        response: {
          content: {
            title: "Restricted",
            contentUrl: "https://ids.si.edu/x/1.jpg",
            usage: {
              access: "Usage conditions apply",
              termsOfUse: "No known restrictions",
            },
          },
        },
      },
    });
    const source = new SmithsonianPictureSource({
      apiBase: "https://si.test",
      apiKey: "key",
    });
    expect(await source.search("Yama", searchOpts)).toEqual([]);
  });
});

describe("OpenversePictureSource.search", () => {
  it("asks for the free licenses and reads the results", async () => {
    stubFetch({
      "/images/": {
        results: [
          {
            title: "A photograph",
            url: "https://upload.wikimedia.org/photo.jpg",
            thumbnail: "https://thumb.example/photo.jpg",
            foreign_landing_url:
              "https://commons.wikimedia.org/wiki/File:photo.jpg",
            creator: "A Photographer",
            license: "cc0",
            license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
            width: 800,
            height: 600,
          },
        ],
      },
    });
    const source = new OpenversePictureSource({ apiBase: "https://ov.test" });
    const out = await source.search("Yama", searchOpts);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("openverse");
    expect(out[0]?.license).toBe("CC0");
    expect(out[0]?.author).toBe("A Photographer");
    const asked = String(fetchMock.mock.calls[0]?.[0]);
    expect(asked).toContain("license=cc0%2Cpdm");
  });

  it("asks for nothing when the query is blank", async () => {
    stubFetch({});
    const source = new OpenversePictureSource({ apiBase: "https://ov.test" });
    expect(await source.search("", searchOpts)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills the optional fields the archive left out", async () => {
    stubFetch({
      "/images/": {
        results: [
          {
            title: "A picture",
            url: "https://upload.wikimedia.org/photo.jpg",
            thumbnail: "https://thumb.example/photo.jpg",
          },
        ],
      },
    });
    const source = new OpenversePictureSource({ apiBase: "https://ov.test" });
    const out = await source.search("Yama", searchOpts);
    expect(out).toHaveLength(1);
    expect(out[0]?.width).toBeNull();
    expect(out[0]?.height).toBeNull();
    expect(out[0]?.licenseUrl).toBe("");
    expect(out[0]?.author).toBe("");
  });

  it("returns nothing when the answer has no results list", async () => {
    stubFetch({ "/images/": { detail: "rate limited" } });
    const source = new OpenversePictureSource({ apiBase: "https://ov.test" });
    expect(await source.search("Yama", searchOpts)).toEqual([]);
  });
});
