# research-agent - Work Plan

## TL;DR (For humans)

<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A new `vf research "<topic>"` command that gathers facts and source links about any topic, distinguishing what is well-established fact from opinion or uncertain claims, and writing the result into three review-friendly files. A new `--from-research` flag on `vf storyboard` then lets the AI draft consume your approved research when generating the storyboard outline.

**Why this approach:** The video factory already has a Storyboard Agent that drafts from whatever the LLM happens to know. Real videos about real topics need current sources — and a human reviewer needs to see the citations, not just the model's confident prose. Adding research as a separate human-checkpoint step keeps the fact-gathering visible and editable, then the Storyboard Agent uses those approved notes instead of guessing.

**What it will NOT do:** It won't pull from GLM's web search (only MiniMax's — the GLM web search endpoint isn't verified in this environment, so the fallback is "the model uses its training data and we say so explicitly"). No fact-checking service integration, no multi-source triangulation, no streaming.

**Effort:** Short
**Risk:** Low - this phase only adds new packages in front of the existing pipeline; the Storyboard Agent's existing behavior is preserved when `--from-research` isn't passed. Web search failures degrade gracefully to model knowledge with a clear flag in the output.

**Decisions to sanity-check:** Web search enabled by default with a `--no-web` escape hatch (knowledge has a cutoff, so current topics need current sources); MiniMax-only web search (the verified provider); claims tagged `fact` / `opinion` / `uncertain` / `needs_human`, with uncertain/needs_human surfaced at the top of `research.md` so a human can review them first.

Your next move: approve to start execution, or ask for a high-accuracy review of this plan first. Full execution detail follows below.

---

> TL;DR (machine): Short/Low — 6 todos in 3 waves adding a fact-gathering step with optional web search (MiniMax) in front of the existing Storyboard Agent; preserves back-compat; credentials stay in env.

## Scope

> `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` at repo root. `repo` = /Users/huangjien/workspace/ai-video-factory.

### Must have

