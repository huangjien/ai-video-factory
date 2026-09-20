import { z } from "zod";

/**
 * Script structure — doc §28 (lines 1161-1191).
 * The 7-section narrative spine is a recommended default; user + agent
 * may adjust together (per the doc: "结构由用户和 Agent 共同调整").
 */
export const ScriptSchema = z
  .object({
    hook: z.string().min(1),
    problem: z.string().min(1),
    explanation: z.string().min(1),
    example: z.string().min(1),
    comparison: z.string().min(1),
    implication: z.string().min(1),
    conclusion: z.string().min(1),
  })
  .strict();
export type Script = z.infer<typeof ScriptSchema>;

export const SCRIPT_SECTIONS = [
  "hook",
  "problem",
  "explanation",
  "example",
  "comparison",
  "implication",
  "conclusion",
] as const;
