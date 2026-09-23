---
slug: storyboard-agent
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/storyboard-agent.md
approach: Implement doc §53 (Storyboard Agent) as one CLI command — `vf storyboard <topic>` calls an LLM, produces a draft VDSL storyboard for human approval, hands off to the existing v0.1 `vf preview` pipeline. Both MiniMax and GLM providers wired (§6 model-agnostic), per-call --model flag selects.
---

# Draft: storyboard-agent

## Components (topology ledger)

| id               | outcome                                                                                                                                                                                   | status | evidence                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| llm-providers    | `@vf/llm` package: Provider interface + MiniMax + GLM impls + YAML config (primary/fallback per role, §6)                                                                                 | active | doc §6 lines 205-247; MiniMax OpenAI-compatible `api.minimax.io/v1/chat/completions` Bearer MINIMAX_API_KEY; GLM Coding Plan OpenAI-compatible `api.z.ai/api/coding/paas/v4` Bearer GLM_API_KEY |
| storyboard-agent | `@vf/agent-storyboard` package: prompt template (system role + few-shot examples from §21.1 sample + §13 flowchart), LLM call, response→VDSL parse, reuse `@vf/vdsl` for shape validation | active | doc §53 (lines 1921-1938); §21.1 sample lines 889-922                                                                                                                                           |
| cli-storyboard   | `vf storyboard <topic>` in `@vf/cli`: scaffolds `projects/<slug>/`, writes draft storyboard.yaml, prompts human to edit/approve                                                           | active | doc §53 "Human Approval" + §39 verb                                                                                                                                                             |
| runs-trace       | Extend run records to include provider/model/prompt_hash/tokens/estimated_cost_usd fields per §62.2 lines 2247-2258 (omitted in v0.1, added in v0.2)                                      | active | doc §62.2 lines 2247-2258                                                                                                                                                                       |
| docs             | README quickstart update + ARCHITECTURE addendum for v0.2 Storyboard Agent                                                                                                                | active | doc §66 line 2416                                                                                                                                                                               |

## Open assumptions (announced defaults)

| assumption      | adopted default                                                                                                                         | rationale                                                                     | reversible?                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Model defaults  | MiniMax primary for `storyboard` role, GLM fallback (per §6 example config)                                                             | doc §6 names this exact pairing; user owns both coding plans                  | yes                                              |
| Model IDs       | MiniMax `MiniMax-M3` (reasoning model recommended); GLM `glm-5.3`                                                                     | canonical docs defaults as of 2026-09; both support JSON output               | yes                                              |
| Temperature     | 0.7 for storyboard drafting                                                                                                             | balance creativity vs determinism                                             | yes                                              |
| Prompt template | One system prompt + one user prompt containing topic, audience, duration, language, style; response must be valid VDSL YAML             | reuses doc §21.1 sample + §13 flowchart example as few-shot                   | yes                                              |
| Output location | Draft lands at `projects/<slug>/storyboard/storyboard.yaml`; LLM call records go to `runs/<run-id>.yaml` with prompt_hash, tokens, cost | reuses v0.1 project structure                                                 | yes                                              |
| Credentials     | `MINIMAX_API_KEY`, `GLM_API_KEY` read from `process.env` only; never written to disk or logs                                            | doc §62.2 line 2259 forbids credential persistence                            | one-way (env-level; reversible by rotating keys) |
| Failure mode    | Network/HTTP 4xx/5xx → non-zero exit with readable error naming the provider; NEVER mark a step succeeded when the LLM call failed      | doc §62.1 line 2221 (validation never auto-retries); failures must be visible | yes                                              |

## Findings (cited - path:lines)

