# video-agent-v01 - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** A small video factory that turns a hand-written outline file into a finished 1080p Chinese-language MP4 — with pause-points where you review, approve, reject, or rewind to any earlier step, and a 40-second explainer video about AI "chain-of-thought" built with it as proof it all works.

**Why this approach:** The design doc's own rule — a human decides, code renders, and history remembers — means the review/rewind machinery is built FIRST (before any AI writers), and the video is assembled from a structured outline rather than generated wholesale, so any scene can be re-made without starting over.

**What it will NOT do:** No AI writing/research agents yet, no text-to-speech in the pipeline, no English variant, no YouTube publishing, no cloud or AI-generated imagery — those are deliberately later phases.

**Effort:** Large
**Risk:** Medium - the video rendering toolchain (Remotion + FFmpeg on this machine) is proven in the very first step so surprises surface early, not at the end.
**Decisions to sanity-check:** npm (not bun) drives rendering; 10 specific on-screen components; placeholder silent audio in the demo video (real narration is a later phase).

Your next move: approve to start execution, or ask for a high-accuracy review of this plan first. Full execution detail follows below.

---

> TL;DR (machine): Large/Medium — 17 todos in 5 waves building the v0.1 storyboard→VDSL→Remotion→FFmpeg pipeline with full human-checkpoint state machine, benchmark zh-CN video, and §62.4 acceptance automation.

## Scope
> `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` at repo root. All line references are into that file.

### Must have
- npm-workspaces TypeScript monorepo (strict TS, ESLint, Prettier, vitest) with packages: `vdsl`, `video-components`, `video-renderer`, `media`, `workflow`, `cli` (doc §33 lines 1322-1345 + two additions the doc leaves homeless: workflow engine §52, CLI §39)
- `@vf/vdsl`: zod schema for VDSL 0.1 (doc §21.1 sample lines 889-922), strict unknown-field rejection, YAML errors carrying file/field/line, validator enforcing ALL §21.1 rules (lines 924-932), compiler `storyboard.yaml → vdsl/vdsl.yaml` + `RenderPlan` (seconds→frames)
- `@vf/video-components`: registry + 10 components (Title, Paragraph, CodeBlock, Terminal, Image, FlowChart, Comparison, Timeline, Callout, EndCard) + 5 animation primitives (fade, slide, scale, draw, typewriter) + `dark-tech` theme tokens
- `@vf/video-renderer`: Remotion composition driven ONLY by compiled RenderPlan (§21.1 line 948), render via `@remotion/renderer`, FFmpeg encode/mux, outputs `output/preview.mp4` + `output/final.mp4` at 1920x1080/30fps
- `@vf/media`: ffprobe audio duration checks, caption/SRT utils, caption wrapping
- `@vf/workflow`: 10-state machine + legal transitions (§18.1 lines 770-795), `checkpoints/*.yaml` (§35 lines 1420-1444), `state.yaml` active pointer, dependency invalidation (§18.2 lines 803-821), `runs/<run-id>.yaml` records (§62.2 lines 2228-2259), retry/resume/idempotency (§62.1 lines 2208-2226)
- `@vf/cli` (`vf`): `new`, `status` (§40 format), `validate`, `compile`, `preview`, `final`, `approve`, `reject`, `rollback` (with confirm, §43), `resume`
- Benchmark `projects/benchmark-v01/`: hand-written 6-scene zh-CN storyboard, 30-60s, local WAV audio, bundled Noto Sans SC font, full Git + run history (§62 lines 2190-2197)
- Test suite per §62.3 (lines 2261-2283) incl. render-twice structural identity (§62.4 line 2302)
- FFmpeg installed via Homebrew (currently missing on this machine)

### Must NOT have (guardrails, anti-slop, scope boundaries)
- NO agents (Research/Script/Storyboard/Review), NO Pi extension, NO MiniMax/GLM/API calls, NO MCP/Ollama/local LLM (doc §62 lines 2199-2206)
- NO TTS in the render loop — edge-tts stays an optional offline prototype tool; benchmark uses pre-generated local audio (§62 lines 2181-2188)
- NO multilanguage pipeline (zh-CN only), NO en-US variant, NO AI image/AI video, NO cloud rendering, NO YouTube API, NO database/Electron/web dashboard/custom editors/timeline layer/scene templates (§38, §62, §67.C-D)
- The renderer MUST NOT read `storyboard.yaml` directly — only compiled `vdsl.yaml` (§21.1 line 948)
- Render failures MUST NOT delete intermediate artifacts; rollback MUST NOT rewrite Git history (§18.2 lines 799-801)
- No secrets/credentials anywhere (v0.1 calls no external services)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: **TDD for `@vf/vdsl` + `@vf/workflow`** (pure logic: write failing vitest tests first, then implement); **tests-after for `@vf/video-components` + `@vf/video-renderer`** (visual/integration); framework **vitest** run via `npm test` (unit), `npm run test:integration` (render loop), `npm run benchmark:verify` (structural regression), `npm run acceptance` (§62.4 audit)
- Every todo ships with agent-executable acceptance + happy/failure QA; evidence written to `.omo/evidence/task-<N>-video-agent-v01.<ext>` (command transcript or JSON report)
- Regression invariant (§62.4 line 2302): fixed input rendered twice → identical scene count, total duration, fps, resolution (verified via ffprobe + RenderPlan digest; binary identity NOT required)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means under-split.

