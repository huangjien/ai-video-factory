import { z } from "zod";
import { hashStr } from "./doodleLogic.js";

/**
 * Excalidraw asset generator (plan T7.1, §4.2) — a Diagram ASSET Generator,
 * not a video runtime. Converts the same diagram spec SvgScene renders
 * (nodes + edges) into:
 *   1. a valid `.excalidraw` scene file (opens in Excalidraw for hand
 *      editing — hand-drawn hachure style, roughness 2), and
 *   2. a standalone animated SVG (CSS stroke draw-on) for web/embed use.
 *
 * Pure functions: spec in, strings/objects out. File IO belongs to the CLI.
 * NOTE: this module is bundled into the browser by the renderer (video-
 * components is imported from the Remotion entry) — no Node builtins here.
 */

const EXCALIDRAW_NODE_SPEC = z.object({
  id: z.string().min(1),
  kind: z.enum(["rect", "circle", "label"]).default("rect"),
  x: z.number(),
  y: z.number(),
  w: z.number().default(360),
  h: z.number().default(140),
  text: z.string().optional(),
});
const EXCALIDRAW_EDGE_SPEC = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});
export const ExcalidrawSpecSchema = z.object({
  title: z.string().optional(),
  nodes: z.array(EXCALIDRAW_NODE_SPEC).min(1),
  edges: z.array(EXCALIDRAW_EDGE_SPEC).default([]),
});
export type ExcalidrawSpec = z.infer<typeof ExcalidrawSpecSchema>;

const INK = "#1e1e1e";
const ACCENT = "#1971c2";

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: null;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: { id: string; type: string }[] | null;
  updated: number;
  link: null;
  locked: boolean;
  points?: [number, number][];
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  startArrowhead?: null;
  endArrowhead?: string;
}

function nonce(spec: string): number {
  return hashStr(spec);
}

function baseElement(id: string, type: string, updatedAt: number): ExcalidrawElement {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 2, // "artist" — the hand-drawn look
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nonce(id),
    version: 1,
    versionNonce: nonce(id + "-nonce"),
    isDeleted: false,
    boundElements: null,
    updated: updatedAt,
    link: null,
    locked: false,
  };
}

const ELLIPSE_FACTOR = 0.25;

/** Convert a diagram spec into an Excalidraw scene object. Nodes become
 * rectangles/ellipses (+ bound text), edges become arrows with labels.
 * `now` is injectable for deterministic output in tests. */
