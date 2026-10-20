import { describe, expect, it } from "vitest";
import { buildMotionMessages } from "./prompt.js";
import type { MotionSpec } from "./plan.js";

const baseline = (): MotionSpec => ({
  transition: { in: "fade", out: "fade" },
  animations: [],
});

const BASE = {
  sceneId: "scene-03",
  durationSec: 4,
  index: 3,
  component: "FlowChart",
  baseline: baseline(),
  guidance: null,
};

describe("motion prompt", () => {
  it("system message locks the output schema and scene time budget", () => {
    const [system] = buildMotionMessages(BASE);
    expect(system?.role).toBe("system");
    const sys = system?.content ?? "";
    expect(sys).toContain("```yaml fenced block");
    expect(sys).toContain("2-5 animations total");
    expect(sys).toContain("must fit inside the scene's 4 seconds");
  });

  it("user message carries the scene as parseable JSON with the baseline", () => {
    const [, user] = buildMotionMessages(BASE);
    const parsed = JSON.parse(user?.content ?? "{}") as {
      scene: Record<string, unknown>;
      baseline: unknown;
    };
    expect(parsed.scene["id"]).toBe("scene-03");
    expect(parsed.scene["durationSec"]).toBe(4);
    expect(parsed.scene["component"]).toBe("FlowChart");
    expect(parsed.baseline).toEqual(BASE.baseline);
  });

  it("includes optional fields only when provided", () => {
    const withAll = buildMotionMessages({
      ...BASE,
      narrationText: "旁白文本",
      propsSummary: '{"nodes": 3}',
      targets: ["node-1", "node-2"],
      beatsPerMinute: 120,
    });
    const scene = JSON.parse(withAll[1]?.content ?? "{}").scene as Record<
      string,
      unknown
    >;
    expect(scene["narration"]).toBe("旁白文本");
    expect(scene["props"]).toBe('{"nodes": 3}');
    expect(scene["targets"]).toEqual(["node-1", "node-2"]);
    expect(scene["beatsPerMinute"]).toBe(120);

    const bare = JSON.parse(buildMotionMessages(BASE)[1]?.content ?? "{}")
      .scene as Record<string, unknown>;
    expect("narration" in bare).toBe(false);
    expect("targets" in bare).toBe(false);
  });

  it("embeds skill guidance when present, fallback wording when not", () => {
    const withGuidance = buildMotionMessages({
      ...BASE,
      guidance: "stagger list entrances 60ms",
    });
    expect(withGuidance[0]?.content).toContain("stagger list entrances 60ms");
    expect(withGuidance[0]?.content).not.toContain("Skill guidance unavailable");

    const bare = buildMotionMessages(BASE);
    expect(bare[0]?.content).toContain("Skill guidance unavailable");
  });
});

describe("buildMotionMessages — still-first channel (CS-09)", () => {
  const input = {
    sceneId: "scene-01",
    durationSec: 12,
    index: 0,
    component: "ImageBackground",
    baseline: { animations: [], transition: { in: "fade" as const, out: "cut" as const } },
    guidance: null,
  };

  it("appends the still-first block last, overriding the 2-5 quota", () => {
    const msg = buildMotionMessages({ ...input, channelProfile: "chinese-storybook" });
    const content = msg[0]!.content;
    expect(content).toContain("chinese-storybook");
    // The quota the block must override is still present above it...
    expect(content).toContain("2-5 animations");
    // ...and the override lands after it.
    expect(content.indexOf("chinese-storybook")).toBeGreaterThan(
      content.indexOf("2-5 animations"),
    );
  });

  it("tells the agent that zero animations is a valid answer", () => {
    const content = buildMotionMessages({
      ...input,
      channelProfile: "chinese-storybook",
    })[0]!.content;
    expect(content).toMatch(/zero animations/i);
    expect(content).toMatch(/at most ONE animation/i);
    expect(content).toMatch(/typewriter/i);
  });

  it("leaves every other profile's prompt untouched", () => {
    const plain = buildMotionMessages(input)[0]!.content;
    const other = buildMotionMessages({ ...input, channelProfile: "x" })[0]!.content;
    expect(plain).not.toContain("chinese-storybook");
    expect(other).toBe(plain);
  });
});
