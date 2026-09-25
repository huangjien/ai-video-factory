import type { ComponentType } from "react";
import { z } from "zod";
import { AnimatedIllustration } from "./components/Illustration.js";
import { Callout } from "./components/Callout.js";
import { Character } from "./components/Character.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { Comparison } from "./components/Comparison.js";
import { EndCard } from "./components/EndCard.js";
import { FlowChart } from "./components/FlowChart.js";
import { Image } from "./components/Image.js";
import { ImageBackground } from "./components/ImageBackground.js";
import { Paragraph } from "./components/Paragraph.js";
import { Terminal } from "./components/Terminal.js";
import { Timeline } from "./components/Timeline.js";
import { Title } from "./components/Title.js";

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
const ALIASES_BY_COMPONENT: Record<string, Record<string, string>> = {
  Callout: CALL_OUT_ALIAS,
  Comparison: COMPARISON_ALIAS,
  EndCard: END_CARD_ALIAS,
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
};
