# Architecture — AI Video Agent (v0.9)

The design source is `docs/ai-video-agent-development-plan-v0.2.md`; the
traceable task plan is `docs/ai-video-agent-design-and-tasks-v0.2.md`;
the v0.1 codebase mapping lives in `docs/architecture-v01-map.md`.
This document describes the system AS BUILT — v0.9 (central prompt
registry; local diffusion provider removed).

## Principles (plan §29)

1. **Scene is the minimal editable unit** — scenes render to their own MP4
   cache (`scenes/`, `scenes-draft/`), keyed by fragment content hash;
   editing scene-007 re-renders only scene-007.
2. **Third-party skills never reach the core data model** — `@video/motion`'s
   `IartSkillAdapter` is the only reader of `.agents/skills/`; skill
   formats never leak into VDSL.
3. **Remotion is the renderer, not the planner** — agents produce
   structured specs; Remotion rasterizes.
4. **Human approval is workflow state** — `checkpoints/<stage>.yaml` with
   status approved/rejected/invalidated; preview is gated on an approved
   storyboard; final is gated on QA + review approval.
5. **AI generates · Human decides · Code renders · Git remembers**
   (plan §65) — the two human-edit files (`article.md` and
   `audio-config.yaml`) are the only files a user must hand-edit.
   Image generation follows the same pattern: `brand.yaml`
   (workspace-root) is a checked-in human-decision file the
   orchestrator respects; the actual generation runs deterministically
   off the resolved config.
6. **Image providers are HTTP APIs** — scene images come from a hosted
   provider (`minimax`, `openai`, `gemini`), each selected with
   `--image-provider` and authenticated by its own env var. `mock`
   gives deterministic placeholders; `none` skips image generation.
7. **Local decisions are advisory** (v0.6) — the Laya decision-model
   sidecar (bounded `choice`/`score`/`noul` answers, NOT a chat
   model) may pre-screen, annotate, and log, but never replaces a
   human gate, never drives a workflow transition, and degrades to
   exactly the pre-v0.6 behavior on any failure
   (`LAYA_MODE=off|shadow|on`, default off; plan:
   `docs/v0.6-laya-decision-integration-plan.md`).

## The pipeline

For end users — the full command flow. Everything between the two 🚪
gates is also driven by a single `video make` (see below).

```mermaid
flowchart TD
    videoNew["video new<br/>(create the project)"] --> videoDraft["video draft<br/>(LLM writes the article)"]
    videoNew -.->|"optional"| videoResearch["video research"]
    videoResearch --> videoScript["video script"]
    videoDraft --> humanFiles["article.md ⭐ + audio-config.yaml ⭐<br/>(the two human-edit files)"]
    videoScript -.-> videoStoryboard
    humanFiles --> videoStoryboard["video storyboard"]
    videoStoryboard --> gate1["video approve storyboard<br/>🚪 human gate 1"]
    gate1 -->|"approved"| videoMotion["video motion"]
    videoMotion --> videoAudio["video audio"]
    videoAudio --> videoReview["video review"]
    videoReview --> videoPreview["video preview<br/>(QA report + contact sheet)"]
    videoPreview --> gate2["video approve review<br/>🚪 human gate 2"]
    gate2 -->|"approved"| videoFinal["video final<br/>(final QA gate)"]
    videoFinal --> finalApproved["FINAL_APPROVED"]
    finalApproved --> videoYoutube["video youtube"]
    finalApproved --> videoThumbnail["video thumbnail"]
    finalApproved --> videoShorts["video shorts"]
    gate1 -.->|"one command"| videoMake["video make<br/>(tts · assets · preview · mix)"]
    videoMake -.-> gate2
```

```text
video new → (research → script →) storyboard → approve storyboard (GATE)
      → motion → audio → review
      → preview (QA report + contact sheet) → approve review (GATE)
      → final (QA gate) → FINAL_APPROVED → youtube / thumbnail / shorts
```

`video make` runs the compressed article.md-driven version of the same
pipeline (draft → tts → assets → preview → mix) and stops at the same
storyboard gate. Every render writes `qa/render-report.json` +
`qa/contact-sheet.png`.

The scene-visual step (within `generateSceneVisuals`) is one HTTP
request per scene to the selected provider, returning JPEG bytes
that are written to `assets/images/scene_N.jpg`.

## Packages (plan §32 aliases in parentheses; v0.5.2 additions marked)

How the packages fit together — decide, then generate, then render,
then check:

```mermaid
flowchart TD
    cli["@video/cli — all verbs · stage guards"]
    wf["@video/workflow — 10-state machine<br/>checkpoints · scene versions · run records"]

    subgraph decideG["1 · decide — LLM agents write structured specs"]
        agentPkgs["@video/agent-storyboard · research · script ·<br/>review · youtube (per-role provider routing)"]
        motionPkg["@video/motion — motion heuristics · planSceneMotion"]
    end

    vdsl["@video/vdsl — zod validation + deterministic compiler<br/>→ vdsl.yaml + RenderPlan"]

    subgraph assetsG["2 · generate — narration + visuals"]
        mediaGenPkg["@video/media-generators — images<br/>(mock · minimax · openai · gemini · none)"]
        audioPkgs["@video/tts · audio-assets · audio-mix<br/>(voice · BGM · SFX · ducking mix)"]
        mediaPkg["@video/media — CJK captions · ffprobe · duration sync"]
    end

    subgraph renderG["3 · render"]
        componentsPkg["@video/video-components — scene components<br/>+ captions/watermark/intro chrome"]
        rendererPkg["@video/video-renderer (Remotion) —<br/>per-scene MP4 cache → concatScenes"]
    end

    qaPkg["@video/qa — render report · contact sheet · export gate"]

    cli --> wf
    wf --> agentPkgs
    agentPkgs --> vdsl
    motionPkg --> vdsl
    vdsl --> renderG
    assetsG --> renderG
    rendererPkg --> qaPkg
```

