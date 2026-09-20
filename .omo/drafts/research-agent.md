---
slug: research-agent
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/research-agent.md
approach: Implement doc §55 Research Agent as `vf research <topic>` — produces three artifacts (research.md narrative, sources.yaml provenance, claims.yaml tagged for verification) for human approval. Optional MiniMax `web_search` integration for current facts (degrades to LLM-knowledge-only when unavailable). Storyboard Agent learns a new `--from-research` flag to consume approved research.
---

# Draft: research-agent

## Components (topology ledger)

| id | outcome | status | evidence |
| --- | --- | --- | --- |
| research-package | `@vf/research` package: `buildMessages`, `callResearch` agent, output schema (research.md / sources.yaml / claims.yaml) | active | doc §55 (lines 1128-1158) input/output spec + 6 responsibilities (fact/opinion separation, source recording, uncertainty marking, alternative interpretations, human-confirmation flagging) |
| web-search-tool | `MiniMaxWebSearch` tool adapter using MiniMax Coding Plan `/v1/coding_plan/search` endpoint | active | MiniMax Coding Plan MCP docs (context7 verified earlier): POST `/v1/coding_plan/search` body `{q: "..."}`, response `{organic: [...], related_searches: [...], base_resp: {...}}` |
| agent-storyboard-extension | `@vf/agent-storyboard` gains optional `contextFrom?: { researchPath: string }` input; when set, injects research.md + claims.yaml into the user prompt as supporting evidence (Storyboard Agent still produces its own draft) | active | doc §55 → §53 chain; v0.2 phase 1 just shipped `@vf/agent-storyboard` |
| cli-research | `vf research <topic> [--no-web] [--provider minimax|glm]` CLI verb: scaffolds `projects/<slug>/research/` (or uses existing project), calls the agent, writes all three artifacts + run record | active | doc §39 verb list (new verb); §55 output paths |
| workflow-stage | Add `research` stage to `V01_STAGES` between `init` and `storyboard`; `state.yaml` checkpoints for research; runs/<id>.yaml records the agent call | active | doc §18 stage order; §18.2 invalidation map (research invalidates storyboard and below) |
| docs | README quickstart update + ARCHITECTURE v0.2 phase 2 addendum | active | established pattern from phase 1 |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Web search tool | MiniMax's `web_search` (verified available in Coding Plan MCP) | both providers' knowledge has a cutoff; §55 needs "current facts" | yes (--no-web disables) |
| Web search provider | MiniMax-only (GLM Coding Plan web search not verified in v0.2 phase 1) | doc §6 default `research` is glm-primary → minimax-fallback per §6 example; for web search we invert: minimax-only (because we verified MiniMax has it) | yes (future GLM web search adapter) |
| Output formats | research.md (narrative Markdown with `> **Opinion:** ...` and `> **Fact (source: ...):** ...` callouts); sources.yaml (list of {url, title, accessed, snippet}); claims.yaml (list of {id, claim, status: fact|opinion|uncertain|needs_human, sources: [id]}) | matches §55 responsibilities; opinion/fact distinction via callouts; sources list with provenance; claims tagged for review | yes (extensible) |
| Multiple interpretations | Agent must list ≥2 alternative viewpoints when topic is contested | §55 line 1156; instruction in system prompt | yes |
| Human confirmation flagging | Any claim with status `uncertain` or `needs_human` is surfaced in a `## Needs human review` section at the top of research.md | doc §55 line 1157 ("提出需要人工确认的事实") | yes |
| Storyboard integration | `--from-research` makes research an OPTIONAL input; Storyboard Agent can still work without it | §55 → §53 is a flow; Storyboard Agent independently valid (v0.2 phase 1) | yes |
| Web search cost | Each `web_search` call counts toward tokens in run record; total tokens for research run = LLM tokens + N×search snippets | transparency; doc §62.2 already extended to track these | yes |
| Failure mode | Web search failure → fall back to LLM knowledge with `web_search_failed: true` flag in claims.yaml; NEVER silently pretend we did web search | §55 line 1154 requires marking uncertainty | yes |

