# Architecture map

How each design-doc section maps to the v0.1 codebase. The design doc is
`AI_Video_Factory_Design_and_Plan_v1.1.md` at the repo root.

## Principles (doc §2, §65)

- **AI generates → Structured Content → Video DSL → Remotion → FFmpeg → MP4**
  (§2.1): the render path is `@vf/vdsl` (compile) → `@vf/video-renderer` (Remotion) → `@vf/video-renderer/render.ts` `faststart` (FFmpeg). The renderer never reads `storyboard.yaml` directly — only the compiled `vdsl/vdsl.yaml` (§21.1 line 948).
- **Human-in-the-loop checkpoints** (§8, §19): `@vf/workflow` state machine + `packages/cli/src/workflow-commands.ts` for `vf approve/reject/rollback`.

## Packages

| Package                | Doc section            | Role                                                                                                                                                     |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/vdsl`             | §21, §51               | strict zod schema, line-numbered YAML errors, full validator (assets / registry / audio / caption), deterministic compiler to `vdsl.yaml` + `RenderPlan` |
| `@vf/video-components` | §23, §24, §25, §50     | 10 React components + 5 animation primitives + `dark-tech` theme; zod props schemas in `REGISTRY`                                                        |
| `@vf/video-renderer`   | §2.1, §50              | `Root` composition consumes `RenderPlan`, `renderPlanToVideo` bundles via generated entry, FFmpeg faststart post-pass                                    |
| `@vf/media`            | §21.1, §62.4           | `wrapText` (CJK-aware), `probeAudioDuration` (ffprobe)                                                                                                   |
| `@vf/workflow`         | §18, §35, §62.1, §62.2 | 10-state machine with legal transitions, checkpoints, dependency invalidation, run records, retry, resume, idempotency                                   |
| `@vf/cli`              | §39–§43                | `vf` CLI: new/validate/status/approve/reject/rollback/resume/preview/final                                                                               |

## v0.2 Phase 1 — Storyboard Agent (shipped)

New packages added in front of the v0.1 pipeline:

| Package                | Doc section                                       | Role                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/llm`              | §6 (model-agnostic), §62.2 (run-record extension) | `Provider` interface + `MiniMaxProvider` (`api.minimax.io/v1/chat/completions`, Bearer `MINIMAX_API_KEY`) + `GLMProvider` (`open.bigmodel.cn/api/paas/v4`, Bearer `GLM_API_KEY`); YAML `llm.config.yaml` with per-role primary/fallback; bounded retry (3 attempts, 1/2/4s) — never retries 4xx. Credentials via `process.env` only; never persisted. |
| `@vf/agent-storyboard` | §53                                               | Storyboard Agent: system prompt + few-shot (doc §21.1 sample + §13 flowchart), one round-trip JSON output, fences stripped, parsed by `@vf/vdsl` `validateStoryboard`, returns Storyboard + provider usage. Reuses the entire v0.1 pipeline.                                                                                                         |

CLI verb `vf storyboard <topic> [--model] [--lang] [--duration] [--audience] [--style]`
calls `runNew` to scaffold `projects/<slug>/`, then calls the agent, writes the
draft to `storyboard/storyboard.yaml`, and records the call with
`provider/model/prompt_hash/tokens/estimated_cost_usd` in `runs/<run-id>.yaml`.

**Invariant tested:** no value matching the API key appears anywhere in the
project tree after a `vf storyboard` run — grep test in the integration suite.

## v0.2 Phase 2 — Research Agent (shipped)

