import type { ComponentType } from "react";
import { z } from "zod";
import { AnimatedIllustration } from "./components/Illustration.js";
import { BarChart } from "./components/BarChart.js";
import { BigIdea } from "./components/BigIdea.js";
import { Callout } from "./components/Callout.js";
import { Character } from "./components/Character.js";
import { Checklist } from "./components/Checklist.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { CycleDiagram } from "./components/CycleDiagram.js";
import {
  DoodleScene,
  DoodleScenePropsSchema,
} from "./components/DoodleScene.js";
import { EndCard } from "./components/EndCard.js";
import { FlowChart } from "./components/FlowChart.js";
import { Image } from "./components/Image.js";
import { ImageBackground } from "./components/ImageBackground.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { Paragraph } from "./components/Paragraph.js";
import { PyramidDiagram } from "./components/PyramidDiagram.js";
import { QuoteBlock } from "./components/QuoteBlock.js";
import { StatGrid } from "./components/StatGrid.js";
import { Terminal } from "./components/Terminal.js";
import { Timeline } from "./components/Timeline.js";
import { MapInsert } from "./components/MapInsert.js";
import { Title } from "./components/Title.js";
import { VennDiagram } from "./components/VennDiagram.js";

export interface RegistryEntry {
  propsSchema: z.ZodTypeAny;
  component: ComponentType<unknown>;
}

/**
 * Component registry (§23) — validation target for `visual.component`
 * (§21.1 line 928). The storyboard agent (LLM) is creative with props:
 * it invents extra keys ("Title.subtitle", "Callout.icon", "cta_url"),
 * omits required fields, and uses LLM-friendly aliases ("content" for
 * "text", "left_title" for "left.title"). Every schema below is
 * therefore `.passthrough()` (extra keys survive), required fields get
 * sensible defaults, and an alias preprocessor maps the common LLM
 * vocabulary onto canonical names before zod validates.
 */

const titleProps = z
  .object({
    text: z.string().min(1),
    subtext: z.string().optional(),
    /** Small uppercase kicker above the title (e.g. "Chapter One"). */
    kicker: z.string().optional(),
    /** Hex accent color override; defaults to theme.accent. */
    accent: z.string().optional(),
  })
  .passthrough();

const paragraphProps = z
  .object({
    text: z.string().min(1),
    /** Optional title rendered above the body. */
    title: z.string().optional(),
    align: z.enum(["left", "center", "right"]).default("center"),
  })
  .passthrough();

const illustrationProps = z
  .object({
    text: z.string().min(1),
    visual: z.string().optional(),
  })
  .passthrough();

const codeBlockProps = z
  .object({
    code: z.string().min(1),
    language: z.string().default("text"),
    highlightLines: z.array(z.number().int().positive()).default([]),
    /** Optional file name / path rendered in a window-chrome bar
     *  above the code (e.g. "src/agent.ts"). */
    fileName: z.string().optional(),
  })
  .passthrough();

const terminalProps = z
  .object({
    title: z.string().optional(),
    lines: z.array(z.string().min(1)).min(1),
    prompt: z.string().default("$"),
  })
  .passthrough();

