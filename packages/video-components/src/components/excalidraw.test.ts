import { describe, expect, it } from "vitest";
import {
  ExcalidrawSpecSchema,
  svgSpecToAnimatedSvg,
  svgSpecToExcalidraw,
} from "./excalidraw.js";

const SPEC = {
  title: "DevOps 部署流",
  nodes: [
    { id: "ci", kind: "rect" as const, x: 100, y: 300, w: 300, h: 140, text: "CI" },
    { id: "db", kind: "circle" as const, x: 700, y: 300, w: 260, h: 160, text: "DB" },
  ],
  edges: [{ id: "deploy", from: "ci", to: "db", label: "deploy" }],
};

describe("Excalidraw asset generator (T7.1, plan §4.2)", () => {
  it("accepts the diagram spec", () => {
    expect(ExcalidrawSpecSchema.safeParse(SPEC).success).toBe(true);
  });

  it("produces a structurally valid .excalidraw scene (deterministic with fixed now)", () => {
    const scene = svgSpecToExcalidraw(ExcalidrawSpecSchema.parse(SPEC), { now: 1700000000000 });
    expect(scene.type).toBe("excalidraw");
    expect(scene.version).toBe(2);
    const elements = scene.elements as {
      id: string;
      type: string;
      points?: [number, number][];
      text?: string;
      roughness: number;
    }[];
    const types = elements.map((e) => e.type);
    // 2 nodes + 2 node texts + 1 arrow + 1 edge label
    expect(types.filter((t) => t === "rectangle")).toHaveLength(1);
    expect(types.filter((t) => t === "ellipse")).toHaveLength(1);
    expect(types.filter((t) => t === "arrow")).toHaveLength(1);
    expect(types.filter((t) => t === "text")).toHaveLength(3);
    const arrow = elements.find((e) => e.type === "arrow")!;
    // node centers: ci (250, 370) → db (830, 380)
    expect(arrow.points).toEqual([
      [0, 0],
      [580, 10],
    ]);
    expect(arrow.roughness).toBe(2); // the hand-drawn look
    // determinism with a fixed timestamp
    const again = svgSpecToExcalidraw(ExcalidrawSpecSchema.parse(SPEC), {
      now: 1700000000000,
    });
    expect(again).toEqual(scene);
  });

  it("animated SVG contains staggered draw-on CSS and is deterministic", () => {
    const svg1 = svgSpecToAnimatedSvg(ExcalidrawSpecSchema.parse(SPEC), { durationSec: 3 });
    const svg2 = svgSpecToAnimatedSvg(ExcalidrawSpecSchema.parse(SPEC), { durationSec: 3 });
    expect(svg1).toBe(svg2);
    expect(svg1).toContain("@keyframes vf-draw");
    expect(svg1).toContain("stroke-dashoffset");
    expect(svg1).toContain("deploy");
    expect(svg1.endsWith("</svg>")).toBe(true);
  });
});
