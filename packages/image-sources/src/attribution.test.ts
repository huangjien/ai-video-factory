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