The table below is the detailed reference (§32 aliases in
parentheses; v0.5.2 additions marked):

| Package | §32 alias | Role |
|---|---|---|
| `@video/llm` | llm | chat providers (GLM, MiniMax) with per-role routing + bounded retry/fallback; v0.6 `LayaClient` (advisory bounded decisions from the local laya-serve sidecar, `LAYA_MODE=off\|shadow\|on`) + the `laya-decisions.jsonl` sidecar writer |
| `@video/vdsl` | schema | VDSL 0.1/0.2 zod schema, validator (line-numbered errors), deterministic compiler → `vdsl/vdsl.yaml` + `RenderPlan` |
| `@video/motion` | motion | IartSkillAdapter, motion heuristics, deterministic `planSceneMotion`, Motion Agent (`callMotionAgent`) |
| `@video/prompts` | prompts | central prompt registry — every LLM/Laya prompt body is a file under `packages/prompts/prompts/` (`loadPrompt()`/`fillPrompt()`), so prompts are edited without touching agent code |
| `@video/draft` | draft | article drafter agent + scored quality judge + image-prompt expansion + image-style presets + regex visual classifier (+ Laya fall-through assist) |
| `@video/make` | make | `video make` pipeline: TTS → audio assets → scene visuals → scene-isolated render → mix; impact analysis, content-keyed caches |
| `@video/audio-plan` | audio-plan | Audio Planner agent (audio-config.yaml proposals from a parsed article) |
| `@video/agent-storyboard`, `@video/research`, `@video/script`, `@video/review`, `@video/youtube` | agent | LLM agents (per-role provider routing incl. `motion`, transient retry, quota fallback) |
| `@video/bilibili` | agent | Bilibili submission metadata. Packaging only — no public upload API exists, so there is no uploader here. Degrades to a deterministic package instead of failing. |
| `@video/video-components` | renderer | 22 scene components in `REGISTRY` incl. `DoodleScene` (canvas hand-drawn + beat-sync); chrome overlays (`CaptionsOverlay`, `BrandWatermark`, `BrandIntro`); 9 `style.theme` palettes; 5 intro gradients; animation/easing/doodle logic. |
| `@video/video-renderer` | remotion | scene-isolated Remotion rendering (`renderSceneToVideo`, `concatScenes`), draft mode, studio workspace generator |
| `@video/media` | assets | CJK caption wrap, ffprobe, duration sync (`syncSceneDurations`), scene-timing reader |
| `@video/media-generators` | images | `ImageProvider` + `VideoProvider` abstractions; `MockImageProvider`, `MiniMaxImageProvider` (**default since v0.8.1**), the OpenAI and Gemini image providers, `MiniMaxVideoProvider`. |
| `@video/tts`, `@video/audio-assets`, `@video/audio-mix` | audio | Edge TTS (+word timestamps), ducking/fades mix engine. **BGM has no provider service**: tags resolve against the curated library in `assets/bgm/` (project-local `assets/audio-assets/bgm/` shadows it), and the file is passed to ffmpeg in place rather than copied per project. `music.json` indexes that library with measured duration/loudness/dynamic-range plus scenario notes, and feeds the audio planner's choice. SFX tags still fall back to a mock placeholder. |
| `@video/qa` | qa | render report (duration/fps/resolution/audio/black-frames/assets/scene-audio-sync/captions/boundaries), contact sheet, export gate |
| `@video/learn` | learn | human-review learning loop: `video learn` sessions → lesson store → `promptRules()` injected into image-prompt expansion |
| `@video/workflow` | (agent state) | 10-state machine, checkpoints + invalidation, scene version store, run records |
| `@video/cli` | cli | all verbs (`video`), stage guards, state-machine wiring |
| `skills/`, `.agents/skills/` | skills | first-party + installed skill packs (`skills/INVENTORY.md`) |

## Visual renderer families (plan §9)

| `visual.renderer` | Components | Status |
|---|---|---|
| `remotion` | all classic REGISTRY components | wired |
| `canvas` | `DoodleScene` (ink strokes, seeded wobble, beat-sync) | wired (T4.4) |

Unwired renderer/component combinations fail loudly at render time.

## Determinism

- The compiler is pure (no clock/locale/fs order); re-compiling emitted
  vdsl.yaml is byte-identical (tested).
- Scene caches key on fragment content hash + narration audio state.
- Canvas/SVG drawing is a pure function of the frame: seeded PRNG
  (`rng(seed)`), never `Math.random`/`Date` (javascript-animation skill
  contract).
- `bundle({ enableCaching: false })` — Remotion's persistent webpack cache
  must be disabled IN THE BUNDLER OPTIONS (a `webpackOverride`
  `cache: false` is silently overwritten by Remotion and leaked 69 GB).

## Demos (plan §35)

| Demo | Example | Exercises |
|---|---|---|
| MCP Explainer (45 s) | `examples/mcp-explainer` | full pipeline, FlowChart diagrams, canvas, QA, final gate |
| AI Concept (60 s) | `examples/ai-concept` | hand-drawn canvas, beat-sync (100 BPM grid) |
| DevOps Architecture (90 s) | `examples/devops-architecture` | diagrams, cut/fade transitions, timeline choreography |