- **Wave 1 — Foundation (retire environment risk first):** #1 monorepo scaffold · #2 FFmpeg install · #3 Remotion hello-world render. #1→#3 sequential; #2 parallel.
- **Wave 2 — VDSL + design system (per doc §66 order):** #4 schema+parse · #5 validate rules · #6 compiler · #7 theme+animations+registry (only needs #1; #6 consumes its registry, so #7 runs alongside #4/#5). 
- **Wave 3 — Motion engine:** #8 components batch A · #9 components batch B · #10 Root/SceneSwitch wiring. #8/#9 parallel after #7, #10 last.
- **Wave 4 — Workflow + CLI:** #11 state machine · #12 runs/retry/resume · #13 CLI verbs · #14 render pipeline integration. #11/#12 sequential, #13 after #11, #14 last.
- **Wave 5 — Benchmark + hardening:** #15 benchmark content · #16 reproducibility+acceptance scripts · #17 docs.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 scaffold | — | 3,4,7,11,13 | 2 |
| 2 ffmpeg | — | 3,14,15,16 | 1 |
| 3 hello-world | 1,2 | 10,14 | — |
| 4 schema+parse | 1 | 5,6 | 7 |
| 5 validate | 4 | 14,15 | 7,8 |
| 6 compiler | 4,7(registry) | 10,14,15 | 8,9 |
| 7 theme+registry | 1 | 6,8,9,10 | 4,5 |
| 8 components A | 7 | 10 | 6,9 |
| 9 components B | 7 | 10 | 6,8 |
| 10 wiring | 3,6,8,9 | 14,15 | 11,12 |
| 11 state machine | 1 | 13,14 | 7-10 |
| 12 runs/resume | 11 | 14 | 7-10 |
| 13 CLI verbs | 11 | 14 | 10 |
| 14 pipeline | 5,6,10,12,13 | 15,16 | — |
| 15 benchmark | 14 | 16 | — |
| 16 regression+acceptance | 14,15 | 17 | — |
| 17 docs | all | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
> Shared context for all executors: `doc` = `AI_Video_Factory_Design_and_Plan_v1.1.md` (repo root). Monorepo root = repo root. Node 26 + npm workspaces. TypeScript `strict: true` everywhere. Conventional commits.

- [x] 1. Monorepo scaffold + tooling
  What to do / Must NOT do: Create root `package.json` (private, `workspaces: ["packages/*", "projects/*"]`), `tsconfig.base.json` (strict, ES2022, NodeNext, `jsx: react-jsx`), `.gitignore` (node_modules, output renders, .omo/evidence, .DS_Store), ESLint flat config + Prettier, vitest workspace config, and six empty packages `packages/{vdsl,video-components,video-renderer,media,workflow,cli}` each with `package.json` (name `@vf/<name>`, type module) and `src/index.ts`. Root scripts: `test`, `lint`, `format`, `build` (tsc -b). Must NOT add any doc §5-forbidden tech (no DB, no Electron, no MCP, no cloud deps).
  Parallelization: Wave 1 | Blocked by: — | Blocks: 3,4,7,11,13
  References: doc §33 (1322-1345) package layout; §4 (162-181) stack table; §62 (2142-2159) v0.1 must-haves.
  Acceptance criteria (agent-executable): `npm install` exits 0; `npm run lint` exits 0; `npm test` exits 0 (0 tests is OK); `npm run build` exits 0; `ls packages` prints exactly the six names.
  QA scenarios (name the exact tool + invocation): happy — `npm run build && npm run lint` both green, evidence `npm run build 2>&1 | tee .omo/evidence/task-1-video-agent-v01.log`; failure — temporarily add a TS type error in `packages/vdsl/src/index.ts`, `npm run build` must exit non-zero (then revert).
  Commit: Y | `chore(repo): scaffold npm-workspaces monorepo with tooling`

- [x] 2. Install FFmpeg + verify
  What to do / Must NOT do: Install FFmpeg via `brew install ffmpeg` (currently ABSENT — verified `ffmpeg -version` returns nothing). Verify `ffmpeg` and `ffprobe` on PATH. Record versions in `.omo/evidence/`. Must NOT vendor FFmpeg binaries into the repo.
  Parallelization: Wave 1 | Blocked by: — | Blocks: 3,14,15,16
  References: doc §4 (line 176) Encoding=FFmpeg; env finding in `.omo/drafts/video-agent-v01.md`.
  Acceptance criteria (agent-executable): `ffmpeg -version | head -1` prints a version; `ffprobe -version | head -1` prints a version.
  QA scenarios: happy — `ffmpeg -version 2>&1 | tee .omo/evidence/task-2-video-agent-v01.log`; failure — if brew install fails, STOP and report BLOCKED (no apt/conda fallbacks on macOS).
  Commit: N | (environment change only)

