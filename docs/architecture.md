# Architecture — AI Video Agent (v0.6.0: local image gen + decision layer)

The design source is `docs/ai-video-agent-development-plan-v0.2.md`; the
traceable task plan is `docs/ai-video-agent-design-and-tasks-v0.2.md`;
the v0.1 codebase mapping lives in `docs/architecture-v01-map.md`.
The local image generation subsystem added in v0.5 is specified in
`docs/v0.5-local-image-generation-plan.md`. This document describes
the system AS BUILT — v0.6.0 (T1–T6.2 all shipped; v0.6 Laya decision
layer shipped with `LAYA_MODE` default off).

## Principles (plan §29 + v0.5 plan §65)

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
   (v0.5 plan §65) — the two human-edit files (`article.md` and
   `audio-config.yaml`) are the only files a user must hand-edit.
   Image generation follows the same pattern: `lora-config.yaml`
   (per-project) and `brand.yaml` (workspace-root) are checked-in
   human-decision files the orchestrator respects; the actual
   generation runs deterministically off the resolved config.
6. **Local model sidecar pattern** (v0.5) — when a model is available
   locally (e.g. FLUX.2 Klein 4B), the TS pipeline spawns a Python
   worker via `uv run` rather than embedding model code in Node.
   The Python sidecar speaks a JSONL stdio protocol; the worker
   keeps one warm pipeline across a render. This is the same
   pattern used for any model that has a Python-native ecosystem
   (diffusers / peft / torchao) — never a Node binding.
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
    videoAudio --> videoExcalidraw["video excalidraw<br/>(diagram assets)"]
    videoExcalidraw --> videoReview["video review"]
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
      → motion → audio → excalidraw (assets) → review
      → preview (QA report + contact sheet) → approve review (GATE)
      → final (QA gate) → FINAL_APPROVED → youtube / thumbnail / shorts
```

`video make` runs the compressed article.md-driven version of the same
pipeline (draft → tts → assets → preview → mix) and stops at the same
storyboard gate. Every render writes `qa/render-report.json` +
`qa/contact-sheet.png`.

For the flux image provider, the scene-visual step (within
`generateSceneVisuals`) adds a Python-sidecar round trip: TS sends
JSONL jobs to `flux_worker.py`, which loads `Flux2KleinPipeline`
once, keeps it warm across the render, and returns JPEG bytes per
scene. With `--reference-style-anchor` (v0.5.2), scene 1 is
generated first and scenes 2..N condition on it via the 4B
pipeline's `image=` argument.

The flux round trip, as a diagram (why image generation never
touches Node):

```mermaid
flowchart LR
    cfg["lora-config.yaml ⭐ + brand.yaml ⭐<br/>(human-decision files)"] -->|"resolved config"| provider
    subgraph nodeSide["Node — @video/media-generators"]
        provider["FluxKleinImageProvider<br/>(pre-flight health check, v0.5.3)"]
    end
    subgraph pySide["Python sidecar — uv run flux_worker.py"]
        worker["JSONL stdio daemon"]
        pipe["Flux2KleinPipeline (diffusers)<br/>kept warm across the render"]
        worker --> pipe
    end
    provider -->|"JSONL job per scene"| worker
    worker -->|"JPEG bytes"| provider
    provider -.->|"scene 1 result becomes the anchor"| anchor["scene-001.jpg"]
    anchor -.->|"--reference-style-anchor:<br/>scenes 2…N pass it as image="| pipe
```

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
        mediaGenPkg["@video/media-generators — images<br/>(mock · minimax · flux)"]
        audioPkgs["@video/tts · audio-assets · audio-mix<br/>(voice · BGM · SFX · ducking mix)"]
        mediaPkg["@video/media — CJK captions · ffprobe · duration sync"]
        pySidecar["packages/media-generators/python<br/>flux_worker.py — spawned via uv run"]
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
    mediaGenPkg -.- pySidecar
    rendererPkg --> qaPkg
```

The table below is the detailed reference (§32 aliases in
parentheses; v0.5.2 additions marked):