- `@vf/research` package: prompt builder (`buildMessages`); agent (`callResearch`) that returns `{markdown, sources, claims}`; zod schema for sources/claims shapes.
- `MiniMaxWebSearch` tool: POST to `https://api.minimax.io/v1/coding_plan/search` with `{q: "..."}`; auth `Bearer ${MINIMAX_API_KEY}`; returns the `organic` array (top 5–10 results each with url/title/snippet). Bounded retry (reuses `@vf/llm`'s `withRetry` policy: 3 attempts, no retry on 4xx).
- `callResearch` writes `research/research.md`, `research/sources.yaml`, `research/claims.yaml`. Markdown uses callouts `> **Fact (source: ...):**` vs `> **Opinion:**`; surfaces a top-of-file `## Needs human review` section listing any `uncertain` or `needs_human` claim IDs.
- `vf research <topic> [--no-web] [--provider minimax|glm] [--cwd <dir>]` CLI verb: scaffolds `projects/<slug>/` (reuses `runNew`), calls the agent, writes artifacts, prints summary; records run with provider/model/prompt_hash/tokens (v0.2 schema).
- `--from-research <dir>` flag on `vf storyboard` to inject `research.md` and `claims.yaml` into the storyboard prompt as supporting context (storyboard agent still produces its own draft; research is supporting evidence, not a replacement).
- Tests: TDD for `MiniMaxWebSearch` (mock HTTP server), `callResearch` (canned LLM + canned web responses), CLI integration test (end-to-end via mock providers).
- README quickstart update + ARCHITECTURE v0.2 phase 2 addendum.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No GLM web search adapter — if MiniMax web search fails or isn't requested, fall back to LLM knowledge with explicit `web_search_failed: true` flag in `claims.yaml`. NEVER pretend we did a web search when we didn't.
- No new state-machine stage in `@vf/workflow` — research→storyboard handoff is human-mediated via files on disk; the workflow's `init → storyboard → compile → render → review → final` chain stays unchanged.
- No streaming / tool-use in the LLM call — same restraint as v0.2 phase 1.
- No multi-source triangulation or fact-checking-service integration.
- No credentials written to disk, logs, or run records.
- No auto-approval of research output — human reads `research.md`, edits if needed, then runs `vf storyboard --from-research`.

## Verification strategy

> Zero human intervention - all verification is agent-executed.

- Test decision: **TDD for `@vf/research`** (mock HTTP server for web search + canned LLM responses for agent); **TDD for the `--from-research` flag** (canned storyboard prompt includes research excerpts); **integration tests for CLI** (runStoryboard/runResearch with mock providers, assert artifacts + run records).
- Evidence written to `.omo/evidence/task-<N>-research-agent.<ext>`.
- Back-compat: `vf storyboard` without `--from-research` works exactly as in v0.2 phase 1 — no regression.
- Real-provider smoke test (manual, opt-in): a `vf research.real` that hits MiniMax web search — NEVER part of the default test run (credentials may be absent in CI).

## Execution strategy

### Parallel execution waves

> Target 5-8 todos per wave. Fewer than 3 (except the final) means under-split.

- **Wave 1 — Research foundation:** #1 `@vf/research` package scaffold + zod schemas · #2 `MiniMaxWebSearch` tool (TDD via mock HTTP) · #3 `callResearch` agent (TDD with canned LLM + canned web responses).
- **Wave 2 — CLI + Storyboard integration:** #4 `vf research` CLI verb + integration test (mock providers) · #5 `--from-research` flag on `vf storyboard` + integration test.
- **Wave 3 — Docs:** #6 README quickstart update + ARCHITECTURE v0.2 phase 2 addendum.

### Dependency matrix

| Todo                            | Depends on | Blocks | Can parallelize with |
| ------------------------------- | ---------- | ------ | -------------------- |
| 1 research scaffold + schemas   | —          | 2,3    | —                    |
| 2 MiniMaxWebSearch tool         | 1          | 3,4    | —                    |
| 3 callResearch agent            | 1,2        | 4      | —                    |
| 4 vf research CLI + integration | 1,2,3      | 5      | 6                    |
| 5 --from-research flag          | 4          | —      | 6                    |
| 6 docs                          | 4,5        | —      | —                    |

## Todos

> Implementation + Test = ONE todo. Never separate.

<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

> Shared context for all executors: `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` (repo root). `repo` = /Users/huangjien/workspace/ai-video-factory. MiniMax `web_search` verified via context7 — POST `https://api.minimax.io/v1/coding_plan/search`, Bearer `MINIMAX_API_KEY`, body `{q: "..."}`, response `{organic: [{url,title,snippet}], related_searches: [...], base_resp: {...}}`. Credentials via env only; never persisted. v0.2 phase 1 artifacts (`@vf/llm`, `@vf/agent-storyboard`, `@vf/cli` `vf storyboard`, run-record schema) are reused unchanged.

- [x] 1. `@vf/research` scaffold + zod schemas for sources/claims
      What to do / Must NOT do: Create `packages/research/` with `package.json` (`@vf/research`, deps: `@vf/llm`, `yaml`, `zod`), tsconfig extending base. `src/schemas.ts` defines `SourceSchema` (`{id: string, url: string, title: string, accessed: string (ISO date), snippet: string}`), `ClaimSchema` (`{id: string, claim: string, status: enum["fact","opinion","uncertain","needs_human"], sources: string[] (source ids), note?: string}`), `ResearchOutputSchema` (`{markdown: string, sources: Source[], claims: Claim[], meta: {web_search_used: boolean, web_search_failed: boolean, provider: string, model: string}}`). All zod `.strict()`. `src/prompt.ts` exports `SYSTEM_PROMPT` (instructs fact/opinion callouts, ≥2 alternatives when contested, mark uncertain/needs_human) and `buildMessages({topic, audience, language, duration, webContext?})`. `src/index.ts` re-exports. TDD: schema rejects unknown keys + unknown enum + missing id. Must NOT import any LLM provider here — pure schemas + prompts.
      Parallelization: Wave 1 | Blocked by: — | Blocks: 2,3
      References: doc §55 (1128-1158) — 6 responsibilities; §6 (model-agnostic provider reuse).
      Acceptance criteria (agent-executable): `npm test -- @vf/research` green with schema tests (unknown enum rejected, strict rejects extra keys, claim without sources rejected if status=fact).
      QA scenarios: happy — `npm test -- @vf/research 2>&1 | tee .omo/evidence/task-1-research-agent.log`; failure — add a Claim with `status: "guessing"`, assert strict zod rejects with field path (then revert).
      Commit: Y | `feat(research): schemas + system prompt for fact/opinion/uncertain tagging`

- [x] 2. `MiniMaxWebSearch` tool (TDD via mock HTTP server)
      What to do / Must NOT do: `src/web-search.ts`: `class MiniMaxWebSearch implements WebSearchTool { readonly name = "minimax-web"; async search(query: string): Promise<SearchResult[]> }`. POST `${apiHost}/v1/coding_plan/search` with `{q: query}`; auth header `Authorization: Bearer ${MINIMAX_API_KEY}`; map response `organic[].{url,title,snippet}` to internal `SearchResult`. Uses `@vf/llm`'s `withRetry` (3 attempts, no 4xx retry). Returns up to top 10 results. Throws `WebSearchError` with `{provider: "minimax", status, body_excerpt}` on non-2xx — never logs the key. TDD: spin up local http server; canned `organic: [{url,title,snippet}]` → parses to `SearchResult[]`; canned 401 → throws with `provider` + `status`; canned 500 → retries 3×; missing `MINIMAX_API_KEY` → throws explicit message.
      Parallelization: Wave 1 | Blocked by: 1 | Blocks: 3,4
      References: MiniMax Coding Plan MCP `web_search` (platform.minimax.io context7 — verified earlier).
      Acceptance criteria (agent-executable): `npm test -- @vf/research -t "WebSearch"` green including: happy path returns up to 10 results; 401 throws; missing key throws.
      QA scenarios: happy — `npm test -- @vf/research -t "WebSearch" 2>&1 | tee .omo/evidence/task-2-research-agent.log`; failure — canned 500 then assert retry exhausted (calls === 4).
      Commit: Y | `feat(research): MiniMax web_search tool with bounded retry (TDD)`

- [x] 3. `callResearch` agent (TDD with canned LLM + canned web responses)
      What to do / Must NOT do: `src/agent.ts`: `async function callResearch(input, deps) → ResearchOutput` where deps is `{ provider: Provider, web?: WebSearchTool | null }`. Flow: (1) if web search enabled, run search queries derived from topic, collect top snippets, inject as `webContext` into the user prompt; if web throws, log error + set `meta.web_search_failed = true` + skip web context; (2) call provider.chat; (3) parse response expecting a fenced YAML block containing `{markdown, sources, claims}` keys; if parse fails or schema invalid, throw `ResearchError(message, provider.name, cause)` with the parsed errors. Sources IDs are referenced by claims (validate every claim.sources[i] resolves to a source.id). TDD: canned LLM returning `{markdown: "...", sources: [...], claims: [...]}` with a real source id → success; canned response missing fenced block → ResearchError; canned response with claim referencing unknown source id → ResearchError; web search failure path → output has `web_search_failed: true` + still works.
      Parallelization: Wave 1 | Blocked by: 1,2 | Blocks: 4
      References: doc §55 6 responsibilities (fact/opinion, sources, uncertainty, alternatives, human confirmation flag).
      Acceptance criteria (agent-executable): `npm test -- @vf/research -t "agent"` green including: happy path; missing fenced block → ResearchError; bad claim source id → ResearchError; web failure path.
      QA scenarios: happy — `npm test -- @vf/research -t "agent" 2>&1 | tee .omo/evidence/task-3-research-agent.log`; failure — canned response missing `sources` key → ResearchError naming the missing key (then revert).
      Commit: Y | `feat(research): callResearch agent with optional web + ResearchOutput schema enforcement (TDD)`

- [x] 4. `vf research` CLI verb + integration test (mock providers)
      What to do / Must NOT do: `packages/cli/src/research-command.ts`: `runResearch(opts) → number`. Args: `topic`, `cwd?`, `noWeb?`, `provider?`. Flow: (1) slug = slugify(topic); (2) runNew to scaffold `projects/<slug>/`; (3) instantiate provider (default: minimax primary per §6 research config); (4) instantiate `MiniMaxWebSearch` unless `--no-web`; (5) callResearch; (6) write `research/research.md`, `research/sources.yaml`, `research/claims.yaml` to project; (7) write run record with provider/model/prompt_hash/tokens/cost (v0.2 schema); (8) print summary. CLI wiring: `program.command("research")` with `<topic>`, `--cwd`, `--no-web`, `--model`. TDD integration test: spin up two mock HTTP servers (one for LLM, one for web); canned responses; assert (a) all three files exist, (b) `research.md` includes the `## Needs human review` section if any claim has status uncertain/needs_human, (c) `runs/<id>.yaml` has provider/model/prompt_hash/tokens, (d) no API key in project tree. Must NOT auto-approve.
      Parallelization: Wave 2 | Blocked by: 1,2,3 | Blocks: 5
      References: doc §55 outputs (research.md / sources.yaml / claims.yaml); §39 (new CLI verb).
      Acceptance criteria (agent-executable): integration test exits 0; `vf research --help` shows all options; tree-grep test asserts no API key anywhere.
      QA scenarios: happy — `npm test -- @vf/cli -t "research" 2>&1 | tee .omo/evidence/task-4-research-agent.log`; failure — canned claim with `needs_human` status → research.md MUST contain a `## Needs human review` section (then revert).
      Commit: Y | `feat(cli): vf research wires agent + web search + run records`

- [x] 5. `--from-research` flag on `vf storyboard` (consumes approved research as context)
      What to do / Must NOT do: Extend `StoryboardOptions` in `packages/cli/src/storyboard-command.ts` with `fromResearch?: string`. Extend `AgentInput` in `@vf/agent-storyboard/src/prompt.ts` with `researchContext?: { markdown: string; claims: Claim[] }`. In `runStoryboard`: when `fromResearch` is set, read `<fromResearch>/research.md` and `<fromResearch>/claims.yaml`; if missing, exit 1 with "run vf research first"; pass to `callAgent` which prepends an extra user message block (`## Supporting research\n\n<markdown>\n\nKey claims:\n- [status] claim text (source: url)\n`). TDD: (a) canned LLM response contains a reference to a unique substring from the research.md ("VDSL can model component reuse as a graph" — set in fixture) → assert the substring is in the prompt; (b) when `--from-research` is omitted, prompt does NOT include the substring (back-compat). Must NOT make research required (storyboard works without it — v0.2 phase 1 behavior preserved).
      Parallelization: Wave 2 | Blocked by: 4 | Blocks: —
      References: doc §55 → §53 chain (research is approved input to storyboard); v0.2 phase 1 storyboard agent.
      Acceptance criteria (agent-executable): unit test asserts prompt includes research substring when flag set, excludes when not; integration test `vf storyboard --from-research projects/demo/research` runs end-to-end with mock provider.
      QA scenarios: happy — `npm test -- @vf/agent-storyboard -t "from-research" 2>&1 | tee .omo/evidence/task-5-research-agent.log`; failure — point `--from-research` at a nonexistent dir → CLI exits 1 with readable error.
      Commit: Y | `feat(agent-storyboard): --from-research consumes approved research as supporting context`

- [x] 6. Docs — README quickstart + ARCHITECTURE v0.2 phase 2 addendum
      What to do / Must NOT do: README: add a "## Research Agent (v0.2.2)" section after Storyboard Agent with `vf research "AI 思维链"` example and the full chain `vf research → edit research.md → vf storyboard --from-research`. Update commands table. `ARCHITECTURE.md`: append v0.2 phase 2 section describing `@vf/research` (schemata, web search opt-in, fact/opinion/uncertain tagging, human-confirmation surfacing) and how `vf storyboard --from-research` plugs in. Must NOT document unwritten features (multi-source triangulation, GLM web search, streaming).
      Parallelization: Wave 3 | Blocked by: 4,5 | Blocks: —
      References: doc §55 + §66 line 2418 (research agent second).
      Acceptance criteria (agent-executable): README quickstart literally copy-paste-runnable; ARCHITECTURE references only existing packages (`@vf/research`).
      QA scenarios: happy — `grep -E '@vf/research' README.md ARCHITECTURE.md` returns matches; failure — grep for forbidden tech (MCP/triangulation/GLM web) returns nothing in packages/.
      Commit: Y | `docs: README research section + ARCHITECTURE v0.2 phase 2 addendum`

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy

- One conventional commit per todo after its acceptance criteria pass.
- Branch: extend `feat/video-agent-v01` (which already carries v0.1 + v0.2 phase 1).
- Never commit: `node_modules/`, `.env`, `.env.local`, render outputs, `runs/`, `.omo/evidence/`, `.omo/run-continuation/`.
- `research/` directory inside a project is committed alongside that project's storyboard (treated as part of the project's content).
- v0.2 tag after the plan's final verification wave approves.

## Success criteria

1. **Functional:** `npm test` (99 existing + 6 new v0.2 phase 2 tests) exits 0; `vf research "<topic>"` writes all three artifacts; `vf storyboard --from-research <dir>` produces a storyboard draft whose prompt includes the research context (verified via substring assertion in tests).
2. **Output conformance:** `research.md` uses the fact/opinion callout format; `claims.yaml` validates against `ClaimSchema`; `sources.yaml` validates against `SourceSchema`; any `uncertain` or `needs_human` claim surfaces in the `## Needs human review` section at the top of `research.md`.
3. **Web search safety:** web search failure produces `web_search_failed: true` in meta and never silently fabricates a "we searched" claim; grep test confirms no API key written to disk.
4. **Back-compat:** `vf storyboard` without `--from-research` produces the same prompt as v0.2 phase 1 (assertion in todo 5 test).
5. **Zero forbidden tech:** grep for `triangulation|@google/fact-check|@remotion/cli .*research|mcp|@modelcontextprotocol` in packages/ returns nothing.
6. **All 6 todos checked with evidence files in `.omo/evidence/`; F1–F4 verification wave APPROVE.**