- [x] 3. Remotion hello-world render (risk retirement)
  What to do / Must NOT do: In `packages/video-renderer` add `remotion`, `@remotion/cli`, `@remotion/renderer`, `react`, `react-dom`. Create `src/HelloRoot.tsx` (one 5s, 1920x1080, 30fps composition showing static text on dark background), `remotion.config.ts`, and script `render:hello` that renders via `@remotion/renderer` `renderMedia` to `.omo/tmp/hello.mp4`, then FFmpeg-re-encodes to H.264 `+faststart`. Must NOT build scene switching, audio, or read any YAML yet — this todo only proves the Remotion+Node26+FFmpeg chain works.
  Parallelization: Wave 1 | Blocked by: 1,2 | Blocks: 10,14
  References: doc §49 (1814-1837) Phase 0 minimal Remotion project; §62.4 (2297) 1920x1080/30fps.
  Acceptance criteria (agent-executable): `npm run render:hello` exits 0 and `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of json .omo/tmp/hello.mp4` reports 1920x1080, 30/1, duration ≈5.0s (±0.2s).
  QA scenarios: happy — the command pair above, evidence tee'd to `.omo/evidence/task-3-video-agent-v01.log`; failure — corrupt `remotion.config.ts` entry point deliberately, render must exit non-zero with a readable error (then revert).
  Commit: Y | `feat(renderer): minimal Remotion project renders hello-world MP4`

- [x] 4. VDSL schema + parser (TDD)
  What to do / Must NOT do: In `packages/vdsl` add deps `zod`, `yaml`. Write vitest tests FIRST covering every §21.1 rule, then implement: `src/schema.ts` — zod strict schemas: top-level `{schema_version: "0.1", project:{id:string, language: enum[zh-CN,en-US], fps:int>0, width:int>0, height:int>0}, style?:{theme:string, plus optional color/typography overrides}, scenes: array(min 1) of {id:string, duration:number>0 (SECONDS — §21.1 line 887), narration?:{text:string, audio?:string}, visual:{component:string, props:record}, animation?:{entrance: enum[none,fade,slide,scale,draw,typewriter], emphasis: enum[none,highlight,counter] default none, exit: enum[none,fade] default none}, captions?:{source: enum[narration,none], text?:string}, transition?:{in: enum[fade,cut], out: enum[fade,cut]}}}` — `.strict()` everywhere so unknown fields FAIL (§21.1 line 931). `src/parse.ts` — YAML load via `yaml` package keeping line info; on schema failure map each zod issue to `{file, field (dot-path), line (from YAML AST), message, fix?}`. `src/errors.ts` — `VdslError` class + `formatErrors(errors)` human-readable table. Must NOT do asset-existence or registry checks here (todo 5) — this todo is shape only.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 5,6
  References: doc §21.1 (869-932) schema sample + validation rules; §26 (1071-1082) language is project-level; §62 (2142-2159).
  Acceptance criteria (agent-executable): `npm test -- @vf/vdsl` green; a fixture `scene-01` sample from doc lines 889-922 validates OK; removing `schema_version`, duplicating a scene id, `duration: 0`, and adding unknown key `foo: bar` each produce a `VdslError` whose message contains the field path and YAML line number (assert in tests).
  QA scenarios: happy — `npm test -- @vf/vdsl 2>&1 | tee .omo/evidence/task-4-video-agent-v01.log`; failure — feed intentionally malformed YAML (tab indent), parse must return line-numbered error, not a stack crash (assert in tests).
  Commit: Y | `feat(vdsl): strict zod schema + line-numbered YAML parse errors (TDD)`

- [x] 5. VDSL validator — full rule set + `vf validate` (TDD)
  What to do / Must NOT do: Extend `@vf/vdsl` with `src/validate.ts` implementing the REMAINING §21.1 rules (lines 926-930): (a) `visual.component` registered — accept a `ComponentRegistry` param `{name: string, propsSchema: zodSchema}[]` (real registry arrives todo 7; tests use a stub); (b) all referenced files exist relative to project root — `narration.audio`, any `visual.props.src` for Image, fonts; (c) duration/audio/caption consistency — if `narration.audio` exists, `ffprobe` duration must be ≤ scene `duration` + 0.05s tolerance, else error listing file/field/expected/actual (§62.4 line 2299); (d) captions text length sanity for safe-area (no line > 24 zh chars after wrap — put wrap util in `@vf/media`). Validation failure returns errors; NEVER auto-retries (§62.1 line 2221). Wire CLI entry `vf validate <file>` (in `packages/cli`, commander) printing the error table + exit 1, or `✓ valid` + exit 0. Must NOT auto-fix or warn-and-continue — unknown/invalid = error.
  Parallelization: Wave 2 | Blocked by: 4 | Blocks: 14,15
  References: doc §21.1 (924-932); §51 (1887-1895) `video validate` command; §62.1 (2221) validation never auto-retries; §62.4 (2298-2300).
  Acceptance criteria (agent-executable): `npm test -- @vf/vdsl` green including new rule tests; `npx vf validate test/fixtures/valid.yaml` exits 0; `npx vf validate test/fixtures/bad-audio.yaml` exits 1 and stdout contains `narration.audio`, the actual vs expected duration, and the YAML line.
  QA scenarios: happy — fixture run tee'd to `.omo/evidence/task-5-video-agent-v01.log`; failure — fixture with missing image file must exit 1 naming the missing path and field (test-asserted).
  Commit: Y | `feat(vdsl): asset/registry/duration validation + vf validate command (TDD)`

