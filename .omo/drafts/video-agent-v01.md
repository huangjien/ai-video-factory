---
slug: video-agent-v01
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/video-agent-v01.md
approach: Detailed decision-complete work plan for AI Video Factory v0.1 (doc Phases 0-3 = Foundation, Motion Engine, VDSL, Checkpoint Engine + CLI + benchmark video), executed as an npm-workspaces TypeScript monorepo per doc §33. Later phases (4-10) recorded as a roadmap section only, NOT detailed tasks.
---

# Draft: video-agent-v01

## Components (topology ledger)

<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

| id                | outcome                                                                                                | status   | evidence                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| foundation        | Monorepo + Remotion minimal project renders a hello-world MP4 via FFmpeg                               | active   | doc §49 (lines 1814-1837), §33 (1322-1345)                                                                |
| vdsl              | VDSL schema/validator/parser/compiler with file+field+line errors, unknown-field rejection             | active   | doc §21/21.1 (863-948), §51 (1879-1897)                                                                   |
| motion-components | 10 Remotion components + 5 animation primitives + style system                                         | active   | doc §23 (991-1016), §24 (1020-1037), §25 (1041-1066), §50 (1840-1876)                                     |
| render-pipeline   | validated vdsl.yaml → Remotion → FFmpeg → preview.mp4/final.mp4, reproducible                          | active   | doc §2.1 (55-88), §62 benchmark (2190-2197)                                                               |
| checkpoint-engine | State machine (10 states), checkpoints/, runs/, dependency invalidation, rollback/resume, CLI commands | active   | doc §18/18.1/18.2 (732-822), §35 (1420-1444), §52 (1900-1918), §39-43 (1543-1677), §62.1/62.2 (2208-2259) |
| benchmark         | 30-60s zh-CN 5-8 scene reproducible test video, full Git+run history                                   | active   | doc §62 (2190-2197), §62.4 (2285-2308)                                                                    |
| v02-agents-pi-tts | Research/Script/Storyboard/Review agents, Pi extension, TTS, multilang, YouTube                        | deferred | doc §62 exclusions (2161-2206), Phases 4-10 (§53-59)                                                      |

## Open assumptions (announced defaults)

<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

| assumption               | adopted default                                                                                 | rationale                                                                                               | reversible? |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| Plan granularity         | Detailed tasks ONLY for v0.1 (Phases 0-3); Phases 4-10 = roadmap outline section                | Doc §62 defines v0.1 as the only near-term completion target; §66 fixes dev order; agents/Pi are v0.2   | yes         |
| Package manager          | npm workspaces on Node 26 (bun NOT used for Remotion render)                                    | Remotion officially supports npm/pnpm/yarn; bun rendering unverified; npm ships with the installed Node | yes         |
| Test framework           | vitest; TDD for vdsl + checkpoint-engine (pure logic), tests-after for visual components        | Doc §62.3 mandates unit+integration+regression; vitest is the TS standard                               | yes         |
| Validation stack         | zod schemas + `yaml` pkg; unknown fields rejected; errors carry file/field/line                 | Doc §21.1 validation rules (924-932)                                                                    | yes         |
| v0.1 component set (10)  | Title, Paragraph, CodeBlock, Image, Terminal, FlowChart, Comparison, Timeline, Callout, EndCard | Doc §50 Phase-1 list + §23 library, ≤10 per §62 line 2151                                               | yes         |
| Animation primitives (5) | fade, slide, scale, draw, typewriter                                                            | Doc §50 (1860-1865), §24                                                                                | yes         |
| FFmpeg                   | Install via Homebrew in Phase 0 (missing on this machine)                                       | Doc §4 requires FFmpeg; env check: `ffmpeg -version` empty                                              | yes         |
| edge-tts                 | NOT a v0.1 dependency; benchmark uses pre-prepared local audio                                  | Doc §62 TTS note (2181-2188): optional prototype only                                                   | yes         |

## Findings (cited - path:lines)

- AI_Video_Factory_Design_and_Plan_v1.1.md §62 (2122-2206): v0.1 scope IN (2142-2159) / OUT (2161-2206); benchmark = 30-60s zh-CN, 5-8 scenes, hand-written storyboard.yaml → preview.mp4 + final.mp4, repeatable/rollback/recoverable (2190-2197)
- §62.1 (2208-2226): run_id idempotency; validation failures never auto-retry; transient failures retry ≤3 with backoff; assets reused; resume from last success
- §62.2 (2228-2259): runs/<run-id>.yaml record format incl. tool_version, input_commit, prompt_hash, tokens
- §62.3 (2261-2283): minimum test set (unit: schema/duration-frames/caption-wrap/style; integration: valid→mp4, invalid→readable error, failed-render→resume, rollback; regression: stable scene count/duration/fps/resolution)
- §62.4 (2285-2308): functional/video/engineering acceptance incl. "same input renders twice with identical structure" (2302)
- §21/21.1 (863-948): VDSL = executable render input; single project-level file; schema_version mandatory; seconds not frames; validation rules; script→storyboard→visual-plan→vdsl.yaml→validate→compile→render chain (934-946)
- §23 (991-1016) + §24 (1020-1037) + §25 (1041-1066): component library, animation primitives, style system (project-level control)
- §18/18.1/18.2 (732-822): 10 states (DRAFT…ROLLED_BACK), legal transitions, dependency invalidation map (805-819), rollback = active-state only, never deletes Git history
- §33 (1322-1345): monorepo layout packages/{vdsl,video-components,video-renderer,media}; §34 (1349-1416): per-project layout incl. checkpoints/, runs/, output/
- §35 (1420-1444): checkpoint yaml format (id, stage, status, commits, human_changes)
- §39-43 (1543-1677): CLI surface /video {new,status,research,direction,script,storyboard,visual,preview,render,review,approve,reject,rollback,open,continue,final}
- §66 (2412-2445): fixed dev order 1-12; "第一阶段不要跳过 Checkpoint Engine"
- Repo state (verified 2026-09-20): greenfield — 1 commit (be56b03 "v1.1"), only the design doc; Node v26.9.0 present; bun 12.5.1 present; pnpm absent; FFmpeg ABSENT; no package.json anywhere