| Package        | Doc section | Role                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/research` | §55         | Research Agent: zod schemas for sources/claims/output; `MiniMaxWebSearch` tool (MiniMax Coding Plan `/v1/coding_plan/search` with bounded retry); `callResearch` agent that produces `markdown` + `sources` + `claims` + `meta` with fact/opinion callouts and "Needs human review" surfacing. Web failure degrades to model knowledge with `web_search_failed: true` flag. |

CLI verb `vf research <topic> [--no-web] [--model]` writes
`projects/<slug>/research/{research.md,sources.yaml,claims.yaml}` and a run
record. `--from-research <dir>` on `vf storyboard` optionally injects the
research markdown + a claim summary as supporting context — the Storyboard
Agent still produces its own draft (verified by back-compat test).

**Invariant tested:** any value matching the API key env names never appears
in the project tree after a `vf research` run (grep test in the integration
suite).

## v0.2 Phase 3 — Script Agent (shipped)

| Package      | Doc section | Role                                                                                                                                                                                                                                    |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/script` | §28         | Script Agent: zod schema for the 7-section spine (Hook/Problem/Explanation/Example/Comparison/Implication/Conclusion); `callScript` agent that produces a `Script` object; markdown renderer for `script.zh-CN.md` / `script.en-US.md`. |

CLI verb `vf script <topic> [--from-research] [--direction] [--lang]`
writes `projects/<slug>/script/script.<lang>.md` and a run record.
`--from-script` on `vf storyboard` injects the script's 7 sections as
supporting context — the Storyboard Agent maps each scene to a script
section but is structurally free.

## v0.2 Phase 4 — Voice + Subtitle (shipped)

| Package   | Doc section   | Role                                                                                                                                                                                     |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/tts` | §56 / Phase 6 | TTS provider abstraction (`TTSProvider` interface, `EdgeTTSProvider` via `edge-tts-universal`, `FakeTTSProvider` for tests). Returns audio bytes + word-level timestamps when available. |

CLI verb `vf audio <project> [--fake]` synthesizes one WAV per scene
(uses `apad,atrim` via ffmpeg to hit the scene's exact duration) and writes
`captions/<lang>.srt`. Audio files land at `assets/audio/scene-N.wav` —
add `audio: assets/audio/scene-N.wav` to the corresponding scene in
`storyboard.yaml` and `vf preview` mounts them via Remotion's `<Audio>`
automatically.

## v0.2 Phase 5 — Review Agent (shipped)

| Package      | Doc section   | Role                                                                                                                                                                                                                  |
| ------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/review` | §31 / Phase 7 | Review Agent: zod schemas for the 3 review sections (Content/Visual/Technical with per-field + overall verdicts); `callReview` agent that produces a strict `ReviewPackage` from (storyboard, script, claims) inputs. |

CLI verb `vf review <project>` writes `review/{content-review,visual-review,technical-review}.yaml`
plus a run record. **Read-only**: the agent never modifies the project
(doc §32 — humans always have the final decision). The agent's overall
verdicts (`pass` / `warn` / `fail`) are advisory signals the human uses
to decide whether to fix the project and re-run.

## v0.2 Phase 6 — Pi Extension (shipped)

The full pipeline is exposed two ways for agentic harnesses:

1. **`bin/video`** — thin shell wrapper mapping `video <verb> [args...]` to
   `node packages/cli/dist/index.js <verb> [args...]`. Works from any shell,
   Makefile, or CI step. One binary covers all 13 verbs.
2. **`.opencode/command/video.md`** — slash-command definition with
   frontmatter (description, argument-hint, tools: bash/read/write) plus a
   markdown body listing every verb, the canonical pipeline order, and
   the critical invariants (never auto-approve, credentials stay in env,
   fail loudly). OpenCode / Cursor / Claude Code pick this up automatically;
   transferring to Pi requires only a small frontmatter adaptation.

Per doc §58 and §65, no agent (Pi or otherwise) has the final decision —
every generator step ends with a human gate (`vf approve`).

## v0.2 Phase 7 — YouTube Automation (shipped)

