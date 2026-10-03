import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveSceneVersion,
  extractSceneFragment,
  hashSceneFragment,
  listSceneVersions,
  readSceneApproval,
  readSceneVersion,
  recordSceneVersion,
  replaceSceneFragment,
} from "./versions.js";

const STORYBOARD = `schema_version: "0.1"

project:
  id: demo
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

scenes:
  - id: scene-01
    duration: 5
    narration:
      text: "第一段"
    visual:
      component: Title
      props:
        text: "hello"
  - id: scene-02
    duration: 6
    narration:
      text: "第二段"
    visual:
      component: Paragraph
      props:
        text: "world"
`;

describe("scene versions (plan §26)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "video-versions-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts exactly one scene block", () => {
    const frag = extractSceneFragment(STORYBOARD, "scene-02");
    expect(frag).toContain("- id: scene-02");
    expect(frag).toContain('text: "world"');
    expect(frag).not.toContain("scene-01");
    expect(extractSceneFragment(STORYBOARD, "missing")).toBeNull();
  });

  it("records v1 then v2 only when content changes", async () => {
    const frag = extractSceneFragment(STORYBOARD, "scene-01")!;
    expect(await recordSceneVersion(root, "scene-01", frag)).toBe(1);
    // identical content → no new version
    expect(await recordSceneVersion(root, "scene-01", frag)).toBeNull();

    const edited = frag.replace("duration: 5", "duration: 7");
    expect(await recordSceneVersion(root, "scene-01", edited)).toBe(2);

    const versions = await listSceneVersions(root, "scene-01");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("restore splices the old fragment back without touching siblings", async () => {
    const frag1 = extractSceneFragment(STORYBOARD, "scene-01")!;
    await recordSceneVersion(root, "scene-01", frag1);
    const edited = frag1.replace('text: "hello"', 'text: "hello v2"');
    await recordSceneVersion(root, "scene-01", edited);

    const restored = replaceSceneFragment(
      STORYBOARD,
      "scene-01",
      await readSceneVersion(root, "scene-01", 1),
    );
    expect(restored).toContain('text: "hello"');
    expect(restored).not.toContain("hello v2");
    expect(restored).toContain("scene-02");
    expect(restored).toContain('text: "world"');
    // structural sanity: still parses as the same scene count
    expect(restored.match(/- id: scene-/g)).toHaveLength(2);
  });

  it("replaceSceneFragment throws when the scene is absent", () => {
    expect(() =>
      replaceSceneFragment(STORYBOARD, "nope", "- id: nope\n    duration: 1"),
    ).toThrow(/not in storyboard/);
  });

  it("approve persists which version is approved", async () => {
    const frag = extractSceneFragment(STORYBOARD, "scene-01")!;
    await recordSceneVersion(root, "scene-01", frag);
    await approveSceneVersion(root, "scene-01", 1);
    const approval = await readSceneApproval(root, "scene-01");
    expect(approval?.version).toBe(1);
    expect(approval?.approver).toBe("human");
    await expect(approveSceneVersion(root, "scene-01", 99)).rejects.toThrow(
      /not recorded/,
    );
  });

  it("hash is stable modulo surrounding blank lines", () => {
    expect(hashSceneFragment("- id: a\n    duration: 1")).toBe(
      hashSceneFragment("- id: a\n    duration: 1\n\n\n"),
    );
  });
});
