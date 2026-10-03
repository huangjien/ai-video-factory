import type { ComponentType } from "react";
import { z } from "zod";
import { AnimatedIllustration } from "./components/Illustration.js";
import { BarChart } from "./components/BarChart.js";
import { BigIdea } from "./components/BigIdea.js";
import { Callout } from "./components/Callout.js";
import { Character } from "./components/Character.js";
import { Checklist } from "./components/Checklist.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { Comparison } from "./components/Comparison.js";
import { CycleDiagram } from "./components/CycleDiagram.js";
import { DoodleScene, DoodleScenePropsSchema } from "./components/DoodleScene.js";
import { EndCard } from "./components/EndCard.js";
import { FlowChart } from "./components/FlowChart.js";
import { Image } from "./components/Image.js";
import { ImageBackground } from "./components/ImageBackground.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { Paragraph } from "./components/Paragraph.js";
import { PyramidDiagram } from "./components/PyramidDiagram.js";
import { QuoteBlock } from "./components/QuoteBlock.js";
import { StatGrid } from "./components/StatGrid.js";
import { SvgScene, SvgScenePropsSchema } from "./components/SvgScene.js";
import { Terminal } from "./components/Terminal.js";
import { Timeline } from "./components/Timeline.js";
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
  })
  .passthrough();

const paragraphProps = z
  .object({
    text: z.string().min(1),
    align: z.enum(["left", "center"]).default("center"),
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
  })
  .passthrough();

const flowChartProps = z
  .object({
    nodes: z.array(z.string().min(1)).min(1),
    edges: z
      .array(
        z.tuple([
          z.number().int().nonnegative(),
          z.number().int().nonnegative(),
        ]),
      )
      .default([]),
    direction: z.enum(["left-to-right", "top-down"]).default("left-to-right"),
  })
  .passthrough();

const comparisonSide = z
  .object({
    title: z.string().default(""),
    items: z.array(z.string().min(1)).default([]),
  })
  .passthrough();

const comparisonProps = z
  .object({
    left: comparisonSide.default({ title: "", items: [] }),
    right: comparisonSide.default({ title: "", items: [] }),
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

const calloutProps = z
  .object({
    kind: z.enum(["info", "warning", "success"]).default("info"),
    title: z.string().optional(),
    text: z.string().default(""),
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
  })
  .passthrough();
const leaderboardProps = z
  .object({
    entries: z.array(leaderboardEntry).min(1),
    title: z.string().optional(),
  })
  .passthrough();

const checklistProps = z
  .object({
    items: z
      .array(z.object({ text: z.string().min(1) }).passthrough())
      .min(1),
    title: z.string().optional(),
  })
  .passthrough();

const bigIdeaProps = z
  .object({
    text: z.string().min(1),
    kicker: z.string().optional(),
  })
  .passthrough();

const pyramidProps = z
  .object({
    levels: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

const vennProps = z
  .object({
    sets: z.array(z.string().min(1)).min(1),
    center: z.string().optional(),
  })
  .passthrough();

const cycleProps = z
  .object({
    stages: z.array(z.string().min(1)).min(1),
    title: z.string().optional(),
  })
  .passthrough();

const CALL_OUT_ALIAS: Record<string, string> = {
  icon: "kind",
  content: "text",
};
const COMPARISON_ALIAS: Record<string, string> = {
  left_title: "left.title",
  left_items: "left.items",
  right_title: "right.title",
  right_items: "right.items",
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
  Comparison: COMPARISON_ALIAS,
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
  Comparison: {
    propsSchema: withAlias("Comparison", comparisonProps),
    component: Comparison as ComponentType<unknown>,
  },
  Timeline: {
    propsSchema: timelineProps,
    component: Timeline as ComponentType<unknown>,
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
  SvgScene: {
    propsSchema: SvgScenePropsSchema,
    component: SvgScene as ComponentType<unknown>,
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
    nodes: string[];
    edges?: [number, number][];
    direction?: string;
  };
  Comparison: {
    left: { title: string; items: string[] };
    right: { title: string; items: string[] };
  };
  Timeline: { events: { label: string; description?: string }[] };
  Callout: {
    kind: "info" | "warning" | "success";
    title?: string;
    text: string;
  };
  EndCard: { title: string; subtitle?: string; cta?: string };
  Character: { mouthOpen: number };
  ImageBackground: {
    src: string;
    fit?: "cover" | "contain";
    kenBurnsScale?: number;
  };
  QuoteBlock: { quote: string; author?: string; source?: string };
  StatGrid: { stats: { value: string; label: string }[]; caption?: string };
  BarChart: {
    bars: { label: string; value: number; display?: string }[];
    title?: string;
  };
  Leaderboard: {
    entries: { name: string; score?: string }[];
    title?: string;
  };
  Checklist: { items: { text: string }[]; title?: string };
  BigIdea: { text: string; kicker?: string };
  PyramidDiagram: { levels: string[] };
  VennDiagram: { sets: string[]; center?: string };
  CycleDiagram: { stages: string[]; title?: string };
};