const imageProps = z
  .object({
    src: z.string().min(1),
    fit: z.enum(["contain", "cover"]).default("contain"),
    alt: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();

const flowChartProps = z
  .object({
    /** Either a plain string (treated as a "process" node) or an
     *  object with `label` + optional `kind` in
     *  {start, process, decision, end}. Decision → diamond, start/end
     *  → filled pill, process → rounded rectangle. */
    nodes: z
      .array(
        z.union([
          z.string().min(1),
          z.object({
            label: z.string().min(1),
            kind: z.enum(["start", "process", "decision", "end"]).optional(),
          }),
        ]),
      )
      .min(1),
    /** Either `[from, to]` tuples (back-compat) or `{from, to, label}`
     *  objects when an edge needs a label chip ("yes" / "no" / etc.). */
    edges: z
      .array(
        z.union([
          z.tuple([
            z.number().int().nonnegative(),
            z.number().int().nonnegative(),
          ]),
          z.object({
            from: z.number().int().nonnegative(),
            to: z.number().int().nonnegative(),
            label: z.string().optional(),
          }),
        ]),
      )
      .default([]),
    direction: z.enum(["left-to-right", "top-down"]).default("left-to-right"),
  })
  .passthrough();

const timelineProps = z
  .object({
    events: z
      .array(
        z
          .object({
            label: z.string().min(1),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const mapInsertProps = z
  .object({
    landforms: z
      .array(
        z
          .object({
            d: z.string().min(1),
            kind: z.enum(["ridge", "river", "plain"]).optional(),
          })
          .strict(),
      )
      .optional(),
    routes: z.array(z.object({ d: z.string().min(1) }).strict()).optional(),
    markers: z
      .array(
        z
          .object({
            x: z.number(),
            y: z.number(),
            kind: z.enum(["start", "city", "battle"]).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  // Deliberately `.strict()`, not `.passthrough()` like the other
  // components. CS-14 forbids readable place names on the map, and the
  // reliable way to forbid a thing is to have no field for it: a stray
  // `label:` fails validation instead of rendering as text that CS-14
  // says must be spoken by the narrator instead.
  .strict();

const calloutProps = z
  .object({
    kind: z.enum(["info", "warning", "success"]).default("info"),
    title: z.string().optional(),
    text: z.string().default(""),
    /** Optional CTA / action chip rendered in the top-right of the card. */
    cta: z.string().optional(),
  })
  .passthrough();

const endCardProps = z
  .object({
    title: z.string().default(""),
    subtitle: z.string().optional(),
    cta: z.string().optional(),
  })
  .passthrough();

const characterProps = z
  .object({
    mouthOpen: z.number().min(0).max(1).default(0),
  })
  .passthrough();

const imageBackgroundProps = z
  .object({
    src: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
    kenBurnsScale: z.number().min(0).max(0.5).default(0.08),
    /** v0.12: transparent PNG key-info title from the Pillow
     *  text-overlay pass. Composited between the background image
     *  and the bottom captions strip. */
    textOverlaySrc: z.string().optional(),
  })
  .passthrough();

const quoteBlockProps = z
  .object({
    quote: z.string().min(1),
    author: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

const statEntry = z
  .object({
    value: z.string().default(""),
    label: z.string().default(""),
    hint: z.string().optional(),
    /** Optional single-char icon shown above the value. */
    icon: z.string().optional(),
  })
  .passthrough();
const statGridProps = z
  .object({
    stats: z.array(statEntry).min(1),
    caption: z.string().optional(),
  })
  .passthrough();

const barEntry = z
  .object({
    label: z.string().default(""),
    value: z.number().default(0),
    display: z.string().optional(),
    /** Optional small icon shown to the left of the bar. */
    icon: z.string().optional(),
    /** Optional short caption shown beside the value. */
    caption: z.string().optional(),
  })
  .passthrough();
const barChartProps = z
  .object({
    bars: z.array(barEntry).min(1),
    title: z.string().optional(),
  })
  .passthrough();

const leaderboardEntry = z
  .object({
    name: z.string().min(1),
    score: z.string().optional(),
    subtitle: z.string().optional(),
    color: z.string().optional(),
  })
  .passthrough();
const leaderboardProps = z
  .object({
    entries: z.array(leaderboardEntry).min(1),
    title: z.string().optional(),
  })
  .passthrough();

const checklistItem = z
  .object({
    text: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(["done", "pending", "skip"]).optional(),
    group: z.string().optional(),
  })
  .passthrough();
const checklistProps = z
  .object({
    /** Back-compat: string[] is treated as all-done items. */
    items: z.array(z.union([z.string().min(1), checklistItem])).min(1),
    title: z.string().optional(),
  })
  .passthrough();

const bigIdeaProps = z
  .object({
    text: z.string().min(1),
    kicker: z.string().optional(),
    attribution: z.string().optional(),
  })
  .passthrough();

const pyramidProps = z
  .object({
    /** Either plain strings (back-compat) or objects with optional
     *  `role` (small chip on the left) and `icon` (single-letter
     *  monogram on the right) for a richer treatment. */
    levels: z
      .array(
        z.union([
          z.string().min(1),
          z.object({
            label: z.string().min(1),
            role: z.string().optional(),
            icon: z.string().optional(),
          }),
        ]),
      )
      .min(1),
    /** Optional headline rendered above the apex. */
    title: z.string().optional(),
  })
  .passthrough();

const vennSet = z
  .object({
    label: z.string().min(1),
    detail: z.string().optional(),
  })
  .passthrough();
const vennProps = z
  .object({
    /** 1–3 sets; extras are dropped. Strings are treated as `{label}`. */
    sets: z.array(z.union([z.string().min(1), vennSet])).min(1),
    center: z.string().optional(),
  })
  .passthrough();

const cycleStage = z
  .object({
    label: z.string().min(1),
    detail: z.string().optional(),
    /** Optional single-letter monogram shown inside the stage node. */
    icon: z.string().optional(),
  })
  .passthrough();
const cycleProps = z
  .object({
    /** 1–8 stages; extras are dropped. Strings are treated as `{label}`. */
    stages: z.array(z.union([z.string().min(1), cycleStage])).min(1),
    title: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();

const CALL_OUT_ALIAS: Record<string, string> = {
  icon: "kind",
  content: "text",
};
const END_CARD_ALIAS: Record<string, string> = {
  cta_text: "cta",
  disclaimer: "subtitle",
};
const QUOTE_ALIAS: Record<string, string> = {
  text: "quote",
  content: "quote",
  citation: "author",
};
const ALIASES_BY_COMPONENT: Record<string, Record<string, string>> = {
  Callout: CALL_OUT_ALIAS,
  EndCard: END_CARD_ALIAS,
  QuoteBlock: QUOTE_ALIAS,
};

function aliasApply(props: unknown, alias: Record<string, string>): unknown {
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    return props;
  }
  const out: Record<string, unknown> = {
    ...(props as Record<string, unknown>),
  };
  for (const [from, to] of Object.entries(alias)) {
    if (!(from in out)) continue;
    const v = out[from];
    if (to.includes(".")) {
      const parts = to.split(".");
      const head = parts[0] ?? "";
      const tail = parts[1] ?? "";
      const nested =
        out[head] && typeof out[head] === "object" && !Array.isArray(out[head])
          ? (out[head] as Record<string, unknown>)
          : {};
      nested[tail] = v;
      out[head] = nested;
    } else {
      out[to] = v;
    }
    delete out[from];
  }
  return out;
}

function withAlias(component: string, inner: z.ZodTypeAny): z.ZodTypeAny {
  const alias = ALIASES_BY_COMPONENT[component];
  if (!alias) return inner;
  return z.preprocess((v) => aliasApply(v, alias), inner);
}

export const REGISTRY: Record<string, RegistryEntry> = {
  Title: {
    propsSchema: withAlias("Title", titleProps),
    component: Title as ComponentType<unknown>,
  },
  Paragraph: {
    propsSchema: withAlias("Paragraph", paragraphProps),
    component: Paragraph as ComponentType<unknown>,
  },
  AnimatedIllustration: {
    propsSchema: illustrationProps,
    component: AnimatedIllustration as ComponentType<unknown>,
  },
  CodeBlock: {
    propsSchema: codeBlockProps,
    component: CodeBlock as ComponentType<unknown>,
  },
  Terminal: {
    propsSchema: terminalProps,
    component: Terminal as ComponentType<unknown>,
  },
  Image: {
    propsSchema: imageProps,
    component: Image as ComponentType<unknown>,
  },
  FlowChart: {
    propsSchema: withAlias("FlowChart", flowChartProps),
    component: FlowChart as ComponentType<unknown>,
  },
  Timeline: {
    propsSchema: timelineProps,
    component: Timeline as ComponentType<unknown>,
  },
  MapInsert: {
    propsSchema: mapInsertProps,
    component: MapInsert as ComponentType<unknown>,
  },
  Callout: {
    propsSchema: withAlias("Callout", calloutProps),
    component: Callout as ComponentType<unknown>,
  },
  EndCard: {
    propsSchema: withAlias("EndCard", endCardProps),
    component: EndCard as ComponentType<unknown>,
  },
  Character: {
    propsSchema: characterProps,
    component: Character as ComponentType<unknown>,
  },
  ImageBackground: {
    propsSchema: imageBackgroundProps,
    component: ImageBackground as ComponentType<unknown>,
  },
  DoodleScene: {
    propsSchema: DoodleScenePropsSchema,
    component: DoodleScene as ComponentType<unknown>,
  },
  QuoteBlock: {
    propsSchema: withAlias("QuoteBlock", quoteBlockProps),
    component: QuoteBlock as ComponentType<unknown>,
  },
  StatGrid: {
    propsSchema: statGridProps,
    component: StatGrid as ComponentType<unknown>,
  },
  BarChart: {
    propsSchema: barChartProps,
    component: BarChart as ComponentType<unknown>,
  },
  Leaderboard: {
    propsSchema: leaderboardProps,
    component: Leaderboard as ComponentType<unknown>,
  },
  Checklist: {
    propsSchema: checklistProps,
    component: Checklist as ComponentType<unknown>,
  },
  BigIdea: {
    propsSchema: bigIdeaProps,
    component: BigIdea as ComponentType<unknown>,
  },
  PyramidDiagram: {
    propsSchema: pyramidProps,
    component: PyramidDiagram as ComponentType<unknown>,
  },
  VennDiagram: {
    propsSchema: vennProps,
    component: VennDiagram as ComponentType<unknown>,
  },
  CycleDiagram: {
    propsSchema: cycleProps,
    component: CycleDiagram as ComponentType<unknown>,
  },
};

export const COMPONENT_NAMES = Object.keys(REGISTRY);

export type RegistryPropsByName = {
  Title: { text: string; subtext?: string };
  Paragraph: { text: string; align?: "left" | "center" };
  AnimatedIllustration: { text: string; visual?: string };
  CodeBlock: { code: string; language?: string; highlightLines?: number[] };
  Terminal: { title?: string; lines: string[]; prompt?: string };
  Image: { src: string; fit?: "contain" | "cover" };
  FlowChart: {
    nodes: (
      | string
      | { label: string; kind?: "start" | "process" | "decision" | "end" }
    )[];
    edges?: ([number, number] | { from: number; to: number; label?: string })[];
    direction?: "left-to-right" | "top-down";
  };
  Timeline: {
    events: {
      label: string;
      description?: string;
      date?: string;
      featured?: boolean;
    }[];
  };
  MapInsert: {
    landforms?: { d: string; kind?: "ridge" | "river" | "plain" }[];
    routes?: { d: string }[];
    markers?: { x: number; y: number; kind?: "start" | "city" | "battle" }[];
  };
  Callout: {
    kind: "info" | "warning" | "success";
    title?: string;
    text: string;
    cta?: string;
  };
  EndCard: { title: string; subtitle?: string; cta?: string };
  Character: { mouthOpen: number };
  ImageBackground: {
    src: string;
    fit?: "cover" | "contain";
    kenBurnsScale?: number;
    textOverlaySrc?: string;
  };
  QuoteBlock: {
    quote: string;
    author?: string;
    source?: string;
    kicker?: string;
  };
  StatGrid: {
    stats: { value: string; label: string; hint?: string; icon?: string }[];
    caption?: string;
  };
  BarChart: {
    bars: {
      label: string;
      value: number;
      display?: string;
      icon?: string;
      caption?: string;
    }[];
    title?: string;
  };
  Leaderboard: {
    entries: {
      name: string;
      score?: string;
      subtitle?: string;
      color?: string;
    }[];
    title?: string;
  };
  Checklist: {
    items: (
      | string
      | {
          text: string;
          description?: string;
          status?: "done" | "pending" | "skip";
          group?: string;
        }
    )[];
    title?: string;
  };
  BigIdea: { text: string; kicker?: string; attribution?: string };
  PyramidDiagram: {
    levels: (string | { label: string; role?: string; icon?: string })[];
    title?: string;
  };
  VennDiagram: {
    sets: (string | { label: string; detail?: string })[];
    center?: string;
  };
  CycleDiagram: {
    stages: (string | { label: string; detail?: string; icon?: string })[];
    title?: string;
    caption?: string;
  };
};
