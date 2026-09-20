import { z } from "zod";

export interface RegistryEntry {
  propsSchema: z.ZodTypeAny;
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
 * (§21.1 line 928). React components attach in todos 8-9. */
export const REGISTRY: Record<string, RegistryEntry> = {
  Title: { propsSchema: titleProps },
  Paragraph: { propsSchema: paragraphProps },
  CodeBlock: { propsSchema: codeBlockProps },
  Terminal: { propsSchema: terminalProps },
  Image: { propsSchema: imageProps },
  FlowChart: { propsSchema: flowChartProps },
  Comparison: { propsSchema: comparisonProps },
  Timeline: { propsSchema: timelineProps },
  Callout: { propsSchema: calloutProps },
  EndCard: { propsSchema: endCardProps },
};

export const COMPONENT_NAMES = Object.keys(REGISTRY);
