import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactPictureSource } from "./artifacts.js";

/** A 1×1 JPEG — enough bytes for the scanner, which only hashes files. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

describe("ArtifactPictureSource", () => {
  it("finds the character bible's reference sheets", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "artifacts-ws-"));
    const project = path.join(ws, "projects", "film");
    try {
      const refs = path.join(ws, "assets", "characters", "li-shimin", "refs", "gongbi");
      await mkdir(refs, { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(path.join(refs, "v1.jpg"), JPEG);
      await writeFile(path.join(refs, "v2.jpg"), JPEG);

      const source = new ArtifactPictureSource({
        projectRoot: project,
        workspaceRoot: ws,
      });
      const out = await source.search("li shimin", { limit: 10 });
      expect(out.length).toBe(2);
      const c = out[0]!;
      expect(c.source).toBe("artifact");
      // The project's own art is owned — no third-party rights, so the
      // license filter does not apply to it.
      expect(c.owned).toBe(true);
      expect(c.license).toBe("OWNED");
      expect(c.localPath).toContain("li-shimin");
      expect(c.title).toContain("li-shimin");
      // The digest carries the file's content hash: a re-rendered sheet
      // must invalidate the scene that borrowed it.
      expect(c.digestKey).toContain("|");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("finds the project's placed figures, but not its scene images", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "artifacts-ws-"));
    const project = path.join(ws, "projects", "film");
    try {
      await mkdir(path.join(project, "assets", "images"), { recursive: true });
      await mkdir(path.join(project, "assets", "figures"), { recursive: true });
      await writeFile(
        path.join(project, "assets", "images", "scene_3.jpg"),
        JPEG,
      );
      await writeFile(path.join(project, "assets", "figures", "map.png"), JPEG);

      const source = new ArtifactPictureSource({
        projectRoot: project,
        workspaceRoot: ws,
      });
      const out = await source.search("q", { limit: 10 });
      const titles = out.map((c) => c.title);
      expect(titles).toContain("map");
      // Another scene's frame is not a source: it would put that scene's
      // art in this scene's picture, and the candidate set would grow
      // during the run.
      expect(titles).not.toContain("scene 3 (earlier generation)");
      // A placed asset may be the frame itself.
      expect(out.find((c) => c.title === "map")?.directEligible).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("returns nothing when the project has no pictures yet", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "artifacts-ws-"));
    try {
      const source = new ArtifactPictureSource({
        projectRoot: path.join(ws, "projects", "film"),
        workspaceRoot: ws,
      });
      expect(await source.search("q", { limit: 10 })).toEqual([]);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
