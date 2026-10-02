import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IartSkillAdapter,
  planSceneMotion,
  validateMotionSpec,
} from "./index.js";
import { STAGGER } from "./heuristics.js";

describe("planSceneMotion — deterministic motion planning (T4.1)", () => {
  it("produces a legal entrance for a short title scene", () => {
    const spec = planSceneMotion({
      sceneId: "scene-01",
      durationSec: 3,
      index: 0,
      component: "Title",
    });
    expect(spec.animations).toHaveLength(1);
    const enter = spec.animations[0]!;
    expect(enter.type).toBe("fade");
    expect(enter.easing).toBe("easeOut");
    expect(enter.start).toBeGreaterThanOrEqual(0);
    expect(enter.start + enter.duration).toBeLessThanOrEqual(3);
    expect(validateMotionSpec(spec, 3)).toEqual([]);
    expect(spec.transition).toEqual({ in: "fade", out: "fade" });
  });

  it("diagram components draw on; terminals write on", () => {
    const diagram = planSceneMotion({
      sceneId: "s",
      durationSec: 4,
      index: 1,
      component: "FlowChart",
    });
    expect(diagram.animations[0]!.type).toBe("draw");
    const term = planSceneMotion({
      sceneId: "s",
      durationSec: 4,
      index: 2,
      component: "Terminal",
    });
    expect(term.animations[0]!.type).toBe("write");
  });

  it("staggers multiple targets within the group-reveal cap", () => {
    const spec = planSceneMotion({
      sceneId: "scene-05",
      durationSec: 5,
      index: 4,
      component: "Paragraph",
      targets: ["item-1", "item-2", "item-3", "item-4", "item-5"],
    });
    expect(spec.animations).toHaveLength(5);
    const starts = spec.animations.map((a) => a.start);
    const spread = starts[starts.length - 1]! - starts[0]!;
    expect(spread).toBeLessThanOrEqual(STAGGER.capSpreadSec + 1e-9);
    expect(validateMotionSpec(spec, 5)).toEqual([]);
  });

  it("adds one mid-scene emphasis to long scenes only", () => {
    const short = planSceneMotion({
      sceneId: "s",
      durationSec: 4,
      index: 0,
      component: "Title",
    });
    expect(short.animations.some((a) => a.type === "highlight")).toBe(false);
    const long = planSceneMotion({
      sceneId: "s",
      durationSec: 10,
      index: 0,
      component: "Title",
    });
    const highlight = long.animations.find((a) => a.type === "highlight");
    expect(highlight).toBeDefined();
    expect(highlight!.start).toBeGreaterThanOrEqual(10 * 0.5 - 0.6);
    expect(validateMotionSpec(long, 10)).toEqual([]);
  });

  it("quantizes to the beat grid when given a bpm", () => {
    const spec = planSceneMotion({
      sceneId: "s",
      durationSec: 8,
      index: 0,
      component: "Title",
      beatsPerMinute: 120, // 500ms grid
    });
    for (const anim of spec.animations) {
      expect(Math.round(anim.start * 1000) % 500).toBe(0);
    }
  });

  it("throws on non-positive duration", () => {
    expect(() =>
      planSceneMotion({ sceneId: "s", durationSec: 0, index: 0, component: "Title" }),
    ).toThrow(/non-positive/);
  });
});

describe("IartSkillAdapter — skills present vs absent (AD-5 fallback)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vf-motion-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads guidance from .agents/skills and strips frontmatter", async () => {
    const dir = path.join(root, ".agents", "skills", "animation-principles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: animation-principles\ndescription: x\n---\n\n# Motion Principles\n\nEnter -> ease-out.\n",
    );
    const adapter = IartSkillAdapter.fromProjectRoot(root);
    expect(adapter.isAvailable("animation-principles")).toBe(true);
    const guidance = await adapter.loadSkillGuidance("animation-principles");
    expect(guidance).not.toBeNull();
    expect(guidance!.body).toContain("# Motion Principles");
    expect(guidance!.body).not.toContain("description:");
  });

  it("returns null and still yields a legal MotionSpec when skills are gone", async () => {
    // No .agents/skills, no skills/ — the fallback contract.
    const adapter = IartSkillAdapter.fromProjectRoot(root);
    expect(adapter.isAvailable("animation-principles")).toBe(false);
    expect(await adapter.loadSkillGuidance("animation-principles")).toBeNull();

    const spec = planSceneMotion({
      sceneId: "scene-01",
      durationSec: 4,
      index: 0,
      component: "Title",
    });
    expect(validateMotionSpec(spec, 4)).toEqual([]);
    // Identical input, identical output — planning never depended on skills.
    const again = planSceneMotion({
      sceneId: "scene-01",
      durationSec: 4,
      index: 0,
      component: "Title",
    });
    expect(again).toEqual(spec);
    expect(existsSync(path.join(root, ".agents"))).toBe(false);
  });

  it("prefers the first-party skills/ dir when both exist", async () => {
    const dir = path.join(root, "skills", "storyboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(root, "skills", "storyboard", "SKILL.md"),
      "---\nname: storyboard\n---\n\nfirst-party\n",
    );
    const adapter = IartSkillAdapter.fromProjectRoot(root);
    expect(adapter.isAvailable("storyboard")).toBe(true);
  });
});