## Findings (cited - path:lines)

- `AI_Video_Factory_Design_and_Plan_v1.1.md` §55 (lines 1128-1158): inputs (topic/audience/language/duration); outputs (research/{research.md,sources.yaml,claims.yaml}); 6 agent responsibilities enumerated.
- §18 (lines 732-768): workflow stage machine — `research` stage is implicit in v0.1 (we had `init → storyboard → compile → render → review → final`); §55 implies research precedes storyboard → insert before storyboard.
- §6 (lines 205-247): per-role primary/fallback. §6 example: research role = glm-primary → minimax-fallback. For web search we override because MiniMax has the verified endpoint.
- MiniMax Coding Plan MCP web_search (platform.minimax.io context7): POST `/v1/coding_plan/search`, request body `{q: "..."}`, response shape `{organic: [results], related_searches: [...], base_resp: {...}}`.
- v0.2 phase 1 (just shipped): `@vf/llm`, `@vf/agent-storyboard`, `@vf/cli` `vf storyboard`, run-record schema with provider/model/prompt_hash/tokens/cost. New phase reuses these without modification (only Storyboard Agent gains an optional input).
- Repo state: branch `feat/video-agent-v01` at 26 commits; 99 tests passing.

## Decisions (with rationale)

1. **Web search is opt-in via `--no-web` flag (default on)** — gives users an escape hatch when API budget is tight or topic is evergreen.
2. **Reuse `@vf/llm`'s existing providers** for the narrative LLM call; web search is a *separate* HTTP call layered on top, not a provider substitution. Keeps the Provider interface clean.
3. **`research/` lives inside the project** (e.g. `projects/<slug>/research/`), not a separate top-level dir — keeps the project self-contained and version-controllable as a unit.
4. **No new workflow stage added in v0.2 phase 2** — `vf research` is a one-shot CLI command like `vf storyboard`. Workflow stages (checkpoint/state machine) remain the v0.1 set; research→storyboard handoff is implicit in the human-approval gate on each artifact. Adding `research` as a state-machine stage is a separate small refactor tracked as a stretch goal, not required for §55.

## Scope IN

- `@vf/research` package: prompt builder, research agent, schema types for the three outputs
- `MiniMaxWebSearch` tool inside `@vf/research` (separate from the LLM `Provider` interface — it's a tool call, not a chat)
- `vf research <topic>` CLI verb; writes `research/{research.md,sources.yaml,claims.yaml}` + `runs/<run-id>.yaml`
- `--from-research <dir>` flag on `vf storyboard` to optionally inject approved research as supporting context
- Tests: TDD for the agent (mocked LLM + mocked web search); CLI integration with mock providers
- Docs update

## Scope OUT (Must NOT have)

- No GLM web search adapter (until verified available) — `vf research` falls back to LLM knowledge when MiniMax web fails; explicit log message
- No new workflow stage (no state-machine change); research→storyboard flow is human-mediated via files on disk
- No multi-source triangulation logic (read N sources and cross-reference claims) — single-pass LLM summary; human editor catches conflicts
- No fact-checking service integration (no Google Fact Check Tools API or similar)
- No streaming / tool-use in the LLM call — same restraint as v0.2 phase 1
- No archiving/citation-graph — claims link to source IDs only
- No auto-approval of research output — human reads research.md, edits if needed, then runs `vf storyboard --from-research`

## Open questions

None — MiniMax web_search verified via context7; design locks from v0.2 phase 1 (Provider interface, retry policy, no-credential-persistence invariant) apply unchanged.

## Approval gate
status: plan-written (approved by user 2026-09-20; plan generated same turn)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
Plan: .omo/plans/research-agent.md — 6 todos / 3 waves / F1-F4 verification wave. TL;DR filled last. Delivered with the start-vs-high-accuracy-review question; awaiting user decision. Execution NOT started.