## Decisions (with rationale)

1. Route per §66: Remotion minimal → VDSL → Components → Checkpoint Engine; VDSL before components because §51→§50 ordering is contested in doc (§50 Phase 1 lists components first) — RESOLVED: follow §66 canonical order (Remotion → VDSL → Motion Components → Checkpoint), building 2-3 seed components early inside the Remotion minimal project so VDSL has a component registry to validate against.
2. CLI in v0.1 = plain Node CLI (commander) invoking the same APIs the future Pi extension will wrap (§62 line 2172: Pi Extension is v0.2). CLI verbs mirror §39 subset: new/status/validate/compile/preview/render/approve/reject/rollback/resume/final.
3. zh-CN typography: bundle a CJK-safe font (Noto Sans SC) in assets/fonts to guarantee reproducible rendering (§62.4: no missing fonts).

## Scope IN

- npm-workspaces TS monorepo: packages/vdsl, packages/video-components, packages/video-renderer, packages/media (§33)
- VDSL 0.1 schema: schema_version, project{id,language,fps,width,height}, style, scenes[] with narration/visual/animation/captions/transition (§21.1)
- Validator: all §21.1 rules incl. unknown-field rejection, asset existence, duration/audio/caption consistency gate before Final Render
- Compiler: storyboard+visual-plan → vdsl.yaml is v0.2; v0.1 compiles vdsl.yaml → Remotion composition input (scene list, frame math)
- 10 components + 5 animations + dark-tech theme style system
- Render: Remotion render → FFmpeg (encode/concat/audio mux) → output/preview.mp4, final.mp4
- Checkpoint engine: states, transitions, checkpoints/_.yaml, runs/_.yaml, dependency invalidation, rollback w/ confirm, resume, retry policy (§62.1)
- CLI with the §39-subset verbs
- Benchmark project projects/benchmark-v01/: hand-written 5-8 scene zh-CN storyboard→vdsl, local audio, full Git history + run records
- Test suite per §62.3 (vitest) + regression: same input renders twice → identical scene count/duration/fps/resolution

## Scope OUT (Must NOT have)

- No Research/Script/Storyboard/Review agents (v0.2+, §62 exclusions 2199-2206)
- No Pi extension, MiniMax/GLM integration, MCP, Ollama, local LLM (v0.2+)
- No TTS dependency (edge-tts optional prototype only, never blocks render)
- No multilanguage (zh-CN only), no en-US pipeline
- No AI image / AI video generation, no cloud rendering
- No YouTube API/publishing, no thumbnails/shorts
- No database, no Electron, no web dashboard, no custom editors (§38)
- No timeline layer, no reusable scene templates (§67.C deferred)

## Open questions

None surviving the two filters — all forks were either doc-answerable (cited above) or defensible reversible internals (listed in Open assumptions for veto at the gate).

## Approval gate

status: plan-written (approved by user 2026-09-20; plan generated same turn)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

Plan: .omo/plans/video-agent-v01.md — 17 todos / 5 waves / F1-F4 verification wave. TL;DR filled last. Delivered with the start-vs-high-accuracy-review question; awaiting user decision. Execution NOT started.

## Metis gap analysis (inline — metis subagent type unavailable in this environment)

- Contradiction §50 (components first) vs §66 (VDSL before components) → resolved: follow §66, seed components early in W1, full set in W3.
- Doc gap: active workflow state location unspecified → decided `projects/<p>/state.yaml`; per-stage records in `checkpoints/*.yaml`.
- Doc gap: CLI home unspecified in §33 → added `packages/cli` + `packages/workflow` to the 4 doc-listed packages.
- Constraint encoded: renderer reads ONLY compiled `vdsl/vdsl.yaml` (§21.1:948).
- Early risk retirement: Remotion+Node26+FFmpeg hello-world render is Wave 1.
- Acceptance mapped: render-twice-identical (§62.4:2302), audio/scene duration check (2299), idempotent run_id (§18.1:797).
- No credentials/secrets in v0.1 (no external APIs) — nothing to leak.
