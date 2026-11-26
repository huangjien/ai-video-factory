import { afterEach, describe, expect, it, vi } from "vitest";

import { WikipediaPictureSource, commonsFileTitle } from "./wikipedia.js";

/** The network is the boundary under test. */
const fetchMock = vi.hoisted(() => vi.fn());
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  fetchMock.mockReset();
});

function stubFetch(table: Record<string, unknown>): void {
  fetchMock.mockImplementation(async (url: string) => {
    const key = Object.keys(table).find((k) => url.includes(k));
    const body = key === undefined ? {} : table[key];
    return { ok: true, status: 200, json: async () => body };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const commonsUrl =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Yama.jpg";

describe("commonsFileTitle", () => {
  it("names the Commons file behind a picture URL", () => {
    expect(commonsFileTitle(commonsUrl)).toBe("File:Yama.jpg");
  });

  it("decodes a percent-encoded name", () => {
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Yama%20Kung.jpg",
      ),
    ).toBe("File:Yama Kung.jpg");
  });

  it("keeps the raw name when it cannot be decoded", () => {
    // A broken percent sequence must not throw the picture away.
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Yama%E0%A4.jpg",
      ),
    ).toBe("File:Yama%E0%A4.jpg");
  });

  it("has no file for a picture that is not hosted on Commons", () => {
    expect(commonsFileTitle("https://example.org/photo.jpg")).toBeNull();
    expect(
      commonsFileTitle(
        "https://upload.wikimedia.org/wikipedia/en/a/ab/Yama.jpg",
      ),
    ).toBeNull();
  });
});

describe("WikipediaPictureSource.search", () => {
  const commonsAnswer = {
    query: {
      pages: [
        {
          title: "File:Yama.jpg",
          imageinfo: [
            {
              url: commonsUrl,
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Yama.jpg",
              thumburl: commonsUrl,
              width: 640,
              height: 480,
              extmetadata: {
                LicenseShortName: { value: "Public domain" },
                Artist: { value: '<a href="x">A Painter</a>' },
                LicenseUrl: {
                  value: "https://creativecommons.org/publicdomain/mark/1.0/",
                },
              },
            },
          ],
        },
      ],
    },
  };

  it("reads the article's lead picture and its Commons license", async () => {
    stubFetch({
      "en.test": {
        query: {
          pages: [
            {
              title: "Yama",
              fullurl: "https://en.wikipedia.org/wiki/Yama",
              original: { source: commonsUrl, width: 640, height: 480 },
            },
          ],
        },
      },
      "commons.test": commonsAnswer,
    });
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
      commonsApiBase: "https://commons.test/w/api.php",
    });
    const out = await source.search("Yama", { limit: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("wikipedia");
    // The article is where a human checks the picture in context.
    expect(out[0]?.pageUrl).toBe("https://en.wikipedia.org/wiki/Yama");
    // The license code is normalized, not the archive's wording.
    expect(out[0]?.license).toBe("PD");
    expect(out[0]?.author).toBe("A Painter");
  });

  it("asks for nothing when the query is blank", async () => {
    stubFetch({});
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
    });
    expect(await source.search("  ", { limit: 3 })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing when the answer carries no pages", async () => {
    stubFetch({ "en.test": { query: { pages: "not-a-list" } } });
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
    });
    expect(await source.search("Yama", { limit: 3 })).toEqual([]);
  });

  it("skips a page whose picture is not hosted on Commons", async () => {
    stubFetch({
      "en.test": {
        query: {
          pages: [
            {
              title: "Yama",
              original: { source: "https://example.org/fair-use.jpg" },
            },
          ],
        },
      },
    });
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
    });
    expect(await source.search("Yama", { limit: 3 })).toEqual([]);
  });

  it("skips a page with no picture at all", async () => {
    stubFetch({
      "en.test": { query: { pages: [{ title: "Yama" }] } },
    });
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
    });
    expect(await source.search("Yama", { limit: 3 })).toEqual([]);
  });

  it("asks the API for at most the number of pages it was configured for", async () => {
    stubFetch({
      "en.test": {
        query: {
          pages: [
            {
              title: "A",
              original: { source: commonsUrl },
            },
            {
              title: "B",
              original: { source: commonsUrl },
            },
            {
              title: "C",
              original: { source: commonsUrl },
            },
          ],
        },
      },
      "commons.test": commonsAnswer,
    });
    const source = new WikipediaPictureSource({
      apiBase: "https://en.test/w/api.php",
      commonsApiBase: "https://commons.test/w/api.php",
      maxLookups: 2,
    });
    const out = await source.search("Yama", { limit: 3 });
    expect(out.length).toBeGreaterThan(0);
    const asked = String(fetchMock.mock.calls[0]?.[0]);
    expect(asked).toContain("gsrlimit=2");
  });
});