- `AI_Video_Factory_Design_and_Plan_v1.1.md` §53 (1921-1938): Storyboard Agent scope: `Script → Storyboard Agent → Storyboard → Human Approval → Render`. In v0.1 the storyboard is hand-written (§62 line 2193). Storyboard Agent replaces the hand-written step in v0.2.
- §6 (205-247): Model-agnostic strategy with primary/fallback per role. Example config names research/script/storyboard/visual/review — storyboard's example pairs `primary: minimax, fallback: glm`.
- §3.2 (146-160): target content categories — AI 技术解释 / 软件工程 / DevOps / AI Agent / LLM / MCP / Coding Agent / 新技术介绍 / 技术教程 / 知识类视频.
- §21.1 (869-932): VDSL schema sample + validation rules — the agent must produce YAML conforming to this schema; existing validator rejects any other shape.
- §39 (1543-1163): CLI verbs — `vf storyboard` is already in the canonical verb list.
- §62.2 (2247-2258): Run-record schema for external model calls (provider, model, prompt_hash, tokens, estimated_cost_usd).
- §67 (2449-2498): Review questions — A.2 "Research/Script/Storyboard should completely independent context?" — answer: yes, separate package.
- MiniMax API: OpenAI-compatible `https://api.minimax.io/v1/chat/completions`, Bearer `MINIMAX_API_KEY`, model `MiniMax-M3` (per platform.minimax.io docs).
- GLM Coding Plan: OpenAI-compatible `https://api.z.ai/api/coding/paas/v4`, Bearer `ZAI_API_KEY` (use `GLM_API_KEY` env name for parity), model `glm-5.3` (per docs.z.ai/devpack).
- Repo state (verified 2026-09-20): v0.1 shipped — 17/17 todos, 68 tests passing, benchmark renders end-to-end. v0.1 outputs (`vf preview/final/validate/status/approve/reject/rollback/resume/new`) consumed unchanged.

## Decisions (with rationale)

1. **No new render code** — agent output goes into the existing storyboard.yaml shape; the entire v0.1 render pipeline (compile → RenderPlan → renderPlanToVideo → faststart) is reused untouched.
2. **One CLI verb, one agent** — `vf storyboard` calls `@vf/agent-storyboard` which calls `@vf/llm`. No multi-agent orchestration in this phase (Pi agent scaffolding is doc §58 — v0.2 phase 5).
3. **No streaming, no tool calls in v0.2 phase 1** — keep the agent to one round-trip JSON output to minimize cost variance. Tool-use agents land in v0.2 phase 3+ (Research Agent per §55).

## Scope IN

- `@vf/llm` package: Provider interface, MiniMaxProvider, GLMProvider, config loader (YAML), retry policy bounded at 3 with 1/2/4s backoff (same policy as v0.1 workflow retry)
- `@vf/agent-storyboard` package: prompts (system + user), response→VDSL parse, TDD with mocked HTTP server
- `vf storyboard <topic> [--model] [--lang] [--duration] [--audience] [--style]` CLI command
- Run-record schema extended with provider/model/prompt_hash/tokens/estimated_cost_usd
- README quickstart update + ARCHITECTURE v0.2 addendum

## Scope OUT (Must NOT have)

- Research Agent (§55) — separate phase
- Script Agent (§55) — separate phase
- TTS / voice (§56) — v0.2 separate phase, edge-tts stays optional
- Review Agent (§57) — separate phase
- Pi extension wrapping (§58) — separate phase
- Tool-use / function-calling in the LLM call — too early, adds failure surface
- Streaming responses — v0.2 phase 2+
- Token-by-token UI feedback — out of scope for CLI

## Open questions

None — both providers verified via context7 against the canonical docs. Defaults adopted (MiniMax primary, GLM fallback) match doc §6 example verbatim.

## Approval gate

status: plan-written (approved by user 2026-09-20; plan generated same turn)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

Plan: .omo/plans/storyboard-agent.md — 8 todos / 3 waves / F1-F4 verification wave. TL;DR filled last. Delivered with the start-vs-high-accuracy-review question; awaiting user decision. Execution NOT started.