export function svgSpecToExcalidraw(
  spec: ExcalidrawSpec,
  opts: { now?: number } = {},
): Record<string, unknown> {
  const updated = opts.now ?? Date.now();
  const elements: ExcalidrawElement[] = [];
  const nodeById = new Map<string, ExcalidrawNodeOut>();
  interface ExcalidrawNodeOut {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  for (const node of spec.nodes) {
    const el = baseElement(`node-${node.id}`, node.kind === "circle" ? "ellipse" : "rectangle", updated);
    el.x = node.x;
    el.y = node.y;
    el.width = node.w;
    el.height = node.h;
    el.backgroundColor = "#ffffff";
    el.boundElements = [];
    elements.push(el);
    nodeById.set(node.id, { x: node.x, y: node.y, w: node.w, h: node.h });
    if (node.text) {
      const text = baseElement(`text-${node.id}`, "text", updated);
      text.x = node.x + node.w / 2 - (node.text.length * 8) / 2;
      text.y = node.y + node.h / 2 - 12;
      text.width = node.text.length * 8;
      text.height = 25;
      text.text = node.text;
      text.fontSize = 20;
      text.fontFamily = 1; // hand-drawn
      text.textAlign = "center";
      text.verticalAlign = "middle";
      text.containerId = null;
      elements.push(text);
      // bind text to its container
      el.boundElements = [{ id: text.id, type: "text" }];
    }
  }

  for (const edge of spec.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    const el = baseElement(`edge-${edge.id}`, "arrow", updated);
    el.strokeColor = ACCENT;
    el.x = x1;
    el.y = y1;
    el.width = Math.abs(x2 - x1);
    el.height = Math.abs(y2 - y1);
    el.points = [
      [0, 0],
      [x2 - x1, y2 - y1],
    ];
    el.startArrowhead = null;
    el.endArrowhead = "arrow";
    elements.push(el);
    if (edge.label) {
      const label = baseElement(`label-${edge.id}`, "text", updated);
      label.x = (x1 + x2) / 2 - (edge.label.length * 8) / 2;
      label.y = (y1 + y2) / 2 - 12;
      label.width = edge.label.length * 8;
      label.height = 25;
      label.text = edge.label;
      label.fontSize = 16;
      label.fontFamily = 1;
      label.textAlign = "center";
      label.containerId = null;
      elements.push(label);
    }
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "ai-video-factory",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };
}

const ANIM_SVG_W = 1920;
const ANIM_SVG_H = 1080;

/** Convert a diagram spec into a standalone animated SVG string (CSS
 * stroke draw-on, staggered per element). Deterministic. */
export function svgSpecToAnimatedSvg(spec: ExcalidrawSpec, opts: { durationSec?: number } = {}): string {
  const duration = opts.durationSec ?? 4;
  const step = 0.5; // seconds between element starts
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n] as const));
  const parts: string[] = [];
  let order = 0;
  const delay = (i: number) => (i * step).toFixed(2);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANIM_SVG_W} ${ANIM_SVG_H}" width="${ANIM_SVG_W}" height="${ANIM_SVG_H}">`,
  );
  parts.push(
    `<style>
.doodle-path{stroke-dasharray:1;stroke-dashoffset:1;animation:video-draw ${duration}s ease-in-out forwards;}
.doodle-fill{opacity:0;animation:video-fill ${step}s ease-out forwards;}
@keyframes video-draw{to{stroke-dashoffset:0;}}
@keyframes video-fill{to{opacity:1;}}
</style>`,
  );
  if (spec.title) {
    parts.push(
      `<text x="80" y="110" font-size="52" font-family="sans-serif" font-weight="700" fill="${INK}" class="doodle-fill" style="animation-delay:${delay(order++)}s">${escapeXml(spec.title)}</text>`,
    );
  }
  for (const node of spec.nodes) {
    const isEllipse = node.kind === "circle";
    const shape = isEllipse
      ? `<ellipse cx="${node.x + node.w / 2}" cy="${node.y + node.h / 2}" rx="${node.w / 2}" ry="${node.h / 2}" fill="#ffffff" fill-opacity="0" stroke="${INK}" stroke-width="3" pathLength="1" class="doodle-path" style="animation-delay:${delay(order)}s"/><animate attributeName="fill-opacity" from="0" to="1" begin="${delay(order)}s" dur="${step}s" fill="freeze"/>`
      : `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="16" fill="#ffffff" fill-opacity="0" stroke="${INK}" stroke-width="3" pathLength="1" class="doodle-path" style="animation-delay:${delay(order)}s"/>`;
    parts.push(shape);
    if (node.text) {
      parts.push(
        `<text x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + 12}" font-size="34" text-anchor="middle" font-family="sans-serif" fill="${INK}" class="doodle-fill" style="animation-delay:${delay(order + ELLIPSE_FACTOR)}s">${escapeXml(node.text)}</text>`,
      );
    }
    order += 1;
  }
  for (const edge of spec.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ACCENT}" stroke-width="5" stroke-linecap="round" pathLength="1" class="doodle-path" style="animation-delay:${delay(order)}s"/>`,
    );
    if (edge.label) {
      parts.push(
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 16}" font-size="30" text-anchor="middle" font-family="sans-serif" fill="${ACCENT}" class="doodle-fill" style="animation-delay:${delay(order + 0.5)}s">${escapeXml(edge.label)}</text>`,
      );
    }
    order += 1;
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