- [x] 6. VDSL compiler — storyboard.yaml → vdsl.yaml + RenderPlan (TDD)
  What to do / Must NOT do: `src/compile.ts`: input = validated storyboard document + project root; output = (1) writes normalized `vdsl/vdsl.yaml` — same schema with defaults filled (animation.emphasis/exit, captions.source, transition), asset paths rewritten project-relative, `style` resolved against theme defaults; (2) returns `RenderPlan` type exported from `@vf/vdsl`: `{project, totalFrames, scenes: [{id, index, startFrame, durationInFrames, component, props, animation, captions:{lines,wrapped}, audio?}]}` — frame math = `Math.round(duration * fps)` (§21.1 line 887: seconds in, frames internal). Compile refuses (exit-style error) if validation fails. Must NOT let the renderer consume `storyboard.yaml` — only `vdsl.yaml`/RenderPlan (§21.1 line 948); must NOT mutate the input file.
  Parallelization: Wave 2 | Blocked by: 4,7 (registry needed for props defaults) | Blocks: 10,14,15
  References: doc §21.1 (934-948) conversion chain + render gate; §52 naming (1879-1897); §21.1 (887) seconds→frames.
  Acceptance criteria (agent-executable): `npm test -- @vf/vdsl` green: given 3 scenes (8s,4s,12s) at 30fps → totalFrames=720, startFrames [0,240,360]; normalized output passes `vf validate`; re-compiling identical input yields byte-identical `vdsl.yaml` (determinism test).
  QA scenarios: happy — compile fixture, assert snapshot, tee to `.omo/evidence/task-6-video-agent-v01.log`; failure — compile a storyboard whose component is unregistered must fail with the component name + scene id (test-asserted).
  Commit: Y | `feat(vdsl): deterministic compiler storyboard→vdsl + RenderPlan frame math (TDD)`

- [x] 7. Theme tokens + animation primitives + component registry
  What to do / Must NOT do: In `packages/video-components`: `src/theme.ts` — `dark-tech` tokens (decision-locked): colors `{background:#0B1220, surface:#111A2C, primary:#E6EDF3, secondary:#8B96A8, accent:#4C8DFF, warning:#F0B429, success:#3FB68B}`, typography `{title:72/700 Noto Sans SC, subtitle:48/600 Noto Sans SC, body:32/400 Noto Sans SC, code:26 JetBrains Mono}`, `spacing.unit=8`, `defaultEasing=Easing.inOut(Easing.cubic)` (doc §25 shape, lines 1041-1066 — style is project-level, NOT per-agent). `src/animations.ts` — 5 entrance presets as reusable interpolation helpers: `fade` (opacity 0→1 over 20 frames), `slide` (translateX/Y ±80px, direction-aware), `scale` (0.92→1), `draw` (SVG strokeDasharray progress — for FlowChart edges), `typewriter` (visible-character count). `src/registry.ts` — `REGISTRY: Record<string, {component: React.FC<Props>, propsSchema: zodSchema}>`; validation in todo 5 consumes it. Also `src/fonts.ts` — `@font-face` loader reading `assets/fonts/NotoSansSC-Regular.otf` + `JetBrainsMono-Regular.otf` via `delayRender`/`continueRender` so rendering waits for fonts (reproducibility). Must NOT hand-roll easing curves outside `defaultEasing` family; must NOT hardcode colors in components (tokens only).
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 6,8,9,10
  References: doc §25 (1041-1066); §24 (1020-1037) primitives; §23 (991-1016) library; §62.4 (2298) no missing fonts.
  Acceptance criteria (agent-executable): `npm test -- @vf/video-components` green (token sanity: contrast of primary on background ≥ 7:1 — assert programmatically); `REGISTRY` exports exactly the 10 names listed in Scope; `npm run build` green.
  QA scenarios: happy — unit test dump of tokens/registry tee'd to `.omo/evidence/task-7-video-agent-v01.log`; failure — registering a component without propsSchema must throw at import time (test-asserted).
  Commit: Y | `feat(components): dark-tech theme, 5 animation primitives, registry with zod props`

- [x] 8. Motion components — batch A (Title, Paragraph, CodeBlock, Terminal, Image)
  What to do / Must NOT do: Implement in `src/components/`: `Title` (props `{text, subtext?}` — 72px centered, accent underline draw-in), `Paragraph` (`{text, align?: left|center}` — body 32px, max 3 lines wrapped), `CodeBlock` (`{code, language, highlightLines?: number[]}` — mono 26px on surface bg, line numbers, highlighted lines get accent tint; NO external syntax-highlighter dependency — plain text + tint keeps renders reproducible), `Terminal` (`{title?: string, lines: string[], prompt?: string}` — macOS-style chrome dots, typewriter-friendly), `Image` (`{src, fit?: contain|cover}` — uses staticFile). Each accepts `{startFrame, durationInFrames}` context via props from SceneSwitch (todo 10), applies its `entrance` animation, and renders text within the safe area (5% margins, §62.4 line 2300). Each has a zod propsSchema registered in REGISTRY. Tests-after: one vitest render-per-component using `@remotion/testing` or `renderToStaticMarkup`-style snapshot at frame 0 and mid-frame. Must NOT embed durations/colors inside components.
  Parallelization: Wave 3 | Blocked by: 7 | Blocks: 10
  References: doc §23 (991-1016); §50 (1846-1855) Phase-1 component list; §62.4 (2300) safe area.
  Acceptance criteria (agent-executable): `npm test -- @vf/video-components` green — each of the 5 renders without throwing at frames 0/mid/last; zod rejects a bad prop (e.g. `CodeBlock` without `code`) (test-asserted); `npm run build` green.
  QA scenarios: happy — test run tee'd to `.omo/evidence/task-8-video-agent-v01.log`; failure — a Title with 200-char text must wrap or clamp WITHOUT overflow (assert rendered height ≤ stage height in test).
  Commit: Y | `feat(components): Title, Paragraph, CodeBlock, Terminal, Image with zod props`

