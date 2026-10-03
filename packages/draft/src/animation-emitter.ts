/**
 * v0.4.1 — Animation emitter for `scene.animations[]`.
 *
 * Given a component name and the props the visual builder produced,
 * emit a list of timeline animations (`{id, target, type, start, duration, easing}`)
 * that drives per-element choreography inside the scene. The shape
 * matches `vdsl.timelineAnimationSchema` (`packages/vdsl/src/schema.ts:413-431`).
 *
 * Today only `SvgScene` reads these, but the schema is component-agnostic,
 * so the same emitted list is the contract that future FlowChart /
 * Terminal / Timeline / Comparison renderers will honour (see T19).
 *
 * Strategy
 *   - **Stagger** elements across the scene's duration with a small gap.
 *   - **Draw-on** for sequential content (FlowChart/SvgScene edges).
 *   - **Highlight** for emphasis rows and milestone events.
 *   - **Write** for typewriter content (Terminal lines).
 *   - **Move** for paired-card entrances (Comparison).
 *
 * Deterministic (no LLM), idempotent, free. Runs at YAML-build time.
 */

export interface TimelineAnimation {
  id: string;
  target: string;
  type: "draw" | "write" | "fade" | "move" | "scale" | "rotate" | "highlight" | "camera";
  /** Scene-relative seconds. */
  start: number;
  duration: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

export interface EmitContext {
  /** Scene duration in seconds — animation timing must fit within this. */
  sceneDurationSec: number;
}

const EASING: TimelineAnimation["easing"] = "easeOut";

/** Public dispatch: (component, props, ctx) → TimelineAnimation[] */
export function emitSceneAnimations(
  component: string,
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  switch (component) {
    case "FlowChart":
      return emitFlowChartAnimations(props, ctx);
    case "Terminal":
      return emitTerminalAnimations(props, ctx);
    case "Comparison":
      return emitComparisonAnimations(props, ctx);
    case "Timeline":
      return emitTimelineAnimations(props, ctx);
    case "Callout":
      return emitCalloutAnimations(props, ctx);
    case "Title":
      return emitTitleAnimations(props, ctx);
    case "SvgScene":
      return emitSvgSceneAnimations(props, ctx);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// FlowChart — staggered draw-on for each node + each edge gap.
// ---------------------------------------------------------------------------
function emitFlowChartAnimations(
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  const nodes = (props.nodes as unknown[]) ?? [];
  const out: TimelineAnimation[] = [];
  const { perElementSec, totalBudget } = budget(ctx.sceneDurationSec, nodes.length);
  let cursor = 0;
  nodes.forEach((n, i) => {
    const target = nodeId(n, i);
    out.push({
      id: `node-${target}`,
      target,
      type: "highlight",
      start: round2(cursor),
      duration: round2(Math.min(perElementSec * 1.4, 0.9)),
      easing: EASING,
    });
    cursor += perElementSec;
  });
  // After all nodes, the edges fade in too (so the graph "lights up").
  if (cursor < totalBudget) {
    out.push({
      id: "edges",
      target: "__edges__",
      type: "draw",
      start: round2(cursor),
      duration: round2(totalBudget - cursor),
      easing: EASING,
    });
  }
  return out;
}

function nodeId(n: unknown, i: number): string {
  if (isObjectWithStringProp(n, "id")) return n.id;
  return `node-${i}`;
}

// ---------------------------------------------------------------------------
// Terminal — typewriter per line, staggered.
// ---------------------------------------------------------------------------
function emitTerminalAnimations(
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  const lines = (props.lines as string[]) ?? [];
  const out: TimelineAnimation[] = [];
  if (lines.length === 0) return out;
  const perElementSec = Math.max(0.25, ctx.sceneDurationSec / (lines.length * 4));
  let cursor = 0;
  lines.forEach((_, i) => {
    out.push({
      id: `line-${i}`,
      target: `line-${i}`,
      type: "write",
      start: round2(cursor),
      duration: round2(perElementSec * 1.5),
      easing: EASING,
    });
    cursor += perElementSec;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Comparison — slide the two cards in from each direction.
// ---------------------------------------------------------------------------
function emitComparisonAnimations(
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  const left = props.left as { items?: unknown[] } | undefined;
  const right = props.right as { items?: unknown[] } | undefined;
  const leftCount = left?.items?.length ?? 0;
  const rightCount = right?.items?.length ?? 0;
  const half = ctx.sceneDurationSec / 2;
  const out: TimelineAnimation[] = [
    {
      id: "left-card",
      target: "__left__",
      type: "move",
      start: 0.1,
      duration: round2(half - 0.2),
      easing: EASING,
    },
    {
      id: "right-card",
      target: "__right__",
      type: "move",
      start: round2(half),
      duration: round2(half - 0.2),
      easing: EASING,
    },
  ];
  // Highlight each item as the card reveals.
  const leftSec = (half - 0.2) / Math.max(1, leftCount);
  left?.items?.forEach?.((_, i) => {
    out.push({
      id: `left-item-${i}`,
      target: `left-item-${i}`,
      type: "highlight",
      start: round2(0.2 + i * leftSec),
      duration: round2(leftSec),
      easing: EASING,
    });
  });
  const rightSec = (half - 0.2) / Math.max(1, rightCount);
  right?.items?.forEach?.((_, i) => {
    out.push({
      id: `right-item-${i}`,
      target: `right-item-${i}`,
      type: "highlight",
      start: round2(half + i * rightSec),
      duration: round2(rightSec),
      easing: EASING,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Timeline — scale-up per event, evenly spaced.
// ---------------------------------------------------------------------------
function emitTimelineAnimations(
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  const events = (props.events as unknown[]) ?? [];
  if (events.length === 0) return [];
  const per = ctx.sceneDurationSec / events.length;
  return events.map((e, i) => {
    const label = isObjectWithStringProp(e, "label") ? e.label : `event-${i}`;
    return {
      id: `event-${i}`,
      target: `event-${label}`,
      type: "highlight" as const,
      start: round2(i * per),
      duration: round2(Math.min(per * 1.2, 1.2)),
      easing: EASING,
    };
  });
}

// ---------------------------------------------------------------------------
// Callout — single highlight for the body text.
// ---------------------------------------------------------------------------
function emitCalloutAnimations(
  _props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  return [
    {
      id: "callout-body",
      target: "__callout__",
      type: "highlight",
      start: 0.1,
      duration: round2(Math.min(ctx.sceneDurationSec, 1.0)),
      easing: EASING,
    },
  ];
}

// ---------------------------------------------------------------------------
// Title — single entrance highlight (the component already does entrance
// internally; we still emit one so any future component uses the
// same animation array).
// ---------------------------------------------------------------------------
function emitTitleAnimations(
  _props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  return [
    {
      id: "title-entrance",
      target: "__title__",
      type: "highlight",
      start: 0,
      duration: round2(Math.min(ctx.sceneDurationSec, 1.0)),
      easing: EASING,
    },
  ];
}

// ---------------------------------------------------------------------------
// SvgScene — staggered draw-on for each node + each edge, with the same
// timing contract `resolveElementTiming` already understands.
// ---------------------------------------------------------------------------
function emitSvgSceneAnimations(
  props: Record<string, unknown>,
  ctx: EmitContext,
): TimelineAnimation[] {
  const nodes = (props.nodes as unknown[]) ?? [];
  const edges = (props.edges as unknown[]) ?? [];
  const total = nodes.length + edges.length;
  const per = ctx.sceneDurationSec / Math.max(1, total);
  const out: TimelineAnimation[] = [];
  let cursor = 0;
  nodes.forEach((n, i) => {
    out.push({
      id: `node-${nodeId(n, i)}`,
      target: nodeId(n, i),
      type: "highlight",
      start: round2(cursor),
      duration: round2(per * 1.2),
      easing: EASING,
    });
    cursor += per;
  });
  edges.forEach((e, i) => {
    out.push({
      id: `edge-${edgeId(e, i)}`,
      target: edgeId(e, i),
      type: "draw",
      start: round2(cursor),
      duration: round2(per * 1.2),
      easing: EASING,
    });
    cursor += per;
  });
  return out;
}

function edgeId(e: unknown, i: number): string {
  if (isObjectWithStringProp(e, "id")) return e.id;
  return `edge-${i}`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function budget(sceneDurationSec: number, elementCount: number): {
  perElementSec: number;
  totalBudget: number;
} {
  const totalBudget = Math.max(1.5, sceneDurationSec * 0.85);
  const perElementSec = Math.max(
    0.18,
    Math.min(1.0, totalBudget / Math.max(1, elementCount)),
  );
  return { perElementSec, totalBudget };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Narrow `value` to a record that has `prop` as a string. The return
 *  type carries the property name through, so callers get full type
 *  safety on subsequent access. */
function isObjectWithStringProp<K extends string>(
  value: unknown,
  prop: K,
): value is Record<K, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    prop in value &&
    typeof (value as Record<string, unknown>)[prop] === "string"
  );
}