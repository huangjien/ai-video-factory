import {
  storyboardSchema,
  type TimelineAnimation,
} from "@vf/vdsl";
import type { ChatMessage, ChatResponse, Provider } from "@vf/llm";
import { chatWithFallback } from "@vf/llm";
import { parse as parseYaml } from "yaml";
import { validateMotionSpec, type MotionSpec } from "./plan.js";
import { buildMotionMessages, type MotionAgentSceneInput } from "./prompt.js";

/**
 * Motion Agent (plan T4.2): LLM-planned motion for one scene, strictly
 * validated against the VDSL schema. Never partially trusted — callers get
 * a parsed spec or an AgentError, and the CLI falls back to the
 * deterministic baseline on any failure (AD-5 layering).
 */

export class MotionAgentError extends Error {
  readonly provider: string;
  constructor(message: string, provider: string) {
    super(message);
    this.name = "MotionAgentError";
    this.provider = provider;
  }
}

/** Strip ```yaml fences (same habit as the other agents). */
export function extractMotionYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export interface MotionAgentResult {
  spec: MotionSpec;
  usage: { input: number; output: number };
  providerName: string;
  messages: ChatMessage[];
}

export async function callMotionAgent(
  input: MotionAgentSceneInput,
  provider: Provider,
  opts: { model?: string; temperature?: number } = {},
  fallback?: Provider | null,
): Promise<MotionAgentResult> {
  const messages = buildMotionMessages(input);
  const out = await chatWithFallback(provider, fallback ?? null, {
    messages,
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  const res: ChatResponse = out.response;
  try {
    const spec = parseMotionSpec(res.content, input);
    return {
      spec,
      usage: res.usage,
      providerName: out.provider,
      messages,
    };
  } catch (err) {
    throw new MotionAgentError(
      (err as Error).message,
      out.provider,
    );
  }
}

/** Parse + strictly validate model output into a MotionSpec. Throws with a
 * precise message on any deviation — the caller falls back to baseline. */
export function parseMotionSpec(
  content: string,
  input: MotionAgentSceneInput,
): MotionSpec {
  const yamlText = extractMotionYaml(content);
  if (!yamlText) throw new Error("no YAML in model response");
  const parsed = parseYaml(yamlText) as {
    animations?: TimelineAnimation[];
    transition?: { in?: string; out?: string };
  } | null;
  if (!parsed || !Array.isArray(parsed.animations) || parsed.animations.length === 0) {
    throw new Error("model output has no animations[]");
  }
  // Strict, schema-shaped probe: storyboardSchema rejects unknown keys and
  // canonicalizes enum synonyms via the same preprocessors the pipeline
  // uses — the model never smuggles unsupported config into the file.
  const probe = {
    schema_version: "0.2" as const,
    project: {
      id: "motion-probe",
      language: "zh-CN" as const,
      fps: 30,
      width: 1920,
      height: 1080,
    },
    scenes: [
      {
        id: input.sceneId,
        duration: input.durationSec,
        visual: { component: input.component, props: {} },
        animations: parsed.animations,
        ...(parsed.transition
          ? {
              transition: {
                in: parsed.transition.in ?? "fade",
                out: parsed.transition.out ?? "fade",
              },
            }
          : {}),
      },
    ],
  };
  const shape = storyboardSchema.safeParse(probe);
  if (!shape.success) {
    const first = shape.error.issues[0];
    throw new Error(
      `model motion spec invalid: ${first?.path.join(".")} — ${first?.message}`,
    );
  }
  const scene = shape.data.scenes[0]!;
  const spec: MotionSpec = {
    animations: scene.animations ?? [],
    transition: {
      in: scene.transition?.in ?? "fade",
      out: scene.transition?.out ?? "fade",
    },
  };
  const problems = validateMotionSpec(spec, input.durationSec);
  if (problems.length > 0) {
    throw new Error(`model motion spec invalid: ${problems.join("; ")}`);
  }
  return spec;
}
