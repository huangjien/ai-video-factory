import type { ComponentType } from "react";
import { z } from "zod";
import { AnimatedIllustration } from "./components/Illustration.js";
import { Character } from "./components/Character.js";
import { CodeBlock } from "./components/CodeBlock.js";
import {
  DoodleScene,
  DoodleScenePropsSchema,
} from "./components/DoodleScene.js";
import { EndCard } from "./components/EndCard.js";
import { Image } from "./components/Image.js";
import { ImageBackground } from "./components/ImageBackground.js";
import { VideoBackground } from "./components/VideoBackground.js";
import { Paragraph } from "./components/Paragraph.js";
import { Title } from "./components/Title.js";

export interface RegistryEntry {
  propsSchema: z.ZodTypeAny;
  component: ComponentType<unknown>;
}

/**
 * Component registry (§23) — validation target for `visual.component`
 * (§21.1 line 928). The storyboard agent (LLM) is creative with props:
 * it invents extra keys ("Title.subtitle", "cta_url"),
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
    /** Bullet items under the title ("a · b · c" line) — present only
     *  when the scene's content really enumerates. */
    bullets: z.array(z.string().min(1)).min(2).max(6).optional(),
    /** Small uppercase kicker above the title (e.g. "Chapter One"). */
    kicker: z.string().optional(),
    /** Hex accent color override; defaults to theme.accent. */
    accent: z.string().optional(),
    /** Which artistic treatment the card uses: "kai" (horizontal brush
     *  楷 face) or "brush" (vertical running-brush column). Plain
     *  string so a typo in a hand-edited storyboard falls back to the
     *  default instead of failing validation. */
    style: z.string().optional(),
    /** Scene art behind the card — a data URL the renderer resolves
     *  from `assets/images/scene_N.jpg`. */
    artSrc: z.string().optional(),
    /** The font file for `style`, as a data URL the renderer resolves
     *  from the workspace's `assets/fonts/`. */
    fontSrc: z.string().optional(),
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

const imageProps = z
  .object({
    src: z.string().min(1),
    fit: z.enum(["contain", "cover"]).default("contain"),
    alt: z.string().optional(),
    caption: z.string().optional(),
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
    fit: z.enum(["cover", "contain"]).default("contain"),
    kenBurnsScale: z.number().min(0).max(0.5).default(0),
    /** v0.12: transparent PNG key-info title from the Pillow
     *  text-overlay pass. Composited between the background image
     *  and the bottom captions strip. */
    textOverlaySrc: z.string().optional(),
  })
  .passthrough();

const videoBackgroundProps = z
  .object({
    /** staticFile() path inside the Remotion public dir — the render
     *  step copies assets/video/scene_N.mp4 there before rendering. */
    videoSrc: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
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
const leaderboardEntry = z
  .object({
    name: z.string().min(1),
    score: z.string().optional(),
    subtitle: z.string().optional(),
    color: z.string().optional(),
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
const vennSet = z
  .object({
    label: z.string().min(1),
    detail: z.string().optional(),
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
const END_CARD_ALIAS: Record<string, string> = {
  cta_text: "cta",
  disclaimer: "subtitle",
};
const ALIASES_BY_COMPONENT: Record<string, Record<string, string>> = {
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
  Image: {
    propsSchema: imageProps,
    component: Image as ComponentType<unknown>,
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
  VideoBackground: {
    propsSchema: videoBackgroundProps,
    component: VideoBackground as ComponentType<unknown>,
  },
  DoodleScene: {
    propsSchema: DoodleScenePropsSchema,
    component: DoodleScene as ComponentType<unknown>,
  },
};

export const COMPONENT_NAMES = Object.keys(REGISTRY);

export type RegistryPropsByName = {
  Title: { text: string; subtext?: string; bullets?: string[] };
  Paragraph: { text: string; align?: "left" | "center" };
  AnimatedIllustration: { text: string; visual?: string };
  CodeBlock: { code: string; language?: string; highlightLines?: number[] };
  Image: { src: string; fit?: "contain" | "cover" };
  EndCard: { title: string; subtitle?: string; cta?: string };
  Character: { mouthOpen: number };
  ImageBackground: {
    src: string;
    fit?: "cover" | "contain";
    kenBurnsScale?: number;
    textOverlaySrc?: string;
  };
  VideoBackground: {
    videoSrc: string;
    fit?: "cover" | "contain";
  };
};
