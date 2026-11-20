import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readAllSceneSources,
  readSceneSource,
  sceneSourcePath,
  sourceLogLine,
  writeAttributionFile,
  writeHistoricalSummaryFile,
  writeSceneSource,
  type SceneSourceRecord,
} from "./attribution.js";

const record: SceneSourceRecord = {
  schema: "scene-source/1",
  mode: "direct",
  source: "commons",
  title: "Portrait of Li Shimin",
  author: "Anonymous",
  license: "PD",
  licenseUrl: "https://en.wikipedia.org/wiki/Public_domain",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Portrait.jpg",
  fileUrl: "https://upload.wikimedia.org/x.jpg",
  localPath: null,
  digest: "direct:abc123",
  sha256: "def456",
  retrievedAt: "2026-11-19T00:00:00.000Z",
};

describe("the scene source sidecar", () => {
  it("round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "src-"));
    try {
      writeSceneSource(dir, 7, record);
      expect(sceneSourcePath(dir, 7)).toContain("scene_7.source.json");
      const back = readSceneSource(dir, 7);
      expect(back?.license).toBe("PD");
      expect(back?.digest).toBe("direct:abc123");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is null for a scene that borrowed nothing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "src-"));
    try {
      expect(readSceneSource(dir, 3)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readAllSceneSources", () => {
  it("lists every recorded picture, by scene", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "src-"));
    try {
      writeSceneSource(dir, 2, { ...record, mode: "reference" });
      writeSceneSource(dir, 1, record);
      const all = readAllSceneSources(dir);
      expect(all.map((r) => r.scene)).toEqual([1, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the attribution file", () => {
  it("names the picture, its author, its license and where it lives", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "src-"));
    try {
      writeSceneSource(dir, 7, record);
      const out = writeAttributionFile(dir, readAllSceneSources(dir));
      const text = await readFile(out, "utf8");
      expect(text).toContain("# Image attribution");
      expect(text).toContain("Portrait of Li Shimin");
      expect(text).toContain("Anonymous");
      expect(text).toContain("PD");
      expect(text).toContain("commons.wikimedia.org");
      // The mode says whether the picture IS the frame or informed it.
      expect(text).toContain("frame");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says so when nothing was borrowed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "src-"));
    try {
      const out = writeAttributionFile(dir, []);
      const text = await readFile(out, "utf8");
      expect(text).toContain("No external pictures were used");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sourceLogLine", () => {
  it("reads like the audio license lines", () => {
    const line = sourceLogLine(7, record);
    expect(line).toContain("assets/images/scene_7.jpg");
    expect(line).toContain("commons");
    expect(line).toContain("PD");
    expect(line).toContain("Anonymous");
  });

  it("shortens a biography-length author", () => {
    // Commons often stores a whole life story in the Artist field.
    const line = sourceLogLine(7, {
      ...record,
      author:
        "足立喜六（Adachi Kiroku，1871－1949），日本静冈县人，土木工程技术者、数学家。 " +
        "1898年毕业于东京高等师范学校（现筑波大学）。 1906年受聘为陕西高等学堂算学、理化教习，" +
        "任职期间考察西安周边古迹，运用三角函数及近代测量技术对汉唐长安城址、帝陵等进行测绘。",
    });
    expect(line.length).toBeLessThan(160);
    expect(line).toContain("…");
  });
});

describe("writeHistoricalSummaryFile", () => {
  // The credit list says what was used; this says what was ASKED for and
  // what each scene got — including the scene that asked and got nothing.

  it("records the plan and the outcome per scene", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "historical-summary-"));
    try {
      const out = writeHistoricalSummaryFile(dir, {
        plan: [
          {
            scene: 1,
            historical: true,
            subject: "李世民",
            query: "李世民",
            mode: "direct",
            reason: "a named emperor",
          },
          {
            scene: 2,
            historical: true,
            subject: "毛奇",
            query: "Helmuth von Moltke",
            mode: "reference",
            reason: "a moment",
          },
          {
            scene: 3,
            historical: false,
            subject: "",
            query: "",
            mode: "none",
            reason: "an abstract idea",
          },
          {
            scene: 4,
            historical: true,
            subject: "Tutankhamun",
            query: "Tutankhamun",
            mode: "direct",
            reason: "the mask",
          },
        ],
        sidecars: [
          {
            scene: 1,
            record: {
              schema: "scene-source/1",
              mode: "direct",
              source: "commons",
              title: "TangTaizongP.jpg",
              author: "Anonymous",
              license: "PD",
              licenseUrl: "",
              pageUrl: "https://commons.wikimedia.org/wiki/File:TangTaizongP.jpg",
              fileUrl: "https://upload.wikimedia.org/x.jpg",
              localPath: null,
              digest: "direct:abc",
              sha256: "def456",
              retrievedAt: "2026-11-20T00:00:00.000Z",
            },
          },
        ],
        resolutions: new Map([
          [
            4,
            {
              scene: 4,
              mode: "direct",
              candidate: {
                source: "openverse",
                title: "Mask of Tutankhamun.svg",
                pageUrl: "https://example.com/mask.svg",
                fileUrl: "https://example.com/mask.svg",
                localPath: null,
                author: "",
                license: "CC0",
                licenseUrl: "",
                width: 640,
                height: 900,
                digestKey: "x",
                query: "Tutankhamun",
                owned: false,
                directEligible: true,
              },
              digest: "direct:def",
              note: "using the picture itself",
            },
          ],
          [
            1,
            {
              scene: 1,
              mode: "direct",
              candidate: {
                source: "commons",
                title: "TangTaizongP.jpg",
                pageUrl: "https://commons.wikimedia.org/wiki/File:TangTaizongP.jpg",
                fileUrl: "https://upload.wikimedia.org/x.jpg",
                localPath: null,
                author: "Anonymous",
                license: "PD",
                licenseUrl: "",
                width: 100,
                height: 100,
                digestKey: "x",
                query: "李世民",
                owned: false,
                directEligible: true,
              },
              digest: "direct:abc",
              note: "using the picture itself",
            },
          ],
          [
            2,
            {
              scene: 2,
              mode: "none",
              candidate: null,
              digest: "",
              note: "no freely-licensed picture found",
            },
          ],
        ]),
      });
      const text = await readFile(out, "utf8");
      expect(text).toContain("Historical scenes planned: 3 of 4");
      expect(text).toContain("scenes with a picture: 1");
      // The scene that planned a picture and got it.
      expect(text).toContain("李世民");
      expect(text).toContain("frame");
      expect(text).toContain("TangTaizongP.jpg");
      // The scene that planned a picture and got none.
      expect(text).toContain("Helmuth von Moltke");
      expect(text).toContain("no picture");
      // The picture on screen is the one the SIDECAR says — not the one
      // the plan hoped for.
      expect(text).toContain("TangTaizongP.jpg");
      // A planned picture that never reached the screen must not be
      // reported as one: the plan is not the outcome.
      expect(text).toContain("picture failed");
      expect(text).not.toContain("Mask of Tutankhamun.svg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
