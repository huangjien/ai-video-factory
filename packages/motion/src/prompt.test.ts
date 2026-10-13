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
    expect(sys).toContain("must fit inside the scene's 4s");
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
