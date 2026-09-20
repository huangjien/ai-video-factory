import type { ChatMessage, Provider } from "@vf/llm";
import { parse as parseYaml } from "yaml";
import { ReviewPackageSchema, type ReviewPackage } from "./schemas.js";

export interface ReviewInput {
  storyboard: string;
  script: string;
  claims: string;
}

export const SYSTEM_PROMPT = `You are the Review Agent for the AI Video Factory.

Your ONLY job: produce a single review package for a given (storyboard, script,
claims) triple. The package has THREE sections (Content, Visual, Technical).
Each section has its own verdict per field plus an overall verdict
(pass | warn | fail).

Output: ONE fenced YAML code block (\`\`\`yaml ... \`\`\`) with EXACTLY these 3 keys:
  content:    {accuracy, logic, unsupported_claims, contradictions, repetition, overall}
  visual:     {readability, density, pacing, visual_hierarchy, caption_length, overall}
  technical:  {resolution, fps, audio, subtitle, missing_assets, render_errors, overall}

Each overall is one of pass | warn | fail. Field-level statuses are ok |
warn | fail. Array fields (unsupported_claims, contradictions, repetition,
missing_assets, render_errors) are concrete observations — quote or
identify by claim id, scene id, or file path. NO prose outside the YAML.`;

export function buildReviewMessages(input: ReviewInput): ChatMessage[] {
  const userParts = [
    "## Storyboard (VDSL)",
    input.storyboard.slice(0, 4000),
    "\n## Script (Markdown)",
    input.script.slice(0, 4000),
    "\n## Claims (YAML)",
    input.claims.slice(0, 2000),
    "\nProduce the review package YAML.",
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];
}

export class ReviewError extends Error {
  override readonly cause: unknown;
  constructor(message: string, public readonly providerName: string, cause?: unknown) {
    super(message);
    this.name = "ReviewError";
    this.cause = cause;
  }
}

export interface CallReviewResult {
  review: ReviewPackage;
  usage: { input: number; output: number };
}

export function extractYaml(content: string): string {
  const fence = /```(?:yaml)?\s*([\s\S]*?)```/m;
  const match = content.match(fence);
  if (match && match[1]) return match[1].trim();
  return content.trim();
}

export async function callReview(
  input: ReviewInput,
  provider: Provider,
): Promise<CallReviewResult> {
  const messages = buildReviewMessages(input);
  const res = await provider.chat({ messages });
  const yamlText = extractYaml(res.content);
  if (!yamlText) {
    throw new ReviewError("no YAML in response", provider.name);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new ReviewError(`YAML parse failed: ${(err as Error).message}`, provider.name, err);
  }
  const result = ReviewPackageSchema.safeParse(parsed);
  if (!result.success) {
    throw new ReviewError(
      `Review package schema invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      provider.name,
      result.error,
    );
  }
  return { review: result.data, usage: res.usage };
}