- [x] 9. Motion components — batch B (FlowChart, Comparison, Timeline, Callout, EndCard)
  What to do / Must NOT do: `FlowChart` (`{nodes: string[], edges: [number,number][], direction?: left-to-right|top-down}` — pure SVG rounded rects + accent arrows, `draw` entrance animates edges sequentially), `Comparison` (`{left:{title,items[]}, right:{title,items[]}}` — two cards sliding in from opposite sides), `Timeline` (`{events:[{label, description?}]}` — horizontal axis, dots scale in sequentially), `Callout` (`{kind: info|warning|success, title?, text}` — tinted border card, icon-free), `EndCard` (`{title, subtitle?, cta?}` — centered, fade+scale). Same contract as batch A: zod schemas in REGISTRY, safe-area compliance, entrance animations, no hardcoded theme values. Tests mirror todo 8. Must NOT add graph-layout deps — FlowChart uses a fixed grid layout computed from node count.
  Parallelization: Wave 3 | Blocked by: 7 | Blocks: 10
  References: doc §23 (991-1016); §13 example `visual.type: flowchart` (604-618); §24 (1029) draw primitive.
  Acceptance criteria (agent-executable): `npm test -- @vf/video-components` green for all 10 components; FlowChart with 6 nodes/5 edges renders arrows attached to node borders (snapshot); zod rejects `Comparison` with empty `left.items` (test-asserted).
  QA scenarios: happy — test run tee'd to `.omo/evidence/task-9-video-agent-v01.log`; failure — Timeline with 8 events must fit 1920px width without overlap (assert max right-edge ≤ 1920*0.95 in test).
  Commit: Y | `feat(components): FlowChart, Comparison, Timeline, Callout, EndCard`

- [x] 10. Renderer wiring — Root + SceneSwitch + captions + audio
  What to do / Must NOT do: In `packages/video-renderer`: `src/Root.tsx` — Remotion `<Composition id="video-factory">` whose `calculateMetadata` sets `durationInFrames=RenderPlan.totalFrames`, 1920x1080, fps 30 from RenderPlan; input via a JSON file path (CLI writes RenderPlan to `.omo/tmp/render-plan.json`; NO yaml parsing in the renderer — §21.1 line 948). `src/SceneSwitch.tsx` — maps `useCurrentFrame()` to the active scene via `startFrame/durationInFrames`, renders the REGISTRY component with props, applies `transition.in/out` (fade = crossfade via opacity at scene boundary ±10 frames; cut = none), overlays captions (bottom-centered, 32px, wrapped to ≤24 zh chars/line via `@vf/media` wrap util, within safe area) when `captions.source=narration`, and mounts `<Audio src={staticFile(audio)}>` when present. `src/render.ts` — `renderPlanToVideo(plan, outPath, {quality: preview|final})`: renderMedia (codec h264, `--concurrency=local` deterministic settings: `disableWebSecurity:false`, jpeg quality fixed 90) then FFmpeg pass `-movflags +faststart` re-mux. Must NOT read storyboard.yaml; must NOT fetch remote assets (staticFile only).
  Parallelization: Wave 3 | Blocked by: 3,6,8,9 | Blocks: 14,15
  References: doc §2.1 (55-88) Structured→Remotion→FFmpeg→MP4; §21.1 (934-948); §62.4 (2297-2301).
  Acceptance criteria (agent-executable): hand-crafted 2-scene RenderPlan JSON (Title 3s + Paragraph 4s) → `npm run render:fixture` → ffprobe: duration ≈7.0s±0.2, 1920x1080, 30/1; audio-less plan renders silent video without error.
  QA scenarios: happy — fixture render + ffprobe JSON tee'd to `.omo/evidence/task-10-video-agent-v01.log`; failure — RenderPlan referencing an unregistered component must fail BEFORE rendering with scene id + component name (test-asserted).
  Commit: Y | `feat(renderer): RenderPlan-driven composition, captions, audio, transitions`

