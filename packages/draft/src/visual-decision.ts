/**
 * The decision layer's runtime re-exports for @video/draft consumers.
 *
 * The implementations live in @video/llm (`decision/runtime.ts`) so more
 * than one domain package can wire a surface without a wrong-direction
 * edge. History: the visual-class shadow pass (D2) lived here until the
 * v0.12 measurement retired structured routing — docs/
 * v0.11-decision-provider-plan.md §7.5. What survives is the runtime the
 * remaining surfaces (draft-bar, qa-triage) share.
 */
export {
  createDecisionProvider,
  decisionLogPath,
  isQuotaError,
  resolveDecisionMode,
  warnIfQuotaExhausted,
  type CreateDecisionProviderOptions,
  type DecisionMode,
} from "@video/llm";
