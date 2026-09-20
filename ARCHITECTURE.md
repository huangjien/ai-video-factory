# Architecture map

How each design-doc section maps to the v0.1 codebase. The design doc is
`AI_Video_Factory_Design_and_Plan_v1.1.md` at the repo root.

## Principles (doc §2, §65)

- **AI generates → Structured Content → Video DSL → Remotion → FFmpeg → MP4**
  (§2.1): the render path is `@vf/vdsl` (compile) → `@vf/video-renderer` (Remotion) → `@vf/video-renderer/render.ts` `faststart` (FFmpeg). The renderer never reads `storyboard.yaml` directly — only the compiled `vdsl/vdsl.yaml` (§21.1 line 948).
- **Human-in-the-loop checkpoints** (§8, §19): `@vf/workflow` state machine + `packages/cli/src/workflow-commands.ts` for `vf approve/reject/rollback`.

## Packages

| Package | Doc section | Role |
| --- | --- | --- |
| `@vf/vdsl` | §21, §51 | strict zod schema, line-numbered YAML errors, full validator (assets / registry / audio / caption), deterministic compiler to `vdsl.yaml` + `RenderPlan` |
| `@vf/video-components` | §23, §24, §25, §50 | 10 React components + 5 animation primitives + `dark-tech` theme; zod props schemas in `REGISTRY` |
| `@vf/video-renderer` | §2.1, §50 | `Root` composition consumes `RenderPlan`, `renderPlanToVideo` bundles via generated entry, FFmpeg faststart post-pass |
| `@vf/media` | §21.1, §62.4 | `wrapText` (CJK-aware), `probeAudioDuration` (ffprobe) |
| `@vf/workflow` | §18, §35, §62.1, §62.2 | 10-state machine with legal transitions, checkpoints, dependency invalidation, run records, retry, resume, idempotency |
| `@vf/cli` | §39–§43 | `vf` CLI: new/validate/status/approve/reject/rollback/resume/preview/final |

## v0.2 Phase 1 — Storyboard Agent (shipped)

New packages added in front of the v0.1 pipeline:

| Package | Doc section | Role |
| --- | --- | --- |
| `@vf/llm` | §6 (model-agnostic), §62.2 (run-record extension) | `Provider` interface + `MiniMaxProvider` (`api.minimax.io/v1/chat/completions`, Bearer `MINIMAX_API_KEY`) + `GLMProvider` (`api.z.ai/api/coding/paas/v4`, Bearer `GLM_API_KEY`); YAML `llm.config.yaml` with per-role primary/fallback; bounded retry (3 attempts, 1/2/4s) — never retries 4xx. Credentials via `process.env` only; never persisted. |
| `@vf/agent-storyboard` | §53 | Storyboard Agent: system prompt + few-shot (doc §21.1 sample + §13 flowchart), one round-trip JSON output, fences stripped, parsed by `@vf/vdsl` `validateStoryboard`, returns Storyboard + provider usage. Reuses the entire v0.1 pipeline. |

CLI verb `vf storyboard <topic> [--model] [--lang] [--duration] [--audience] [--style]`
calls `runNew` to scaffold `projects/<slug>/`, then calls the agent, writes the
draft to `storyboard/storyboard.yaml`, and records the call with
`provider/model/prompt_hash/tokens/estimated_cost_usd` in `runs/<run-id>.yaml`.

**Invariant tested:** no value matching the API key appears anywhere in the
project tree after a `vf storyboard` run — grep test in the integration suite.



## v0.2 Phase 2 — Research Agent (shipped)

| Package | Doc section | Role |
| --- | --- | --- |
| `@vf/research` | §55 | Research Agent: zod schemas for sources/claims/output; `MiniMaxWebSearch` tool (MiniMax Coding Plan `/v1/coding_plan/search` with bounded retry); `callResearch` agent that produces `markdown` + `sources` + `claims` + `meta` with fact/opinion callouts and "Needs human review" surfacing. Web failure degrades to model knowledge with `web_search_failed: true` flag. |

CLI verb `vf research <topic> [--no-web] [--model]` writes
`projects/<slug>/research/{research.md,sources.yaml,claims.yaml}` and a run
record. `--from-research <dir>` on `vf storyboard` optionally injects the
research markdown + a claim summary as supporting context — the Storyboard
Agent still produces its own draft (verified by back-compat test).

**Invariant tested:** any value matching the API key env names never appears
in the project tree after a `vf research` run (grep test in the integration
suite).



## v0.2 Phase 3 — Script Agent (shipped)

| Package | Doc section | Role |
| --- | --- | --- |
| `@vf/script` | §28 | Script Agent: zod schema for the 7-section spine (Hook/Problem/Explanation/Example/Comparison/Implication/Conclusion); `callScript` agent that produces a `Script` object; markdown renderer for `script.zh-CN.md` / `script.en-US.md`. |

CLI verb `vf script <topic> [--from-research] [--direction] [--lang]`
writes `projects/<slug>/script/script.<lang>.md` and a run record.
`--from-script` on `vf storyboard` injects the script's 7 sections as
supporting context — the Storyboard Agent maps each scene to a script
section but is structurally free.

## v0.2+ roadmap (doc §66)

1. ~~Storyboard Agent~~ (✅ shipped v0.2 phase 1)
2. ~~Research Agent~~ (✅ shipped v0.2 phase 2)
3. ~~Script Agent~~ (✅ shipped v0.2 phase 3)
4. **Voice + Subtitle** (§56) — real TTS (provider abstraction over edge-tts/Azure Speech), auto subtitle timestamps.
5. **Review Agent** (§57) — content / visual / technical review (still human-gated).
6. **Pi Extension** (§58) — wrap the `vf` CLI as `/video` subcommands for the Pi harness.
7. **YouTube Automation** (§59) — title / description / chapters / thumbnail / Shorts.
8. **Advanced Media** (§60) — AI images, AI video, cloud rendering.

Each future phase's entry point into the v0.1 codebase is the `vf` CLI
(extend with a new subcommand) or a new subagent reading from
`@vf/vdsl`'s `RenderPlan` shape.