- [x] 11. Workflow state machine (TDD)
  What to do / Must NOT do: In `packages/workflow` (deps: `zod`, `yaml`): `src/states.ts` — the 10 states verbatim from §18.1 (770-782): DRAFT, GENERATING, VALIDATING, WAITING_REVIEW, EDITING, APPROVED, FINAL_APPROVED, FAILED, BLOCKED, ROLLED_BACK. `src/machine.ts` — `transition(state, action)` enforcing EXACTLY the legal transitions (787-795): `DRAFT→GENERATING→VALIDATING→WAITING_REVIEW`; `VALIDATING→FAILED→GENERATING`; `VALIDATING→BLOCKED`; `WAITING_REVIEW→APPROVED|EDITING|GENERATING|ROLLED_BACK`; `EDITING→VALIDATING`; `APPROVED→<next stage DRAFT>`; illegal transition throws with from/to/reason. Every transition returns a record `{run_id, actor, at, from, to, input_commit, output_commit, reason}` (§18.1 line 797). v0.1 stage order: `init → storyboard → compile → render → review → final`. `src/project.ts` — `state.yaml` (active: stage, checkpoint id, status, history tail ≤20) + `checkpoints/<stage>.yaml` per §35 (1420-1444: id, stage, status, created_at, approved_at, input_commit, output_commit, human_changes, notes). `src/invalidation.ts` — dependency map v0.1: `storyboard:[compile,render,review,final], compile:[render,review,final], render:[review,final], review:[final]` (adapting §18.2 lines 805-819); `rollback(target)` marks downstream checkpoints `invalidated` (never deletes files/history — §18.2 lines 799-801), returns the list of stages needing re-execution + reused-asset sources. Must NOT allow skipping WAITING_REVIEW for human-gated stages (storyboard/review/final per §19).
  Parallelization: Wave 4 | Blocked by: 1 | Blocks: 13,14
  References: doc §18 (732-768); §18.1 (768-797); §18.2 (799-822); §19 (825-841); §35 (1420-1444).
  Acceptance criteria (agent-executable): `npm test -- @vf/workflow` green: every legal transition succeeds; ≥6 illegal transitions throw (e.g. DRAFT→APPROVED, WAITING_REVIEW→FINAL_APPROVED directly); rollback from review→storyboard invalidates exactly compile/render/review checkpoints and keeps their files; state.yaml + checkpoint files round-trip.
  QA scenarios: happy — test run tee'd to `.omo/evidence/task-11-video-agent-v01.log`; failure — attempt `rollback` to a nonexistent checkpoint id must throw naming the id (test-asserted).
  Commit: Y | `feat(workflow): 10-state machine, checkpoints, dependency invalidation (TDD)`

- [x] 12. Runs, retry, resume, idempotency (TDD)
  What to do / Must NOT do: `src/runs.ts` — `runs/<run-id>.yaml` writer with EXACT §62.2 fields (2231-2245): run_id, stage, status, actor, tool, tool_version, input_commit, input_files, output_files, created_at, duration_ms, error (provider/model/prompt_hash/tokens fields only when external models exist — v0.1: omit). run_id format `<stage>-<UTC-Zulu-timestamp>-<seq>`. Retry policy (§62.1 2219-2226): validation failures → NO retry, return structured errors; transient (process spawn/network) → max 3 retries, backoff 1s/2s/4s; `resume(project)` re-runs from the LAST successful run's stage, never from scratch; same `run_id` + same input commit → idempotent skip (outputs exist+valid ⇒ reuse, §18.1 line 797). Must NOT retry validation errors; must NOT delete successful intermediate artifacts on downstream failure (§62.4 line 2292).
  Parallelization: Wave 4 | Blocked by: 11 | Blocks: 14
  References: doc §62.1 (2208-2226); §62.2 (2228-2259); §18.1 (797).
  Acceptance criteria (agent-executable): `npm test -- @vf/workflow` green: fake tool failing twice then succeeding → run record shows 2 retries + success; resume fixture (compile done, render missing) re-executes ONLY render; re-invoking a succeeded run_id returns cached outputs without invoking the tool (spy-asserted).
  QA scenarios: happy — test run tee'd to `.omo/evidence/task-12-video-agent-v01.log`; failure — a tool failing 3× leaves status FAILED with all 3 attempts recorded and artifacts intact (test-asserted).
  Commit: Y | `feat(workflow): run records, bounded retry, resume, idempotent run_id (TDD)`

- [x] 13. CLI verbs — vf new/status/approve/reject/rollback/resume
  What to do / Must NOT do: In `packages/cli` (commander, bin `vf`, root `npm run vf`): `vf new <project-id>` scaffolds `projects/<id>/` per §34 subset for v0.1: `project.yaml` (id, language zh-CN, fps 30, width 1920, height 1080), `storyboard/storyboard.yaml` (template with 2 example scenes), empty `assets/{audio,images,fonts}`, `captions/`, `checkpoints/`, `runs/`, `output/`, `state.yaml` (DRAFT/init). `vf status` prints §40-style (1569-1592): project header + stage checklist `✓/●/○` + current checkpoint + status enum. `vf approve [stage]` — transitions WAITING_REVIEW→APPROVED, writes checkpoint approved_at+commits, prints next stage + `Continue? [Y/n]` (§41). `vf reject` — interactive reason picker (1.wrong-content 2.wrong-pacing 3.wrong-style 4.missing-info 5.other, §42) saving feedback into the stage checkpoint + transition to GENERATING-regenerate path. `vf rollback <checkpoint-id>` — prints target, invalidated stages, "changes remain in Git" warning, requires `y` confirm (§43), then invalidates. `vf resume` — §62.1 resume. Must NOT implement research/direction/script/visual/review/open/continue verbs — v0.2 surface (§62 exclusions).
  Parallelization: Wave 4 | Blocked by: 11 | Blocks: 14
  References: doc §39 (1543-1163 command list); §40-43 (1569-1677) UX contracts verbatim; §34 (1349-1416) project layout.
  Acceptance criteria (agent-executable): scripted happy path in a temp project: `vf new demo && vf status` prints checklist; `vf approve storyboard` requires the state machine's WAITING_REVIEW precondition (test: approving a DRAFT stage exits non-zero); `vf rollback` without `y` input aborts with no file changes (test-asserted).
  QA scenarios: happy — command transcript tee'd to `.omo/evidence/task-13-video-agent-v01.log`; failure — `vf approve final` before review approval must exit non-zero citing illegal transition (test-asserted).
  Commit: Y | `feat(cli): vf new/status/approve/reject/rollback/resume with confirm gates`

