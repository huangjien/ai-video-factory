# storyboard-agent - Work Plan

## TL;DR (For humans)

<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A new `vf storyboard <topic>` command that asks an AI to draft a video outline for any topic you give it, then hands the outline to you for review before the existing video factory renders it. You can choose which AI (MiniMax or GLM) handles the drafting.

**Why this approach:** The v0.1 system already knows how to render any outline you hand it — the missing piece was having AI generate that first draft. Both providers are wired so the same command works whether you prefer MiniMax or GLM, and you stay in control: the AI's draft always waits for your approval before any rendering starts. API keys live only in environment variables and are never written to disk, so they can't accidentally leak into Git.

**What it will NOT do:** It won't call any other AI tools (search, image generation), won't stream tokens to a UI, and won't run alongside AI research/script/review agents — those are deliberately the next phases.

**Effort:** Short
**Risk:** Low - the v0.1 render pipeline is untouched; we only add an AI drafting step in front of the existing human-approval gate. Provider failure (no key, network down, rate limit) exits non-zero with a readable error so the workflow stays in DRAFT for retry.

**Decisions to sanity-check:** MiniMax as the default AI for storyboard drafting with GLM as the fallback (matches the design doc's example); draft lands at `projects/<topic-slug>/storyboard/storyboard.yaml` for editing before approval.

Your next move: approve to start execution, or ask for a high-accuracy review of this plan first. Full execution detail follows below.

---

> TL;DR (machine): Short/Low — 8 todos in 3 waves adding an AI storyboard drafting step in front of the existing human-gated render pipeline; both MiniMax and GLM providers wired with credential-safe defaults.

## Scope

> `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` at repo root. `repo` = /Users/huangjien/workspace/ai-video-factory.

### Must have

- `@vf/llm` package: `Provider` interface (`chat({messages, model?, temperature?}) → {content, usage}`), `MiniMaxProvider` (OpenAI-compatible `https://api.minimax.io/v1/chat/completions`, Bearer `MINIMAX_API_KEY`), `GLMProvider` (OpenAI-compatible `https://api.z.ai/api/coding/paas/v4`, Bearer `GLM_API_KEY`), YAML config loader with primary/fallback per role (matches doc §6 example).
- `@vf/llm` retry policy: max 3 attempts, 1/2/4s backoff for transient network/5xx/HTTP-timeout; **never retry** 4xx client errors; throw on exhaustion with provider + status code.
- `@vf/agent-storyboard` package: prompt template (system role constrains output to VDSL YAML; user prompt contains topic, audience, duration, language, style; few-shot includes doc §21.1 sample and §13 flowchart example); `callAgent(topic, opts) → Storyboard` reuses `@vf/vdsl`'s `validateStoryboard` and returns parsed Storyboard or throws structured error with provider + raw response excerpt (no raw key leak).
- `vf storyboard <topic> [--model minimax|glm] [--lang zh-CN] [--duration 40] [--audience developers] [--style dark-tech]` CLI command: scaffolds `projects/<slug>/` via `vf new`, then calls agent, writes draft to `projects/<slug>/storyboard/storyboard.yaml`, prints the agent record summary, prompts human to `vf approve storyboard`.
- Run records extended: `runs/<run-id>.yaml` adds `provider`, `model`, `prompt_hash` (sha256 of system+user messages), `tokens: {input, output}`, `estimated_cost_usd` (per doc §62.2 lines 2247-2258).
- README quickstart updated with `vf storyboard` flow; `ARCHITECTURE.md` addendum for v0.2 Storyboard Agent.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No credentials ever written to disk, logs, run records, prompt records, or anywhere in Git (doc §62.2 line 2259).
- No new render code — agent output reuses v0.1's `@vf/vdsl` + `@vf/video-renderer` chain untouched.
- No streaming, tool-use, multi-agent orchestration, Research/Script/Review agents, TTS, Pi extension, web search in the LLM call (deferred to v0.2 phases 2–5 per doc §66 lines 2414-2440).
- No silently swallowing LLM errors; the CLI exit code is non-zero with the provider and HTTP status named.
- No auto-approval of the generated draft — `vf storyboard` always requires explicit `vf approve storyboard` before `vf preview`.

## Verification strategy

> Zero human intervention - all verification is agent-executed.

- Test decision: **TDD for `@vf/llm`** (mock HTTP server with `node:http`; fixture provider responses per test); **TDD for `@vf/agent-storyboard`** (mock provider returns canned storyboard YAML; assert parsed Storyboard + VDSL conformance + provider + token usage); **tests-after for the CLI wiring** (run `vf storyboard` against the mock provider, assert draft file is written, validate passes, preview renders).
- Evidence written to `.omo/evidence/task-<N>-storyboard-agent.<ext>` (transcript or JSON).
- Real-provider smoke test (manual, opt-in): a `vf storyboard.real` script that hits the actual MiniMax/GLM endpoint — NEVER part of the default test run (credentials may be absent in CI).
- Determinism: prompt hashing uses sha256 of the exact `messages` array; same prompt + temperature=0 + seed should produce identical output. We do not assert provider-side determinism (the providers don't expose seeds in their OpenAI-compatible surface), but we assert prompt_hash is stable.

## Execution strategy

### Parallel execution waves

> Target 5-8 todos per wave. Fewer than 3 (except the final) means under-split.

- **Wave 1 — LLM provider foundation:** #1 `@vf/llm` package scaffold + Provider interface · #2 MiniMaxProvider impl (TDD via mock) · #3 GLMProvider impl (TDD via mock). Sequential (each builds on #1's interface).
- **Wave 2 — Agent + CLI:** #4 agent-storyboard package (TDD with canned responses) · #5 `vf storyboard` CLI verb · #6 CLI integration test (`vf storyboard` → `vf validate` → `vf preview` end-to-end with mock provider).
- **Wave 3 — Run records + docs:** #7 Extend `runs/*.yaml` schema with provider/model/prompt_hash/tokens/cost fields (per doc §62.2) · #8 README + ARCHITECTURE updates.

### Dependency matrix

| Todo                   | Depends on | Blocks | Can parallelize with |
| ---------------------- | ---------- | ------ | -------------------- |
| 1 llm scaffold         | —          | 2,3,4  | —                    |
| 2 MiniMax provider     | 1          | 4      | 3                    |
| 3 GLM provider         | 1          | 4      | 2                    |
| 4 agent-storyboard     | 1,2,3      | 5      | —                    |
| 5 vf storyboard CLI    | 4          | 6      | 7                    |
| 6 CLI integration test | 5          | —      | 7,8                  |
| 7 run records schema   | —          | 8      | 5,6                  |
| 8 docs                 | 6,7        | —      | —                    |

## Todos

> Implementation + Test = ONE todo. Never separate.

<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

> Shared context for all executors: `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` (repo root). Monorepo root = repo root. Both providers verified via context7 — MiniMax OpenAI-compatible `api.minimax.io/v1/chat/completions`, GLM Coding Plan OpenAI-compatible `api.z.ai/api/coding/paas/v4`. Credentials via env only; never persisted.

- [x] 1. `@vf/llm` scaffold + Provider interface
      What to do / Must NOT do: Create `packages/llm/` with `package.json` (`@vf/llm`, deps: none; native fetch on Node 22+), `tsconfig.json` extending base, `src/provider.ts` exporting `ChatRequest`, `ChatResponse`, `Usage`, `ChatError` types and `interface Provider { name: string; chat(req: ChatRequest): Promise<ChatResponse> }`. `src/config.ts` exports `loadProviderConfig(path?) → Record<Role, {primary: string; fallback?: string}>` reading `llm.config.yaml` (defaulted to repo root). `src/retry.ts` exports `withRetry(fn, {sleeps, isRetriable})` — bounded 3 attempts, non-retriable on 4xx. `src/index.ts` re-exports. Must NOT import any provider implementation here; pure interface only. Must NOT take credentials from anywhere but `process.env`.
      Parallelization: Wave 1 | Blocked by: — | Blocks: 2,3,4
      References: doc §6 lines 205-247 (model-agnostic strategy + per-role primary/fallback); §62.1 lines 2208-2226 (retry policy).
      Acceptance criteria (agent-executable): `npm test -- @vf/llm` green with at least: interface-shape test (a fake provider impl satisfies `Provider`), retry test (transient 5xx retried 3×; 4xx not retried; exhaustion throws with attempts count).
      QA scenarios (name the exact tool + invocation): happy — `npm run build && npm run lint && npm test -- @vf/llm` all green, evidence `npm test -- @vf/llm 2>&1 | tee .omo/evidence/task-1-storyboard-agent.log`; failure — temporarily change retry sleeps to [1,1]ms and inject a 4xx error, assert `isRetriable` returns false and the call throws after exactly 1 attempt (then revert).
      Commit: Y | `feat(llm): Provider interface + retry + config loader`

- [x] 2. MiniMaxProvider (TDD via mock HTTP server)
      What to do / Must NOT do: `src/minimax.ts`: POST to `${apiHost}/v1/chat/completions` with `{model, messages, temperature}`; auth header `Authorization: Bearer ${MINIMAX_API_KEY}`; read `${MINIMAX_API_KEY}` and `${MINIMAX_API_HOST}` (default `https://api.minimax.io`) from env; map non-2xx → `ChatError` with `{provider: "minimax", status, body_excerpt (max 200 chars, no keys)}`; map 200 → `{content: choices[0].message.content, usage: {input: usage.prompt_tokens, output: usage.completion_tokens}}`. Default model `MiniMax-M3`. Use `fetch` (Node 22 native). TDD: spin up a local `http.createServer` returning canned MiniMax response JSON, assert provider parses correctly; canned 401 response → ChatError; canned network failure → withRetry exhausts and throws. Must NOT log the API key. Must NOT swallow non-JSON responses.
      Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4
      References: MiniMax `POST /v1/chat/completions` (platform.minimax.io docs) — model `MiniMax-M3`, Bearer auth, OpenAI-compatible response shape `{choices: [{message: {content}}], usage: {prompt_tokens, completion_tokens}}`.
      Acceptance criteria (agent-executable): `npm test -- @vf/llm` green including: happy path returns `content` + `usage` from canned fixture; 401 → throws ChatError with `provider: "minimax"` and `status: 401`; missing env `MINIMAX_API_KEY` throws with explicit "MINIMAX_API_KEY not set" message.
      QA scenarios (name the exact tool + invocation): happy — `npm test -- @vf/llm -t "MiniMax" 2>&1 | tee .omo/evidence/task-2-storyboard-agent.log`; failure — canned 500 response, retry exhausts after 3 attempts (assert `attempts === 3`), then reverts via fixture change.
      Commit: Y | `feat(llm): MiniMaxProvider OpenAI-compatible chat client (TDD)`

- [x] 3. GLMProvider (TDD via mock HTTP server)
      What to do / Must NOT do: `src/glm.ts`: POST to `https://api.z.ai/api/coding/paas/v4/chat/completions` (Coding Plan endpoint per docs.z.ai/devpack); auth header `Authorization: Bearer ${GLM_API_KEY}`; read `GLM_API_KEY` from env; map responses identically to MiniMax (OpenAI-compatible); default model `glm-5.3`. TDD with mock HTTP server, identical pattern to todo 2. Must NOT reuse code by exporting from minimax.ts (separate files for clarity + testability). Must NOT log the key.
      Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4
      References: GLM Coding Plan OpenAI Chat Completions `https://api.z.ai/api/coding/paas/v4` (docs.z.ai/devpack/tool/others); default coding model `glm-5.3`.
      Acceptance criteria (agent-executable): `npm test -- @vf/llm` green including: happy path returns parsed content + usage; missing `GLM_API_KEY` env throws with explicit message; 401 throws ChatError with `provider: "glm"`.
      QA scenarios (name the exact tool + invocation): happy — `npm test -- @vf/llm -t "GLM" 2>&1 | tee .omo/evidence/task-3-storyboard-agent.log`; failure — canned 429 response with `Retry-After: 2` header is honored by backoff (test the sleeps array is consumed).
      Commit: Y | `feat(llm): GLMProvider OpenAI-compatible Coding Plan client (TDD)`

- [x] 4. `@vf/agent-storyboard` package (TDD with canned responses)
      What to do / Must NOT do: `packages/agent-storyboard/` with `package.json` (`@vf/agent-storyboard`, deps: `@vf/llm`, `@vf/vdsl`). `src/prompt.ts`: `buildMessages({topic, audience, duration, language, style}) → ChatRequest["messages"]` — system prompt instructs "Output ONLY valid VDSL 0.1 YAML (schema_version 0.1, project, scenes array). No prose outside YAML. Code block fenced with ``yaml."; user prompt contains topic + audience + duration in seconds + language + style; system also injects few-shot examples (the doc §21.1 sample trimmed + the §13 flowchart YAML example trimmed). `src/agent.ts`: `callAgent(input, provider, opts) → { storyboard: Storyboard; usage: Usage }` — call provider, extract YAML from response (strip `` fences if present), parse via `yaml.parse`, validate via `validateStoryboard`, throw `AgentError` with provider name + parsed errors if validation fails; record usage. `src/index.ts`: exports. TDD: canned provider returning doc §21.1 sample → agent returns valid Storyboard; canned response with extra prose around YAML → agent strips and parses; canned response with invalid VDSL → throws with file/line/field errors. Must NOT call the real provider in tests. Must NOT mutate the input Storyboard.
      Parallelization: Wave 2 | Blocked by: 1,2,3 | Blocks: 5
      References: doc §21.1 lines 889-922 (VDSL sample); §13 lines 604-618 (flowchart example); §6 lines 205-247 (provider config); §3.2 lines 146-160 (target content categories).
      Acceptance criteria (agent-executable): `npm test -- @vf/agent-storyboard` green including: happy — canned §21.1 sample parses to Storyboard with 2 scenes; strips fenced code blocks; rejects prose-only response with `AgentError("no YAML in response", provider)`; rejects invalid VDSL (missing schema_version) with the VDSL error chain intact.
      QA scenarios (name the exact tool + invocation): happy — `npm test -- @vf/agent-storyboard 2>&1 | tee .omo/evidence/task-4-storyboard-agent.log`; failure — canned response that's "`yaml\nfoo: bar\n`" (not VDSL) must throw AgentError with file/line/field errors from validateStoryboard (then revert fixture).
      Commit: Y | `feat(agent-storyboard): prompts + VDSL conformance with provider usage tracking (TDD)`

- [x] 5. `vf storyboard` CLI verb
      What to do / Must NOT do: In `packages/cli/src/storyboard-command.ts`: `runStoryboard(topic, opts)` — `slug = slugify(topic)`; `root = projects/<slug>/`; if exists, error with "project already exists"; else spawn `vf new <slug>` (call `runNew` directly), then call `callAgent(input, providerInstance, {model})` writing a run record `runs/<run-id>.yaml` with the extended schema (provider/model/prompt_hash/tokens/cost); write draft to `projects/<slug>/storyboard/storyboard.yaml`; print summary (provider, tokens, scene count); advise "next: edit storyboard, then `vf approve storyboard` then `vf preview`". CLI wiring: `program.command("storyboard")` with arg `<topic>`, options `--model` (default from config), `--lang` (default zh-CN), `--duration` (default 40 seconds), `--audience` (default developers), `--style` (default dark-tech). Provider selection: load config; resolve role=storyboard → primary (default minimax), fallback (glm). Must NOT log the prompt or response body. Must NOT auto-approve the draft.
      Parallelization: Wave 2 | Blocked by: 4 | Blocks: 6
      References: doc §39 line 1543 (`vf storyboard` verb); §53 lines 1921-1938 (storyboard agent semantics); §62.2 lines 2247-2258 (run-record extension fields); §62.2 line 2259 (no credentials in records).
      Acceptance criteria (agent-executable): `npm test -- @vf/cli` green; CLI integration test (todo 6) exercises end-to-end with a stub provider; `vf storyboard --help` lists all options.
      QA scenarios: happy — `npm run build && npm run lint && npm test -- @vf/cli 2>&1 | tee .omo/evidence/task-5-storyboard-agent.log`; failure — passing `--duration foo` (non-numeric) fails CLI parsing before agent runs (revert if test asserts otherwise).
      Commit: Y | `feat(cli): vf storyboard wires agent to project scaffold + run records`

- [x] 6. CLI integration test — `vf storyboard` → `vf validate` → `vf preview` end-to-end (mock provider)
      What to do / Must NOT do: Vitest integration test in `packages/cli/src/storyboard-integration.test.ts`: spin up a local http server returning a canned MiniMax-compatible response (the doc §21.1 sample); set `MINIMAX_API_KEY=test-key` and `MINIMAX_API_HOST=http://localhost:<port>` in `process.env`; invoke `runStoryboard("AI 思维链")`; assert (a) `projects/ai/storyboard/storyboard.yaml` exists and parses via `validateStoryboard`, (b) `runs/<run-id>.yaml` exists with `provider: "minimax"`, `model: "MiniMax-M3"`, `tokens.input > 0`, `tokens.output > 0`, `prompt_hash` is a stable sha256, (c) no key value appears anywhere in `projects/ai/` or `runs/`. Then call `runValidate` on the draft and `runPreview` (mock render — see below) and assert preview.mp4 ffprobe reports 1920x1080@30fps. The render test should stub `renderPlanToVideo` OR use a 1-scene 1-second draft (short render for test speed). Must NOT call real APIs.
      Parallelization: Wave 2 | Blocked by: 5 | Blocks: —
      References: doc §53 (storyboard → human approval → render chain); §62.2 (run records).
      Acceptance criteria (agent-executable): the integration test exits 0 and produces both `draft.yaml` and `runs/<id>.yaml`; ffprobe assertion matches within tolerance.
      QA scenarios: happy — `npm test -- @vf/cli -t "storyboard" 2>&1 | tee .omo/evidence/task-6-storyboard-agent.log`; failure — assert no value containing "test-key" appears in `projects/ai/` (grep test).
      Commit: Y | `test(cli): storyboard end-to-end with mock MiniMax server`

- [x] 7. Run-record schema extended (provider/model/prompt_hash/tokens/cost)
      What to do / Must NOT do: Update `@vf/workflow/src/runs.ts` `RunRecord` interface: add `provider?: string`, `model?: string`, `prompt_hash?: string` (sha256 of canonical JSON of `messages`), `tokens?: {input: number; output: number}`, `estimated_cost_usd?: number`. Add helper `sha256OfMessages(messages: ChatMessage[]): string` in `@vf/llm` (canonicalize array, JSON stringify, sha256). TDD: existing `runs.test.ts` continues to pass (new fields optional); new test writes a record with provider/model/tokens and round-trips through `writeRun`/`listRuns`. Must NOT make any new field required (v0.1 records remain valid). Must NOT write any credential-like field.
      Parallelization: Wave 3 | Blocked by: — | Blocks: 8
      References: doc §62.2 lines 2247-2258 (new fields); §62.2 line 2259 (no credentials).
      Acceptance criteria (agent-executable): `npm test` green (all 68 v0.1 tests + new schema tests); a record with `provider: "minimax", model: "MiniMax-M3", tokens: {input: 100, output: 50}, estimated_cost_usd: 0.003` round-trips exactly.
      QA scenarios: happy — `npm test 2>&1 | tee .omo/evidence/task-7-storyboard-agent.log` shows all v0.1 tests still passing; failure — a record with no `provider` field still round-trips (back-compat).
      Commit: Y | `feat(workflow): extend RunRecord with provider/model/tokens per §62.2`

- [x] 8. Docs — README quickstart + ARCHITECTURE v0.2 addendum
      What to do / Must NOT do: README: add a "## Storyboard Agent (v0.2)" section after Quickstart with `MINIMAX_API_KEY=... GLM_API_KEY=... vf storyboard "AI 思维链"` example and expected output; add to commands table. `ARCHITECTURE.md`: append v0.2 Storyboard Agent section describing `@vf/llm` (both providers, retry policy, no-credential-persistence invariant), `@vf/agent-storyboard` (prompt structure, VDSL conformance via `@vf/vdsl`), and how `vf storyboard` plugs into the v0.1 pipeline without modification. Must NOT document unwritten features (streaming, tool-use, Research/Script agents — those are separate v0.2 phases).
      Parallelization: Wave 3 | Blocked by: 6,7 | Blocks: —
      References: doc §65 (principles); §66 line 2416 (storyboard agent first).
      Acceptance criteria (agent-executable): README quickstart commands literally copy-paste-runnable; ARCHITECTURE references only existing packages (`@vf/llm`, `@vf/agent-storyboard`).
      QA scenarios: happy — `grep -E '@vf/llm|@vf/agent-storyboard' README.md ARCHITECTURE.md` returns matches in both files; failure — grep for the forbidden tech (MCP/Ollama) still returns nothing in packages/.
      Commit: Y | `docs: README storyboard section + ARCHITECTURE v0.2 addendum`

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy

- One conventional commit per todo after its acceptance criteria pass.
- Branch: extend `feat/video-agent-v01` with these commits (single linear history). The v0.2 commits follow v0.1's naming convention (`feat(llm):`, `feat(agent-storyboard):`, `feat(cli):`, `feat(workflow):`, `docs:`).
- Never commit: `node_modules/`, `.env`, `.env.local`, render outputs, `runs/`, `.omo/evidence/`.
- `runs/<run-id>.yaml` provider/model fields are fine to commit — they contain NO credentials (asserted by test #6).
- v0.2 tag after the plan's final verification wave approves.

## Success criteria

1. **Functional:** `npm test` (all 68 v0.1 tests + new v0.2 tests) exits 0; the CLI integration test (`vf storyboard` with mock provider) writes a draft that `vf validate` accepts and `vf preview` renders to a 1920x1080@30fps MP4.
2. **Agent conformance:** agent's draft always validates against `@vf/vdsl`'s `validateStoryboard`; the human gate (`vf approve storyboard`) is required before `vf preview`.
3. **Provider safety:** no value matching `${MINIMAX_API_KEY}` or `${GLM_API_KEY}` env names appears anywhere in `projects/`, `runs/`, or committed files (grep test in todo 6).
4. **Run records:** extended schema round-trips; v0.1 records without provider/model/tokens remain valid (back-compat).
5. **Zero forbidden tech:** grep for `mcp|ollama|@modelcontextprotocol|@remotion/cli .*storyboard` in packages/ returns nothing new beyond v0.1's footprint.
6. **All 8 todos checked with evidence files in `.omo/evidence/`; F1–F4 verification wave APPROVE.**