| Package | §32 alias | Role |
|---|---|---|
| `@video/llm` | llm | chat providers (GLM, MiniMax) with per-role routing + bounded retry/fallback; v0.6 `LayaClient` (advisory bounded decisions from the local laya-serve sidecar, `LAYA_MODE=off\|shadow\|on`) + the `laya-decisions.jsonl` sidecar writer |
| `@video/vdsl` | schema | VDSL 0.1/0.2 zod schema, validator (line-numbered errors), deterministic compiler → `vdsl/vdsl.yaml` + `RenderPlan` |
| `@video/motion` | motion | IartSkillAdapter, motion heuristics, deterministic `planSceneMotion`, Motion Agent (`callMotionAgent`) |
| `@video/agent-storyboard`, `@video/research`, `@video/script`, `@video/review`, `@video/youtube` | agent | LLM agents (per-role provider routing incl. `motion`, transient retry, quota fallback) |
| `@video/video-components` | renderer | 24 scene components in `REGISTRY` incl. `SvgScene` (whiteboard/diagram + camera) and `DoodleScene` (canvas hand-drawn + beat-sync); chrome overlays (`CaptionsOverlay`, `BrandWatermark`, `BrandIntro`); 9 `style.theme` palettes; 5 intro gradients; animation/easing/doodle/excalidraw logic. |
| `@video/video-renderer` | remotion | scene-isolated Remotion rendering (`renderSceneToVideo`, `concatScenes`), draft mode, studio workspace generator |
| `@video/media` | assets | CJK caption wrap, ffprobe, duration sync (`syncSceneDurations`), scene-timing reader |
| `@video/media-generators` *(v0.5)* | images | `ImageProvider` + `VideoProvider` abstractions; `MockImageProvider`, `MiniMaxImageProvider`, `FluxKleinImageProvider` (v0.5; **default since v0.5.3**; local FLUX.2 Klein 4B via Python sidecar), `MiniMaxVideoProvider`. `lora-config.yaml` loader + `resolveLoraConfigPath`. |
| `@video/tts`, `@video/audio-assets`, `@video/audio-mix` | audio | Edge TTS (+word timestamps), BGM/SFX providers, ducking/fades mix engine |
| `@video/qa` | qa | render report (duration/fps/resolution/audio/black-frames/assets/scene-audio-sync/captions/boundaries), contact sheet, export gate |
| `@video/workflow` | (agent state) | 10-state machine, checkpoints + invalidation, scene version store, run records |
| `@video/cli` | cli | all verbs (`video`), stage guards, state-machine wiring |
| `skills/`, `.agents/skills/` | skills | first-party + installed skill packs (`skills/INVENTORY.md`) |
| `packages/media-generators/python/` *(v0.5)* | — | Python sidecar for local model providers: `flux_worker.py` (JSONL daemon, `Flux2KleinPipeline` via diffusers + pillow + peft), `pyproject.toml` + `uv.lock` (uv-managed Python 3.12 env: torch / diffusers / transformers / peft / pillow / torchao). |

## Visual renderer families (plan §9)

| `visual.renderer` | Components | Status |
|---|---|---|
| `remotion` | all classic REGISTRY components | wired |
| `svg` | `SvgScene` (diagram spec: nodes/edges, draw-on, target-driven camera) | wired (T4.3) |
| `canvas` | `DoodleScene` (ink strokes, seeded wobble, beat-sync) | wired (T4.4) |
| `excalidraw` | — | asset generator only (`video excalidraw` → `.excalidraw` + animated `.svg`, T7.1); not a render path |

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
| MCP Explainer (45 s) | `examples/mcp-explainer` | full pipeline, svg diagrams, canvas, QA, excalidraw, final gate |
| AI Concept (60 s) | `examples/ai-concept` | hand-drawn canvas, beat-sync (100 BPM grid) |
| DevOps Architecture (90 s) | `examples/devops-architecture` | diagrams, target-driven camera, cut/fade transitions, timeline choreography, excalidraw |