| Package       | Doc section   | Role                                                                                                                                                                                                                                                                      |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vf/youtube` | §58 / Phase 9 | YouTube Automation Agent: zod schema for the publishing package (title, description, chapters with MM:SS timestamps, thumbnail_prompt, shorts_hook); `callYouTube` agent with strict schema enforcement + sorted-chapters check; `chaptersToVtt` for upload-ready WebVTT. |

CLI verb `vf youtube <project>` writes six files under `youtube/`:
`title.txt`, `description.md`, `chapters.vtt` (WebVTT format), `package.yaml`
(structured metadata), `thumbnail-prompt.txt`, `shorts-hook.txt` — plus a
run record. Thumbnail image generation and Shorts MP4 clipping land in
v0.2 phase 8 (Advanced Media §60) — this phase ships the text only.

## v0.3 Phase 5 — SFX Cues + BGM Fades + `vf final --mix` (shipped)

| Package                    | Doc section                          | Role                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@vf/audio-mix` (extended) | §60 / "Advanced Audio" (SFX + fades) | New `MixSpecSchema` + `parseMixYaml` for the `audio-assets/mix.yaml` convention (bgm, sfx per scene_N, bgm_fade_in_sec, bgm_fade_out_sec). New `mixTracksWithSpec` engine places SFX cues via `adelay` and applies optional `afade=in/out` to the BGM track. |
| `@vf/cli` (extended)       | —                                    | `vf mix` reads `audio-assets/mix.yaml` (CLI flags override the spec); `vf final --mix` chains `runMix` after the final render to produce the mixed audio as the published artifact.                                                                          |

## v0.3 roadmap — complete

1. ~~Storyboard Agent~~ (✅ v0.2 phase 1)
2. ~~Research Agent~~ (✅ v0.2 phase 2)
3. ~~Script Agent~~ (✅ v0.2 phase 3)
4. ~~Voice + Subtitle~~ (✅ v0.2 phase 4)
5. ~~Review Agent~~ (✅ v0.2 phase 5)
6. ~~Pi Extension~~ (✅ v0.2 phase 6)
7. ~~YouTube Automation~~ (✅ v0.2 phase 7)
8. ~~Advanced Media (mock + thumbnail)~~ (✅ v0.2 phase 8)
9. ~~Real Image Generation (MiniMax image-01)~~ (✅ v0.3 phase 1)
10. ~~Real AI Video Generation (MiniMax-Hailuo-2.3)~~ (✅ v0.3 phase 2)
11. ~~Audio Assets (BGM + SFX provider)~~ (✅ v0.3 phase 3)
12. ~~Audio Mixing (BGM ducked under narration)~~ (✅ v0.3 phase 4)
13. ~~SFX Cues + BGM Fades + `vf final --mix`~~ (✅ v0.3 phase 5)

Deferred (no verified spec): GLM image provider, cloud rendering.

## v0.2 roadmap — COMPLETE

1. ~~Storyboard Agent~~ (✅ shipped v0.2 phase 1)
2. ~~Research Agent~~ (✅ shipped v0.2 phase 2)
3. ~~Script Agent~~ (✅ shipped v0.2 phase 3)
4. ~~Voice + Subtitle~~ (✅ shipped v0.2 phase 4)
5. ~~Review Agent~~ (✅ shipped v0.2 phase 5)
6. ~~Pi Extension~~ (✅ shipped v0.2 phase 6)
7. ~~YouTube Automation~~ (✅ shipped v0.2 phase 7 — text metadata)
8. ~~Advanced Media~~ (✅ shipped v0.2 phase 8 — mock image + ffmpeg Shorts)

The full v0.2 pipeline now runs end-to-end: `new → research → script →
storyboard → audio → review → preview → final → youtube → thumbnail →
shorts`. v0.3 hooks (real image/video generators, cloud rendering, advanced
audio) are documented in README but intentionally deferred per doc §60.

Each future phase's entry point into the v0.1 codebase is the `vf` CLI
(extend with a new subcommand) or a new subagent reading from
`@vf/vdsl`'s `RenderPlan` shape.
