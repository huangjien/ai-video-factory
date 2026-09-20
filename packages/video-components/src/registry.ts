import type { ComponentType } from "react";
import { z } from "zod";
import { Callout, type CalloutProps } from "./components/Callout.js";
import { CodeBlock, type CodeBlockProps } from "./components/CodeBlock.js";
import { Comparison, type ComparisonProps } from "./components/Comparison.js";
import { EndCard, type EndCardProps } from "./components/EndCard.js";
import { FlowChart, type FlowChartProps } from "./components/FlowChart.js";
import { Image, type ImageProps } from "./components/Image.js";
import { Paragraph, type ParagraphProps } from "./components/Paragraph.js";
import { Terminal, type TerminalProps } from "./components/Terminal.js";
import { Timeline, type TimelineProps } from "./components/Timeline.js";
import { Title, type TitleProps } from "./components/Title.js";

export interface RegistryEntry {
  propsSchema: z.ZodTypeAny;
  component: ComponentType<unknown>;
}

const titleProps = z
  .object({
    text: z.string().min(1),
    subtext: z.string().optional(),
  })
  .strict();

const paragraphProps = z
  .object({
    text: z.string().min(1),
    align: z.enum(["left", "center"]).default("center"),
  })
  .strict();

const codeBlockProps = z
  .object({
    code: z.string().min(1),
    language: z.string().default("text"),
    highlightLines: z.array(z.number().int().positive()).default([]),
  })
  .strict();

const terminalProps = z
  .object({
    title: z.string().optional(),
    lines: z.array(z.string().min(1)).min(1),
    prompt: z.string().default("$"),
  })
  .strict();

const imageProps = z
  .object({
    src: z.string().min(1),
    fit: z.enum(["contain", "cover"]).default("contain"),
  })
  .strict();

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
  .strict();

const comparisonSide = z
  .object({
    title: z.string().min(1),
    items: z.array(z.string().min(1)).min(1),
  })
  .strict();

const comparisonProps = z
  .object({
    left: comparisonSide,
    right: comparisonSide,
  })
  .strict();

const timelineProps = z
  .object({
    events: z
      .array(
        z
          .object({
            label: z.string().min(1),
            description: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const calloutProps = z
  .object({
    kind: z.enum(["info", "warning", "success"]),
    title: z.string().optional(),
    text: z.string().min(1),
  })
  .strict();

const endCardProps = z
  .object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    cta: z.string().optional(),
  })
  .strict();

/** Component registry (§23) — validation target for `visual.component`
 * (§21.1 line 928) and the renderer lookup table. */
export const REGISTRY: Record<string, RegistryEntry> = {
  Title: { propsSchema: titleProps, component: Title as ComponentType<unknown> },
  Paragraph: { propsSchema: paragraphProps, component: Paragraph as ComponentType<unknown> },
  CodeBlock: { propsSchema: codeBlockProps, component: CodeBlock as ComponentType<unknown> },
  Terminal: { propsSchema: terminalProps, component: Terminal as ComponentType<unknown> },
  Image: { propsSchema: imageProps, component: Image as ComponentType<unknown> },
  FlowChart: { propsSchema: flowChartProps, component: FlowChart as ComponentType<unknown> },
  Comparison: { propsSchema: comparisonProps, component: Comparison as ComponentType<unknown> },
  Timeline: { propsSchema: timelineProps, component: Timeline as ComponentType<unknown> },
  Callout: { propsSchema: calloutProps, component: Callout as ComponentType<unknown> },
  EndCard: { propsSchema: endCardProps, component: EndCard as ComponentType<unknown> },
};

export const COMPONENT_NAMES = Object.keys(REGISTRY);

export type RegistryPropsByName = {
  Title: TitleProps;
  Paragraph: ParagraphProps;
  CodeBlock: CodeBlockProps;
  Terminal: TerminalProps;
  Image: ImageProps;
  FlowChart: FlowChartProps;
  Comparison: ComparisonProps;
  Timeline: TimelineProps;
  Callout: CalloutProps;
  EndCard: EndCardProps;
};