- [x] 14. Render pipeline integration — vf preview / vf final
  What to do / Must NOT do: Wire the full chain inside `packages/cli`: `vf preview` = validate (storyboard) → compile (vdsl+RenderPlan) → render preview.mp4 (quality preview) → checkpoint render=WAITING_REVIEW via state machine + run records (stage `render` AUTO per §20, the HUMAN gate is `review`); `vf final` = requires review checkpoint APPROVED → render final.mp4 (quality final, faststart) → checkpoint review→final, status FINAL_APPROVED only after §62.4 checks pass (call the acceptance script's programmatic core: ffprobe specs, scene-sum duration, caption safe-area). Failures follow todo 12 retry policy; validation failure exits with the error table and NO render attempt. Must NOT render from storyboard.yaml directly; must NOT mark FINAL_APPROVED when any check fails (§62.4 line 2308).
  Parallelization: Wave 4 | Blocked by: 5,6,10,12,13 | Blocks: 15,16
  References: doc §2.1 chain (55-88); §15-17 (1657-1729) preview/review/final semantics; §20 (1845-1859) AUTO list; §62.4 (2286-2308).
  Acceptance criteria (agent-executable): in a fixture project with 3-scene storyboard + valid audio: `vf preview` exits 0 producing `output/preview.mp4` + `runs/*.yaml` showing stages compile+render; `vf final` WITHOUT prior review approval exits non-zero; after `vf approve review`, `vf final` exits 0 producing `output/final.mp4` and state FINAL_APPROVED.
  QA scenarios: happy — transcript tee'd to `.omo/evidence/task-14-video-agent-v01.log`; failure — inject a missing audio file, `vf preview` must fail at validation (exit 1, file/field/line named), produce NO partial mp4, and previous outputs remain untouched.
  Commit: Y | `feat(cli): vf preview/final end-to-end render pipeline with gates`

- [x] 15. Benchmark project — 40s zh-CN CoT explainer
  What to do / Must NOT do: Create `projects/benchmark-v01/` via `vf new` then author REAL content (hand-written per §62 line 2193): storyboard with 6 scenes, total 38-44s: (1) Title “AI 思维链有什么用？” 5s; (2) Callout problem — 直接提问为什么出错 6s; (3) FlowChart — CoT 概念: 问题→拆解步骤1..3→答案 8s; (4) Terminal — few-shot prompt 示例 8s; (5) Comparison — 有/无 CoT 7s; (6) EndCard 5s. Audio: generate placeholder WAVs with EXACT scene durations via `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t <duration>` into `assets/audio/scene-N.wav` (edge-tts OPTIONAL offline enhancement — never a dependency, §62 lines 2181-2188). Fonts: commit `NotoSansSC-Regular.otf` + `JetBrainsMono-Regular.otf` into `assets/fonts/` (download from official Google Fonts repo; record source URLs in `assets/fonts/SOURCES.md` for §62.2 traceability 2259). Run the FULL loop: validate→compile→preview→approve review→final. Must NOT use AI-generated images; must NOT exceed 8 scenes or 60s.
  Parallelization: Wave 5 | Blocked by: 14 | Blocks: 16
  References: doc §47 (1767-1786) first benchmark; §62 (2190-2197) v0.1 benchmark contract; §62.2 (2259) asset traceability; §48 coverage list (1790-1812).
  Acceptance criteria (agent-executable): `npx vf validate projects/benchmark-v01/storyboard/storyboard.yaml` exit 0; `npx vf status` (cwd project) shows all stages ✓/FINAL_APPROVED; ffprobe `output/final.mp4`: 1920x1080, 30/1, duration = sum of scene durations ±0.5s; `git log --oneline -- projects/benchmark-v01 | wc -l` ≥ 4.
  QA scenarios: happy — full-loop transcript tee'd to `.omo/evidence/task-15-video-agent-v01.log`; failure — replace scene-03's audio with a 9-second file while its scene duration is 8s → `vf validate` must fail listing expected vs actual duration (§21.1 line 930), then revert.
  Commit: Y | `feat(benchmark): 40s zh-CN CoT explainer with full run history`

- [x] 16. Reproducibility regression + §62.4 acceptance scripts
  What to do / Must NOT do: Add `scripts/benchmark-verify.mjs` (root `npm run benchmark:verify`): renders benchmark-v01 TWICE into `.omo/tmp/r1/`, `.omo/tmp/r2/` (fresh run_ids), then asserts: RenderPlan digests identical (scene count, per-scene durationInFrames, totalFrames); ffprobe r1 vs r2: same width/height/r_frame_rate, duration delta <0.1s; writes JSON verdict to `.omo/evidence/`. Add `scripts/acceptance.mjs` (root `npm run acceptance`): programmatic §62.4 audit over a temp project clone — functional (validate→compile→render; error case returns file/field/line via fixture; approve/reject/rollback/resume CLI paths; failed render preserves artifacts; rollback keeps Git history + invalidates only downstream), video (specs, no missing assets via validate, audio≤scene check, caption safe-area, unique ids, duration=sum, twice-identity delegating to benchmark-verify), engineering (git history present, final traceable: run record for final.mp4 exists with input_commit matching `git rev-parse` of vdsl.yaml, FINAL_APPROVED unreachable when any check fails — test by flipping one check to fail). Must NOT make binary-identical MP4s a requirement (§62.3 line 2283 — structural identity only).
  Parallelization: Wave 5 | Blocked by: 14,15 | Blocks: 17
  References: doc §62.3 (2261-2283); §62.4 (2286-2308) all three acceptance blocks.
  Acceptance criteria (agent-executable): `npm run benchmark:verify` exits 0 with JSON verdict `{"identical":true,...}` in `.omo/evidence/task-16-video-agent-v01.json`; `npm run acceptance` exits 0 printing a ✓/✗ checklist with ALL ✓.
  QA scenarios: happy — both scripts' output tee'd to evidence; failure — mutate r2's RenderPlan digest before compare (simulated via env flag in the script) → verify must exit non-zero naming the differing field.
  Commit: Y | `test(regression): render-twice identity + full §62.4 acceptance audit`

- [x] 17. README + ARCHITECTURE docs
  What to do / Must NOT do: `README.md` — setup (node 26, `brew install ffmpeg`, `npm install`), quickstart (vf new → edit storyboard → vf preview → vf approve review → vf final), command table, benchmark reproduction. `ARCHITECTURE.md` — map each design-doc section (§2 principles, §18 state machine, §21 VDSL, §33 packages, §62 scope) to package/file paths; include the v0.2+ roadmap in doc order (§66 lines 2414-2440: Storyboard Agent → Research → Script → Voice/Subtitle → Review Agent → Pi Extension → YouTube → AI media) each with its doc phase section reference and entry point into the v0.1 codebase. Must NOT document unwritten v0.2 features as existing.
  Parallelization: Wave 5 | Blocked by: all | Blocks: —
  References: doc §65 (2370-2408) principles; §66 (2412-2445) roadmap order; §62 v0.1 boundary.
  Acceptance criteria (agent-executable): every command in README quickstart literally copy-paste-runs in a fresh clone (agent executes them); ARCHITECTURE.md contains zero paths to nonexistent files (`for p in $(grep -o 'packages/[a-z-]*' ARCHITECTURE.md | sort -u); test -d $p` exits 0).
  QA scenarios: happy — quickstart execution transcript tee'd to `.omo/evidence/task-17-video-agent-v01.log`; failure — README quickstart with a wrong flag (e.g. `vf previewx`) must be caught by the transcript run (command exits non-zero) and fixed before commit.
  Commit: Y | `docs: README quickstart + architecture map + v0.2 roadmap`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- One conventional commit per todo, only after that todo's acceptance criteria pass (messages specified per-todo). Wave boundaries get no extra merge commits — linear history on a feature branch `feat/video-agent-v01` off `main`.
- Git tags per doc §36 spirit at milestones: `m1-yaml-to-mp4` after todo 14 (first full Storyboard→VDSL→Render→MP4 loop), `v0.1` after todo 16 passes.
- Never commit: `node_modules/`, render outputs (`.omo/tmp/`, `output/*.mp4` except benchmark final artifacts may be committed deliberately), `.omo/evidence/` (gitignored), secrets (none expected — v0.1 calls no external APIs).
- Benchmark project commits its inputs (storyboard, fonts, audio, checkpoints, runs) so every Final is reproducible from history (§36 lines 1448-1473).

## Success criteria
All of the following are machine-checkable and map to doc §62.4 (lines 2286-2308):
1. **Functional:** `npm run acceptance` exits 0 — validate→compile→render on fixed input; invalid input yields file+field+line errors; approve/edit(via file)/reject/rollback/resume all exercisable via CLI; failed render preserves prior artifacts; rollback keeps Git history and invalidates only downstream stages.
2. **Video:** `output/final.mp4` of benchmark-v01 is 1920x1080 @ 30fps, no missing assets/fonts, audio durations ≤ scene durations, captions in safe area, unique scene ids, total duration = Σ scene durations (±0.5s); `npm run benchmark:verify` proves render-twice structural identity (scene count, per-scene frames, total duration, fps, resolution).
3. **Engineering:** benchmark project has ≥4 commits + complete `runs/` records; every final.mp4 traceable to its vdsl.yaml commit (`input_commit` matches); `npm run acceptance` fails ⇒ FINAL_APPROVED unreachable.
4. **Process:** all 17 todos checked with evidence files in `.omo/evidence/`; F1–F4 verification wave all APPROVE; zero doc §62 exclusions (agents/TTS-dep/multilang/Pi/cloud/DB/Electron) present in the codebase (`grep -ri "minimax\|glm\|openai\|anthropic" packages/` returns nothing).
