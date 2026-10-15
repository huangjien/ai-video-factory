# Release Notes

Each tagged release of the AI Video Factory. The full pipeline goes:

```
video research → script → storyboard → audio (TTS) → audio-asset (BGM+SFX)
            ↓
       (write audio-assets/mix.yaml: bgm, sfx per scene_N, fades)
            ↓
       video preview → video approve review → video final --mix → final-mixed.mp4
            ↓
       video thumbnail --provider minimax → real AI thumbnail
       video shorts --provider minimax    → real AI Shorts clip
       video youtube                         → YouTube publishing package
       video review                          → Content/Visual/Technical review YAMLs
```

## v0.7.1 — Live Pipeline Progress (video-progress/1)

Long runs stop being silent. `video make` and `video draft` now print
live progress to **stderr** (stdout stays artifact-clean): step starts
(`▷ tts`), per-scene items with position and elapsed time
(`✓ [3/23] tts scene_03  4s`), and a heartbeat for any single call
longer than 30 s (`⏳ generate-visuals … 95s`, repeating every 20 s) —
a 20–40 min make run is no longer indistinguishable from a hang, for
agents polling background output and humans alike. The final report
table is unchanged; emission is structured events
(`ProgressEvent`/`heartbeat` from `@video/make`), defaulting to
silence for library callers.

## v0.7 — Agent-Aware Draft Questions (video-ask/1)

`video draft` no longer burns a full scored draft on silent defaults
when it runs inside an agent harness. When the CLI detects an agent
in the environment and one or more style knobs were left unspecified,
it prints a machine-readable question set to stdout
(`protocol: "video-ask/1"`) and exits 2 — before any provider is
constructed or any file written, so nothing is spent. The presenting
agent relays the questions through its native question UI and re-runs
the command with explicit flags.

### What changed

- **Auto-detect agent harnesses, emit a machine-readable question
  set** (`video draft`): zcode (`ZCODE_APP_VERSION`), Claude Code
  (`CLAUDECODE`), oh-my-openagent (`OMO_CODING_AGENT_DIR` — verified in
  the installed 5.1.30 source), oh-my-pi (`OMP_CODING_AGENT_DIR`) and
  pi-fork sessions (`PI_CODING_AGENT_DIR`; plain pi sets no marker)
  are detected out of the box; OpenCode exports no stable
  child-process marker and any other harness can be declared via
  `VIDEO_ASK_ENV=VAR,VAR=VALUE,…` (user-extendable comma list, no
  code change). Exit codes: `0` ran · `1` failure
  (unchanged) · `2` questions pending — run not started, nothing
  spent. On exit 2 stdout is pure JSON (jq-parseable); human-readable
  hints go to stderr.
- **Explicit flags always win — fully-specified runs are
  byte-identical**: questions are only ever emitted for knobs the
  caller did not pass, so replay scripts and agent-launched sub-runs
  never see a surprise exit 2. Unattended sub-runs pass `--no-ask`;
  headless cron/launchd shells set `VIDEO_ASK=off`.
- **New `--bgm <tag|none>` flag on `video draft`**: stamps the
  answered tag into a **fresh** `audio-config.yaml` as `bgm: <tag>`
  (`none` → `bgm: null`), overriding the audio-plan LLM's pick for
  the `bgm:` key only — voice and SFX stay LLM-chosen. An existing
  `audio-config.yaml` wins with a warning (hand edits are never
  overwritten); `--no-audio-plan` drops the `bgm` question entirely.
- **`--ask` / `--no-ask` overrides + `VIDEO_ASK=off` / `force`
  env**: `--no-ask` and `VIDEO_ASK=off` suppress the protocol;
  `--ask` and `VIDEO_ASK=force` force questions even with no harness
  detected; the default is auto (ask iff agent detected AND ≥1 knob
  unspecified). Unknown `VIDEO_ASK` values warn on stderr and behave
  as auto.
- **Question set = `lang` / `duration` / `image_style` / `style` /
  `bgm`**, each with a default and a recommended value that the
  presenting agent highlights (and may replace with a topic-aware
  pick, stating the reason). Only unspecified knobs are asked;
  `audience`, `model`, and the review-gate knobs stay flag-only.

Full contract: `docs/v0.7-agent-ask-protocol-plan.md`.

## v0.6.0 — Laya decision layer (advisory, default off)

**Date:** 2026-10-14 · **Design:** `docs/v0.6-laya-decision-integration-plan.md`

Wires the local Laya decision-model sidecar (`laya-serve` on
127.0.0.1:8019, see the operator notes) into the pipeline as an
ADVISORY decision layer. Laya returns bounded decisions
(`choice`/`score`/`noul` + probabilities) — it is not a chat model and
is never configured as a provider. Three rules govern every surface:
advisory only (never a human gate, never a workflow transition),
degrade-to-current-behavior (`decide()` never throws — null on any
failure), shadow first (`LAYA_MODE=off|shadow|on`, default **off**).

**New — `@video/llm`:**

- `packages/llm/src/laya.ts` — `LayaClient` (memoized `/health`
  pre-flight, 503+`Retry-After` retry-once, `min_confidence` gate that
  protects ACTING in mode=on; shadow records raw answers for the §7
  calibration corpus), `resolveLayaConfig()` (env `LAYA_MODE` /
  `LAYA_URL` / `LAYA_MIN_CONFIDENCE` / `LAYA_TIMEOUT_MS` /
  `LAYA_BEARER`, overridable via a `laya:` section in `llm.config.yaml`)
- `packages/llm/src/laya-shadow.ts` — `laya-decisions.jsonl` sidecar
  (append/read/summarize); every consult is recorded with
  `{surface, mode, state_sha256, answers, latency_ms, acted, expected,
agreed}`

**Surfaces (each independent, all behind the mode flag):**

- **D1 motion pre-screen** (`video motion`) — per scene Laya answers
  baseline_ok/refine; in `on` mode baseline_ok scenes skip the cloud
  `callMotionAgent` call (skip count printed; expected yield on a
  23-scene project: up to half the cloud calls).
- **D2 visual-classifier assist** (`video draft`, `video make`) — only
  the REGEX FALL-THROUGH branch may consult Laya for the scene
  component; matched keyword rules stay deterministic; results are
  REGISTRY-validated and applied via `articleToStoryboardYaml(article,
{visualOverrides})` (the mapper stays pure/sync).
- **D3 QA triage** (`video qa` / `preview` / `final` / `make`) — the
  finished render report is triaged pass/review/block; in `on` mode the
  verdict rides as `report.advisory.laya` + a caption on the contact
  sheet. The export gate NEVER reads the advisory.
- **`video laya health|ask|eval`** (new verb) — live service probe,
  one-off raw consult (JSON via stdin/`--file`), and the §7
  shadow-agreement table with per-surface promotion gates
  (motion ≥90%, visual ≥85%, triage ≥95%).

**Rejected in design (documented §3):** Laya-as-chat-provider, article
judge replacement (1k-context encoder deciding regeneration is a
quality gamble), and confidence inside workflow state transitions
(breaks the replay-verified determinism contract).

**Measured grounding (2026-10-14 probes):** warm inference ≈0.5s,
first call >15s → 20s pre-flight budget + 3s decide timeout; single
inference worker → 503/Retry-After handling; english-checkpoint
confidence uncalibrated (probe: 0.0075) → `min_confidence` gate is
mandatory and the calibration check is part of every promotion gate.

**Tests:** 29 new (14 llm client+sidecar, 9 draft assist, 6 qa
triage) — all mocked-fetch, no live service in CI. Verified
2026-10-14: every package's `src` suite green (llm 86, draft 344,
qa 36, cli 165, make 52, tts 50, media-generators 94, research 82,
workflow 92, vdsl 84, and the rest), eslint clean, `laya health/ask`
verified against the live local service.

## v0.4 — Visual & Publishing Quality

**Branch:** `feat/v0.4-video-quality`
**Tags:** `v0.4`

Seven quality wins — same human-gate principle, no breaking changes to the
two-file edit model (`article.md` + `audio-config.yaml`).

### What changed

- **Auto-captions from article** (`video draft` → T1): every auto-generated
  storyboard now carries `captions: { source: narration }`. Opt out with
  `--no-captions`. The existing `writeCaptionsSrt` step in `@video/make`
  produces `captions/<lang>.srt`; the new flag stops the overlay from
  loading it.
- **Visual-variety classifier** (T2, `packages/draft/src/visual-classifier.ts`):
  the article's `visual:` field is classified into the right VDSL
  component (FlowChart / Comparison / Terminal / Timeline / Callout /
  Illustration) instead of every scene being `AnimatedIllustration`.
  First scene still `Title`. Keyword vocabulary is bilingual (zh-CN +
  en-US). Hand-edited storyboards are preserved on subsequent runs.
- **Image prompt expansion** (T3, `--image-provider minimax`): the
  80-char `visual:` is rewritten into a 2-3 sentence image prompt
  (subject · environment · lighting · composition · style) via a
  cheap LLM call (≤400 chars, temperature 0.4). Cached on
  `sha256(visual|caption|narration[:200])` so re-runs are free.
  Audit sidecar: `assets/images/scene_N.prompt.txt`.
- **`--style <theme>` flag** (T8, `video draft`): `style.theme: warm-sunset`
  instead of the hardcoded `dark-tech`. Plumbed through CLI → article
  frontmatter → storyboard.
- **Hook ↔ YouTube coherence** (T4): the YouTube agent now receives the
  article's hook and topic explicitly. The thumbnail prompt is checked
  against a banned-token list (`text` / `字幕` / `字体` / `logo文字` /
  `海报` / `界面` / `仪表盘` / `截图` / …) and re-prompted once on a
  hit. The CLI never silently accepts a poster-style prompt.
- **QA gate in `video final`** + **QA surfacing in `video status`** (T6, T7):
  `video final` already ran QA + gated on errors; `video status` now prints
  `QA: ✗ N errors, ✓ M warnings` (or `✓ …`) so users know without
  running `video qa` manually.
- **`video retrospect <project>`** (T10): cheap LLM call that reads the
  last 5 `runs/*.yaml` + the latest QA report and writes
  `projects/<slug>/retrospect.md` with 3 concrete edits to
  `article.md`. `--dry-run` shows the prompt without calling the LLM.
  Records a run.
- **CLI banner** (T9): `video` and `video --help` print the minimal-API
  quickstart above the verb list.
- **Scene-aware mock Shorts** (T5): `video shorts` (mock) now snaps to
  the second scene boundary by default, skipping the `Title` card.
  Override with `--start <sec>`.

### New files

- `packages/draft/src/visual-classifier.ts` (+ test)
- `packages/draft/src/image-prompt.ts`
- `packages/cli/src/retrospect-command.ts` (+ test)

### Tests

- 481 + 9 new tests, 76 → 79 test files. `npm test` green.
- `pnpm run acceptance` (§62.4) still green.

### Non-changes

- The two-file edit model (`article.md` + `audio-config.yaml`) is
  unchanged.
- No auto-publishing, no auto-approve.
- Per-segment BGM transitions + cloud rendering + GLM image provider
  are still deliberately deferred (no verified spec).

## v0.4.1 — pi / oh-my-pi adapter

**Branch:** `feat/v0.4.1-pi-adapter`
**Tags:** `v0.4.1`

The harness adapter section of the README is no longer OpenCode-only.
The repo now ships first-class integration with `pi / oh-my-pi`
(`@oh-my-pi/pi-coding-agent`, `omp.sh`):

- **`.omp/commands/video.md`** — native slash command. OMP discovers
  commands at `<cwd>/.omp/commands/*.md`; `name` + `description`
  frontmatter, plus a body that documents the canonical pipeline,
  every verb, and the critical invariants. Identical in spirit to the
  existing `.opencode/command/video.md`.
- **`.omp/skills/<name>/SKILL.md`** — symlinks for all 28 third-party
  skills in `.agents/skills/` so OMP's native skill provider picks
  them up. Single source of truth remains `.agents/skills/`; OMP just
  needs the directory layout it expects.
- **`.omp/settings.json`** — enables native project commands, custom
  skill directories, and `/skill:<name>` interactive commands.

No new packages, no changes to the `video` CLI. The CLI stays the
harness-agnostic surface; every adapter forwards to it (OpenCode,
OMP, Claude Code, Codex, Gemini, or plain shell via `bin/video`).

## v0.4.2 — four new `style.theme` palettes

`packages/video-components/src/theme.ts` grows from 4 to 8 built-in
palettes. Total stays small so users can pick by name without a
picker UI:

- `forest-moss` — emerald / lime. Sustainability / botanical / outdoor.
- `sunset-pop` — near-black / bright yellow. Energetic consumer /
  entertainment.
- `terminal-vintage` — phosphor green on dark gray. Dev tutorials /
  retro hacker nostalgia. Uses JetBrains Mono across all roles and
  `linear` easing for the classic CRT feel.
- `paper-cream` — soft beige / burnt orange. Product / food /
  family-friendly explainers. Warmer and more modern than `paper-light`.

All four pass the existing luma-contrast smoke test
(`primary`/`background` spread > 120). Unknown / misspelled names
still fall back to `dark-tech` — renders never crash on a typo. The
`--style <name>` flag on `video draft` is unchanged; the article
frontmatter `theme: <name>` field carries through unchanged. New docs:

- `docs/INSTALLATION_AND_USAGE.md` §"Available themes (v0.4.2)" —
  English table.
- `docs/INSTALLATION_AND_USAGE.zh-CN.md` §"可用主题（v0.4.2）" —
  zh-CN mirror.

- Test additions (`packages/video-components/src/theme-registry.test.ts`):
  3 new cases — assert the 4 v0.4.2 names exist, `resolveTheme` finds
  them, and `terminal-vintage` uses JetBrains Mono everywhere.

## v0.4.4 — cosmetic UX redesign (creator / playback feel)

A surface pass that unifies the CLI typography + the video output palette
around the creator/playback aesthetic. **No changes to the human-gate
principle, the two human-edit files (`article.md`, `audio-config.yaml`),
or the acceptance gate.** Storyboards keep their current theme unless
`style.theme: ai-red` is set explicitly. The post-v0.4 visual plan
(`docs/v0.4-video-quality-plan.md`) is otherwise complete; this release is
its cosmetic + operator-UX follow-through.

**User-facing CLI surface:**

- New `packages/cli/src/ui.ts` — shared glyph vocabulary (`✓ ✗ ! ▷ ⏭ ● ○`)
  - `brandBannerLine()` + `channelHeader(name, state)` helpers.
- 8 commands now open with `brandBannerLine()` + `channelHeader(project,
"stage · verdict · provider")`: `status`, `make`, `new`, `qa`, `youtube`,
  `retrospect`, `review`, `validate`. Inline `\u2713`/`\u2717` glyphs
  replaced with `MARK_OK`/`MARK_FAIL`.
- New `video theme` verb (`packages/cli/src/theme-command.ts` + tests):
  palette index with ANSI truecolor swatches; `video theme <name>` for
  one palette's full token set; `video theme --cwd <root>` resolves
  a project's current `style.theme`. Honors the `NO_COLOR` env per the
  <https://no-color.org> convention.
- `video validate` now surfaces a stderr hint when `style.theme` names
  an unknown palette: lists every known name + a `video theme`
  cross-reference. Exit code unchanged (still 0 / 1 on validation
  status); the hint goes to stderr so structured-data pipelines aren't
  polluted.
- `video --help` BANNER: tagline refined, version 0.1.0 → 0.4.0,
  theme-preset list added; extended in-source sync comment lists every
  doc that must move in lockstep with the BANNER.

**Video output surface:**

- New `ai-red` palette (`#0F0F0F` player dark / `#FF0000` signature red /
  `#FFFFFF` text) registered as `style.theme: ai-red` (renamed from
  an exploratory `youtube-red` to avoid the trademark).
- New `channel-banner` intro gradient in `INTRO_GRADIENTS` (red → dark
  chrome) — pairs with `ai-red` for end-to-end creator look.
- `EndCard` CTA: square 8px-radius → subscribe-shaped pill
  (`border-radius: 999`, accent glow, inline SVG play triangle). API
  unchanged; the SVG replaces the `▶` text glyph so renders no longer
  depend on font fallback.

**Source-of-truth updates:**

- `packages/video-components/src/theme.ts` — `aiRedTheme` exported and
  registered in `THEMES` (now 9 entries).
- `packages/video-components/src/components/BrandOverlay.tsx` —
  `INTRO_GRADIENTS["channel-banner"]` added.
- `packages/video-components/src/components/EndCard.tsx` — pill CTA +
  inline SVG.
- `packages/cli/src/ui.ts` (new) — shared glyph + header helpers.
- `packages/cli/src/{index,status,make,new,qa,youtube,retrospect,review,
validate,theme}-command.ts` — banner + ui markers.
- `packages/cli/src/{theme,validate}-command.test.ts` — new + extended
  test coverage (16 new test cases: 13 for `theme`, 3 for the validate
  hint).
- `packages/video-components/src/theme-registry.test.ts` — `toBe(8)`
  loosened to `toBeGreaterThanOrEqual(8)` since post-v0.4 theme additions
  legitimately grow the registry; the explicit per-name `toContain`
  checks still catch accidental removals.

**Tests:**

- `pnpm test` → **92 / 92 files, 653 / 653 tests pass**.
- `npm run acceptance` → **11 / 11 §62.4 checks pass** (render exists,
  no external AI providers, state FINAL_APPROVED, status exits 0).

**Docs synced in this release:**

- `README.md` — `video theme` row added to the minimal-API table; new
  "Theme presets" subsection with 9-row table; cross-reference to
  `video theme` for inspection.
- `docs/INSTALLATION_AND_USAGE.md` (EN + zh-CN) — theme count lifted
  from "eight" to "nine"; `ai-red` row added; `video theme` mention.
- `docs/schema.md` — `ai-red` row in the theme table.
- `docs/CONTRIBUTING.md` + `docs/architecture.md` +
  `docs/architecture-v01-map.md` — `@video/video-components` row updated
  to current counts (24 scene components + chrome overlays + 7 animation
  primitives + 9 themes + 5 intro gradients).
- `packages/cli/src/index.ts` — extended BANNER sync comment to list
  every doc surface that must move in lockstep with the BANNER.

## v0.5.2 — image-to-image style anchor + idempotency fix

Builds on v0.5 with **image-to-image style consistency** across a
video. When `--image-provider flux --reference-style-anchor` is
set, the orchestrator generates the anchor scene first, then
conditions every subsequent scene on it via the 4B pipeline's
`image=` argument (the 9B KV variant is gated; not used here). New
`--anchor-scene <N>` (default 1) lets the user pick a later scene
as the anchor. Off by default — current per-scene-independent
behavior is preserved.

A real bug was caught and fixed in the same release: the first
version of the orchestrator only set `styleAnchor` in the
post-generation try-block, so re-runs with
`--reference-style-anchor` silently dropped the anchor when the
anchor scene's image already existed on disk. Now the anchor is
promoted on both fresh and idempotent paths. Guarded by a vitest
regression test (`packages/make/src/style-anchor.test.ts`).

**User-facing CLI surface:**

- `video make <p> --image-provider flux --reference-style-anchor` —
  style anchor mode (off by default).
- `video make <p> --image-provider flux --reference-style-anchor --anchor-scene <N>` —
  1-based scene number to use as the anchor.
- `video make` and `video thumbnail` now accept `--lora-config` and
  `--lora` (covered under v0.5.1, but threaded through here).

**Source-of-truth updates:**

- `packages/media-generators/src/image.ts` — `ImageRequest` gains
  optional `referenceImage?: string` (backwards-compatible: providers
  that don't support it ignore the field).
- `packages/media-generators/src/flux-image.ts` — `FluxKleinImageProvider`
  forwards `referenceImage` into the JSONL job envelope.
- `packages/media-generators/python/flux_worker.py` — new
  `referenceImage` field on the request protocol; opens the file via
  PIL in real mode and validates readability in selftest mode;
  passes it as `image=` to `Flux2KleinPipeline.__call__`.
- `packages/make/src/index.ts` — `generateSceneVisuals` is now
  exported; `referenceStyleAnchor` and `anchorScene` options with
  idempotency-safe promotion; warning when `anchorScene > scene count`.
- `packages/cli/src/make-command.ts` — `--reference-style-anchor` and
  `--anchor-scene <n>` options (with positive-integer parser).

**Tests:**

- 4 new vitest cases in `style-anchor.test.ts` (fresh run, idempotent
  regression, anchorScene=3, anchorScene > count warning).
- 2 new vitest cases in `flux-image.test.ts` (reference-image happy
  path and missing-file negative path).
- `pnpm build` clean; 233 / 233 tests green.

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T6.2 marked shipped
  with the real-pipeline evidence (per-pixel RMS diff p95 = 225/255
  between t2i and i2i at 512×512, 4 steps on the 4B pipeline).
- `README.md` — new "Style anchor — image-to-image across scenes"
  subsection under "Local Image Generation".
- `packages/media-generators/python/README.md` — protocol section
  documents the `referenceImage` field.
- `~/.agents/skills/video/SKILL.md` — synced to v0.5.2 surface.

## v0.5.1 — LoRA config surface + base-4B model switch

Builds on v0.5 with the **LoRA conventions** (T5) and the **base-4B
quality path** (T6.1) from the v0.5 plan. Adapters are now a
checked-in human-edit file (`lora-config.yaml` at `<projectRoot>` or
`<repo>`), mirroring the `audio-config.yaml` convention. License
sidecars are enforced when declared. The legacy `FLUX2_LORA` env /
`lora:` option still works for quick experiments. `flux_worker.py
--check-model <repo_id>` reports the `is_distilled` field for any
checkpoint so users can pick between the 4B (8 steps, distilled)
and the 4B base (50 steps, guidance honored) variants before
committing to a multi-GB download.

**User-facing CLI surface:**

- `video make <p> --lora-config <path>` — explicit lora-config.yaml
  path (overrides the auto-resolved file).
- `video make <p> --lora <spec>` — legacy "path[:scale][,…]" string
  form.
- `video thumbnail <p> --provider flux` now auto-resolves
  lora-config.yaml and accepts the same `--lora-config` /
  `--lora` overrides as `video make`.

**Source-of-truth updates:**

- `packages/media-generators/src/lora-config.ts` — `lora-config.yaml`
  loader + `resolveLoraConfigPath` with project-→-root-→-env
  precedence. Source resolution distinguishes HF repo ids from local
  files by extension (`.safetensors` / `.bin` / `.pt` / `.gguf` /
  `.ckpt` → local).
- `packages/media-generators/src/flux-image.ts` — new
  `loraConfigPath` provider option, flows as `FLUX2_LORA_CONFIG` env
  to the worker.
- `packages/media-generators/python/flux_worker.py` —
  `parse_lora_config`; existing `load_lora_weights` /
  `set_adapters` path reused.
- `packages/make/src/index.ts` — `generateSceneVisuals` resolves
  lora config (project → root) when the provider is flux.
- `packages/cli/src/{make,thumbnail}-command.ts` — `--lora-config` and
  `--lora` options.
- `packages/media-generators/python/flux_worker.py` — new
  `--check-model REPO_ID` mode that fetches only `model_index.json`
  (no safetensors) and reports `is_distilled` + the worker-derived
  step/guidance defaults.

**Tests:**

- 8 new vitest cases in `lora-config.test.ts` (empty config, source
  resolution, scale+license, sidecar enforcement, malformed YAML,
  precedence ordering for `resolveLoraConfigPath`).
- 2 new vitest cases in `flux-image.test.ts` (end-to-end against the
  `--selftest` worker: lora-config forward-through, license
  sidecar path propagation).
- 2 new vitest cases in `flux-image.test.ts` (real LoRA download +
  real 4B pipeline smoke: `fal/flux-2-klein-4B-outpaint-lora`,
  Apache-2.0; pipeline ready in 27.5 s, lora adapter loaded, 75 s
  per image post-ready).
- `pnpm build` clean; all tests green at the time of the v0.5
  merge (the v0.5 entry is the same merge, since T5 + T6.1 landed
  there).

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T5 and §T6.1 marked
  shipped with the verification evidence.
- `README.md` — new "LoRA style adapters" section under "Local
  Image Generation".
- `packages/media-generators/python/README.md` — new "LoRA" section
  documenting the two surfaces (config file + env override).
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5.1 surface.

## v0.5 — local FLUX.2 Klein 4B image generation

The headline v0.5 release. Adds a fourth image provider
(`--image-provider flux`) that runs `black-forest-labs/FLUX.2-klein-4B`
locally on Apple Silicon via a Python sidecar (Hugging Face
`diffusers` + `pillow` + LoRA). No API key, no quota, no network
after the one-time ~22 GB weight download. The TS provider keeps
one warm pipeline across a render via a JSONL stdio protocol;
the worker applies MPS group offloading so the ~22 GB bf16 stack
fits in 24 GB unified memory on Apple Silicon.

T1–T4 of the v0.5 plan (`docs/v0.5-local-image-generation-plan.md`)
are all shipped: Python worker, TS provider, full pipeline
wiring (make + thumbnail), env config, weights downloaded. The
design doc was written first and the implementation followed its
acceptance criteria end-to-end (real-pipeline smoke on this M4:
load 27.5 s, first image 81 s incl. shader warmup, valid JPEG at
exact requested dimensions).

**User-facing CLI surface:**

- `video make <p> --image-provider flux` — scene visuals at
  1920×1080 from the local model.
- `video thumbnail <p> --provider flux` — 1280×720 thumbnails.
- New Python sidecar under `packages/media-generators/python/`:
  `uv sync` to install deps; `uv run python flux_worker.py
--download` to fetch weights; `uv run python flux_worker.py
--check` to verify MPS.

**Source-of-truth updates (this is a long list — v0.5 was a real
milestone):**

- `packages/media-generators/python/pyproject.toml` — uv-managed
  Python 3.12 env (lockfile committed): torch, diffusers,
  transformers, accelerate, peft, safetensors, pillow,
  huggingface_hub. (torchao added in v0.5.2.)
- `packages/media-generators/python/flux_worker.py` — JSONL daemon
  - `--check` / `--download` / `--selftest` / `--check-model`
    modes; VAE-align dim snapping + Pillow fit; MPS group-offload
    memory strategy; per-job error isolation.
- `packages/media-generators/src/image.ts` — `ImageProvider` contract
  unchanged (since v0.2).
- `packages/media-generators/src/flux-image.ts` — `FluxKleinImageProvider`
  implementing `ImageProvider` via worker subprocess; lazy spawn,
  ready handshake, per-job timeouts, crash-restart on next call,
  stderr tail surfaced in `ImageGenerationError`, `dispose()` +
  parent-exit kill.
- `packages/media-generators/src/{index,minimax-image,minimax-video}.ts` —
  new provider + new exports.
- `packages/make/src/index.ts` — `generateSceneVisuals` widens
  provider union to include `flux`; constructs `FluxKleinImageProvider`
  with env-resolved lora config.
- `packages/cli/src/{make,thumbnail}-command.ts` — `flux` added to
  the `--image-provider` and `--provider` choices; help text
  updated.
- `.gitignore` — `models/` (weights) and `.venv/` added.
- `eslint.config.mjs` — `**/.venv/**` and `**/models/**` added
  to ignores so the Python venv's bundled JS doesn't get linted.

**Tests:**

- New `packages/media-generators/src/flux-image.test.ts` — 6
  initial cases (provider name, empty-prompt guard, JPEG magic
  bytes, determinism, worker-error propagation, missing-sidecar
  guard).
- Real pipeline smoke on this M4: 640×384 at 6 steps, ~22 s warm
  per image, JPEG validated by PIL.
- `pnpm build` clean; all tests green at the time of the v0.5
  merge (per the v0.5 commit message: 227 across media-generators,
  make, and cli; 40 new tests added in this release on top of the
  pre-v0.5 baseline of 187).

**Docs synced in this release:**

- New `docs/v0.5-local-image-generation-plan.md` — the design
  doc for v0.5. Two human-edit files (`article.md`,
  `audio-config.yaml`) remain the only files a user must hand-edit.
  Derived files stay re-derivable and idempotent.
- `README.md` — new "Local Image Generation" section, the
  minimal-API table regenerated via `pnpm run docs:commands`.
- `packages/media-generators/python/README.md` — setup, usage,
  LoRA, env-knob table, protocol.
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5 surface.

## v0.5.3 — flux is the default; pre-flight health check

Two product calls in one release:

1. **`flux` is now the default image provider** for `video make`.
   `packages/make/src/index.ts:181` — `provider: opts.imageProvider ??
(opts.fake ? "none" : "flux")` (was `minimax`). The `mock` provider
   was the only other default-flip change this would conflict with;
   `--fake` keeps its existing "none" path. `video thumbnail` is
   intentionally untouched — its `mock` default is the right answer
   for a one-shot operation, and a user who wants flux on
   thumbnails passes `--provider flux` explicitly. No code change
   to the `--image-provider` flag — only the default when the
   flag is omitted.

2. **Pre-flight health check** before the first scene image
   generation. `FluxKleinImageProvider` runs `uv run python
flux_worker.py --check` once per provider instance; on
   failure, throws `ImageGenerationError` with the actionable
   fix hint: "Fix: cd packages/media-generators/python && uv sync
   && uv run python flux_worker.py --check". This catches the
   three real first-time-user failure modes (uv missing, python
   env not synced, weights not downloaded) with a clear message
   instead of a confusing traceback. Bypass with
   `FLUX2_SKIP_HEALTH_CHECK=1` (for CI / known-good envs).
   Doc §T7.

Side-effect fix from the same session: `spawnWorker` now
listens for the `error` event on the spawned `ChildProcess`.
Without this, an async spawn that fails with ENOENT (e.g. bad
`pythonBin` with bypass) would hang the ready handshake until
timeout. The bypass test exercises this path; the fix is two
lines + a comment.

**User-facing CLI surface:**

- `video make <p>` — now generates images via the local
  FLUX.2 Klein 4B by default (no flag required). If the local
  flux service is not ready, the render fails loud with the fix
  hint before any other work begins.
- `FLUX2_SKIP_HEALTH_CHECK=1` env — bypass the pre-flight check
  (e.g. for CI / a known-good env where uv + python + weights
  are already verified).

**Source-of-truth updates:**

- `packages/make/src/index.ts:181` — default image provider
  flipped from `minimax` to `flux` (gated on `!fake`).
- `packages/media-generators/src/flux-image.ts`:
  `FluxKleinImageProvider` now has `runHealthCheck()` called
  from `preflightAndSpawn()` (replaces the old direct
  `spawnWorker` call). The check runs once per provider
  instance (memoized via `healthChecked`); result is a
  synchronous throw with a clear error message. Bypass via
  `FLUX2_SKIP_HEALTH_CHECK=1`. Also adds a `proc.once("error",
...)` handler to the async `spawn` so ENOENT doesn't hang
  the ready handshake.
- `packages/cli/src/index.ts` — `VERSION = "0.5.3"` (BANNER
  displays "v0.5").

**Tests:**

- 3 new vitest cases in `flux-image.test.ts`:
  - health check exits non-zero → `ImageGenerationError` with
    the fix hint + "exited with code 1" + the `uv sync` command
    and `--check` flag
  - health check fails because `uv` itself is missing (ENOENT)
    → `ImageGenerationError` with "failed to spawn"
  - `FLUX2_SKIP_HEALTH_CHECK=1` honored → failure message does
    NOT contain "flux service not ready" (proves the bypass
    is engaged, even when the env is otherwise broken)
- 236 / 236 tests green.

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T7 marked
  shipped.
- `README.md` — `video make` snippet now implies flux as the
  default; "Local Image Generation" section notes the default
  change.
- `docs/INSTALLATION_AND_USAGE.md` — `video make` snippets
  updated to flag the flux default + the pre-flight check.
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5.3
  surface.

## v0.4.3 — default `style.theme` flipped to `paper-light`

The default theme for any storyboard that doesn't declare one (and for
any `video draft` that doesn't pass `--style`) is now **`paper-light`**
instead of `dark-tech`. Unknown / misspelled theme names also fall back
to `paper-light`. The `dark-tech` palette and every other theme name
are unchanged — set `theme: dark-tech` explicitly in `article.md`
frontmatter or `storyboard.yaml` `style:` block to keep the old look.

**Rationale.** `paper-light` pairs naturally with the existing
`DoodleScene` (canvas hand-drawn) component, which forces its own
`paper` background regardless of theme; matching defaults reduce
disagreement. Tech-focused users who prefer `dark-tech` add one line
to their article frontmatter.

**Source-of-truth defaults updated:**

- `packages/video-components/src/theme.ts` — `resolveTheme()` returns
  `paperLightTheme` for both undefined input and unknown names.
- `packages/video-components/src/components/Background.tsx` — default
  prop switches to `paperLightTheme`.
- `packages/vdsl/src/schema.ts` — `styleSchema.theme` zod default →
  `"paper-light"`.
- `packages/vdsl/src/compile.ts` — fallback for missing theme →
  `"paper-light"`.
- `packages/draft/src/schemas.ts` — `articleToStoryboardYaml` reads
  `f.theme ?? "paper-light"`.
- `packages/cli/src/storyboard-command.ts` — `opts.style ?? "paper-light"`.
- `packages/cli/src/index.ts` — `--help` text for both `video draft` and
  `video storyboard` reflects the new default.

**Tests:**

- `theme-registry.test.ts` — `resolveTheme(undefined)`, `null`, `""`,
  and a typo all now resolve to `paperLightTheme`. Explicit
  `resolveTheme("dark-tech")` still returns `darkTechTheme`. Renamed
  the case "falls back to dark-tech for unknown/missing names" →
  "defaults to paper-light for unknown/missing names (v0.4.3)".
- `packages/draft/src/schemas.test.ts` — header assertion
  `style.theme: "dark-tech"` → `"paper-light"`. Other tests that
  supply an explicit theme name (the bulk of the suite) are unchanged.

**Docs:**

- `docs/INSTALLATION_AND_USAGE.md` §"Available themes (v0.4.3)" —
  intro + 8-row table now lead with `paper-light` as the new default.
- `docs/INSTALLATION_AND_USAGE.zh-CN.md` §"可用主题（v0.4.3）" —
  zh-CN mirror.
- `docs/schema.md` — `style.theme` example + table show
  `paper-light (v0.4.3 default)` first; pre-v0.4.3 storyboards still
  valid (back-compat preserved).

## v0.3.11 — remove the "old version" traces

**Branch:** `chore/v0.3.11-drop-legacy-traces`
**Tags:** `v0.3.11`

- **Doc cleanup**: deleted every user-facing "Legacy / 旧版 / 遗留" section. The minimal-API workflow is now the only path the docs lead with.
  - README: dropped the 14-row "Legacy commands (still working)" table and the (v0.4) header label; replaced with a single one-liner noting that the fine-grained per-stage verbs are wired for back-compat with older projects.
  - INSTALLATION_AND_USAGE (EN + zh-CN): removed §6.5 "Legacy core workflow", §7.1 "Legacy workflow commands", §9.5 "Legacy `video audio`", §12.8 "Legacy multi-command pipeline", the "Legacy AI agents" subsection, the "Legacy `final` says review is not approved" troubleshooting entry, and the introductory "Legacy multi-stage commands" mention. Also de-"legacy"-ified the remaining project-tree annotations and the `video youtube` fallback comment.
- **Code cleanup**: dropped the vestigial `slugifyForProject` identity passthrough from `packages/cli/src/project-path.ts` (a leftover from before `resolveProjectDir` became the single resolution entry point) and the unused import in `research-command.ts`.
- What was kept: RELEASES.md history, ARCHITECTURE.md, the design doc, and the legacy verb implementations themselves (`video audio`, `video audio-asset`, `video mix`, `video preview`, `video final`, `video approve`/`reject`/`rollback`, `video research`, `video script`, `video storyboard`, `video review`, `video youtube`, `video thumbnail`, `video shorts`, `video status`/`video resume`, `video validate`) still ship — they power existing projects and back-compat. The change is to remove the references from the user-facing surface, not the implementations.

## v0.3.10 — `video draft --file <path>` seeds the article with your own idea

**Branch:** `feat/v0.3.10-draft-idea-file`
**Tags:** `v0.3.10`

- **New `video draft --file <path>` flag** — accept a text or markdown file as the user's raw idea. The LLM treats it as the **major idea / opinions seed**: it polishes wording, structure, and flow, but the prompt explicitly forbids changing, contradicting, softening, or replacing any opinion expressed in the seed.
- `--file` and `--from` are **mutually exclusive** — `--from` revises an existing draft (different semantics); passing both is rejected at the CLI with a clear message.
- Empty / missing `--file` produces a readable error before the project lookup runs (input validation now precedes resolution so the user sees the most useful error first).
- Prompt split: existing `fromContent` ("Existing content to revise, preserve intent, improve as needed") is now joined by a distinct `ideaSeed` ("The user's major idea — polish wording, do NOT change opinions") rendered as its own user-message section.
- Tests: 365/365 pass; new "includes ideaSeed as the user's major idea with preserve-opinions wording" case in `schemas.test.ts`. Verified live on a fresh project: a seed file containing 3 stated opinions + a "don't go off-topic" instruction produced an article where all opinion-bearing terms survived (漂移 ×17, FVD ×5, Harness ×4, 指标 ×7) and forbidden off-topic terms (安全/自动驾驶) appeared 0 times.
- Docs: README draft row + INSTALLATION §6.1 + §12.0 + §13 walkthrough (EN + zh-CN).

## v0.3.9 — `video draft` merges the audio-plan step

**Branch:** `feat/v0.3.9-draft-merges-audio-plan`
**Tags:** `v0.3.9`

- **`video draft <topic>` now writes `article.md` AND `audio-config.yaml` in one invocation** (the audio-plan agent runs on the freshly drafted article, reusing the same provider + fallback routing). The minimal workflow drops from three commands to two: `video new` → `video draft` → `video make`.
- **Human-checkpoint guardrails**: an existing `audio-config.yaml` is never overwritten (hand edits win — the command prints a note pointing at `video audio-plan` to regenerate); `--no-audio-plan` skips the step for article-only drafts. If the audio-plan LLM call fails, the draft still succeeds with a hint to run `video audio-plan` separately.
- `video audio-plan` remains a first-class verb for regenerating the config after hand-editing article.md (incl. `--strict`).
- New exported helper `writeAudioConfigIfAbsent` in `draft-command.ts` (unit-tested merge policy: written / kept / failed / skipped).
- Tests: 364/364 pass; new `packages/cli/src/draft-merge.test.ts` (4 cases with a fake provider). Verified live end-to-end on a fresh project: one `video draft` produced article.md + storyboard.yaml + audio-config.yaml (voice/bgm/2 SFX cues); re-run kept the existing audio-config.yaml.

## v0.3.8 — every `<project>` argument accepts the topic, not just the folder name

**Branch:** `feat/v0.3.8-project-arg-resolution`
**Tags:** `v0.3.8`

- **New `resolveProjectDir` in `packages/cli/src/project-path.ts`** — one forgiving resolution ladder for every verb that looks up an existing project: (1) direct path to a project root, (2) exact folder name under `projects/`, (3) human topic slugified + case/separator-insensitive (`"Harness Engineering"` / `harness_engineering` / `harness-engineering` all match), (4) unique folder-name prefix. Ambiguous prefixes error listing candidates; zero matches list every available project.
- **Wired into all 14 lookup call sites**: `audio`, `audio-asset`, `mix`, `review`, `youtube`, `thumbnail`, `shorts` (previously raw `path.join` — exact folder name only), plus `make`, `audio-plan`, `draft` existence check, `preview`, `status`, and the five workflow verbs (`approve`/`reject`/`rollback`/`resume` + checkpoint). Generators (`new`/`research`/`script`/`storyboard`) keep slugifying, since they create directories.
- CLI `--help` argument descriptions updated to say "topic, folder name, path, or unique prefix".
- Tests: 360/360 pass; new `packages/cli/src/project-path.test.ts` (11 cases: exact / slug / underscore / CJK / unique prefix / ambiguous / zero-match listing / direct path / empty / non-project dir / missing projects dir).

## v0.3.7 — real BGM/SFX in `video make` via `--bgm-dir` / `--sfx-dir`

**Branch:** `feat/v0.3.7-make-audio-dirs`
**Tags:** `v0.3.7`

- **`video make <project> --bgm-dir <dir> --sfx-dir <dir>`** wires the existing `FileBasedAudioAssetProvider` into the make pipeline. The tags in `audio-config.yaml` (`bgm: calm`, `sfx: {scene_1: whoosh}`) resolve to `{tag}.wav` inside your library (exact filename first, then any `.wav` containing the tag). Without the flags the audio-assets step keeps writing 1-second silent mock placeholders — meaning the BGM ducking/fades in `video mix` were technically running over silence.
- Per-kind selection: `--bgm-dir` alone upgrades only BGM (SFX stays mock), and vice versa. A sibling `{tag}.license.txt` in your library is surfaced on the make report; a missing tag fails the `audio-assets` step readably (add the file or drop the cue).
- **`runMake` no longer crashes the CLI on a failed step.** `runStep` failures are recorded as `✗` steps and later steps are skipped (they depend on the failed step's outputs), so `video make` exits 1 with the per-step summary instead of a stack trace.
- `runAudioAssets` is exported from `@video/make` for direct testing.
- Docs: corrected earlier `--imageProvider` mentions to the real kebab-case flag `--image-provider`; new `--bgm-dir`/`--sfx-dir` guidance in §6.2 and §9.1 (EN + zh-CN).
- Tests: 349/349 pass; new `packages/make/src/audio-asset-dirs.test.ts` covers real-bytes copy + license surfacing, per-kind fallback to mock, mock default, and the missing-tag failure. Verified end-to-end on `projects/harness-engineering`: 290 s real BGM (25.5 MB) + 2 SFX cues land in `assets/audio-assets/` and `final-mixed.mp4` carries audible audio.

## v0.3.6 — `--fake` keeps scenes visible + malformed-draft narration recovery

**Branch:** `fix/v0.3.6-fake-image-default`
**Tags:** `v0.3.6`

- **`video make --fake` default imageProvider changed from `"mock"` to `"none"`.** The mock provider produced 64×36 solid-colour PNGs, and `updateStoryboardForImages` rewrote every scene from `AnimatedIllustration` (caption + animated SVG) to `ImageBackground` (image-only). For long videos this left ~9 minutes of blank frames after the title card. Defaulting to `"none"` skips image generation in offline mode and scenes keep `AnimatedIllustration`. Pass `--image-provider mock` explicitly if you want to exercise the ImageBackground path with placeholders.
- **`updateStoryboardForImages` carries the scene caption into the new ImageBackground props**, and `ImageBackground` now renders an optional bottom-overlay caption. So if image generation partially fails or mock images are in use, scenes still show their caption text.
- **`articleToStoryboardYaml` truncates long `Title.subtext`** at the first natural punctuation near 50 characters, so old drafts with very long LLM visual descriptions no longer overflow the 36 px subtext `<p>`.
- **LLM prompt tightened**: the `VISUAL DIRECTION` section now tells the drafter the renderer keyword-matches to a small shape vocabulary, so extra description beyond the matching keyword is dead weight that bloats on-screen captions.
- **Empty-narration draft recovery.** Real failure mode (seen on the `harness-engineering` project): the LLM puts all prose in `## N. ...` section bodies and ships every scene's `narration:` blank — the strict zod schema then rejected `video audio-plan` (and would have rejected `video make`) with an opaque 19-issue JSON dump. New `parseArticleWithRecovery` in `@video/draft`: strict parse first, and on the empty-narration failure back-fill narrations from section bodies (sentence-aware distribution across scenes; only `## N. ...` headings count, so the H1 title and hook block are never treated as a section). All four article.md consumers route through it — `video make` (surfaces a `recover-narrations` step in the report), `video audio-plan` (prints a warning + `video draft --from` hint), `video draft` storyboard-sync, and `video youtube`. `video audio-plan --strict` keeps the old fail-loudly behaviour for CI.
- **LLM prompt (narration)**: §7 SCENE NARRATION now states the narration field must contain the actual spoken content and that section bodies do not replace it.
- Tests: 345/345 pass; added `packages/make/src/fake-image-default.test.ts`, plus `schemas.test.ts` cases for lenient parse, recovery distribution, kept-verbatim scenes, `parseArticleWithRecovery` passthrough/rethrow, and subtext truncation.

## v0.3.5 — SFX cues + BGM fades + `video final --mix`

**Branch:** `feat/v0.3-sfx-cues-and-fade`
**Tags:** `v0.3.5`

- `audio-assets/mix.yaml` convention: `bgm`, `sfx: {scene_N: tag}`, `bgm_fade_in_sec`, `bgm_fade_out_sec`. CLI flags override the spec.
- New engine `mixTracksWithSpec` places SFX cues via `adelay` + applies `afade=in/out` to the BGM track.
- `video mix` reads `mix.yaml` (or `--mix-yaml <path>`) + supports `--bgm-fade-in/--bgm-fade-out` flags.
- `video final --mix` chains `runMix` after the final render so the published artifact is `output/final-mixed.mp4`.
- Docs: refreshed stale "What's NOT here yet" sections; consolidated ARCHITECTURE roadmap duplication.

## v0.3.4 — Audio mixing engine + `video mix` CLI

**Branch:** `feat/v0.3-audio-mix`
**Tags:** `v0.3.4`

- `@video/audio-mix` package with `mixTracks(opts)` using ffmpeg `concat` demuxer (list-file driven) + `amix` + `sidechaincompress` (BGM ducks ~-18 dB under narration).
- `video mix <project> --bgm <path> --bgm-attenuation <db>` verb.
- Pure mechanical ffmpeg pipeline — no AI, no network.

## v0.3.3 — Audio assets (BGM + SFX provider layer)

**Branch:** `feat/v0.3-audio-assets`
**Tags:** `v0.3.3`

- `@video/audio-assets` package with `AudioAssetProvider` interface.
- Two implementations: `MockAudioAssetProvider` (deterministic silent WAV placeholder, offline default) + `FileBasedAudioAssetProvider` (looks up `{tag}.wav` from `--bgm-dir`/`--sfx-dir`, reads optional `{tag}.license.txt`).
- `video audio-asset <project> --bgm <tag> --sfx <tag>` verb writes to `assets/audio-assets/{bgm,sfx}/{tag}.wav` + run record.

## v0.3 — Real AI providers (MiniMax image + video)

**Branch:** `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video`
**Tags:** `v0.3`

- `MiniMaxImageProvider` (`image-01`): powers `video thumbnail --provider minimax` for real AI thumbnails. Surfaces MiniMax envelope errors readably (e.g. 2056 quota, 1004 auth).
- `MiniMaxVideoProvider` (`MiniMax-Hailuo-2.3`, image-to-video): powers `video shorts --provider minimax`. Implements the full async flow: create task → poll until Success → download. Honest envelope-error handling.
- Both providers use `MINIMAX_API_KEY` env var (no API key for the MiniMax Coding Plan path — already set in this dev env).
- `ImageResult.contentType` widened to `"image/png" | "image/jpeg"`; `VideoRequest` extended with `firstFrameImageUrl`.

## v0.2 — Full v0.2 pipeline (8 phases)

**Branch:** `feat/video-agent-v01`
**Tags:** `v0.2`

- VDSL → Remotion → MP4 pipeline
- 10 motion components (Title, Paragraph, CodeBlock, Terminal, Image, FlowChart, Comparison, Timeline, Callout, EndCard)
- Checkpoint state machine + 10 CLI workflow verbs (`new`, `validate`, `status`, `approve`, `reject`, `rollback`, `resume`, `preview`, `final`, etc.)
- 5 LLM-driven agents (Storyboard, Research, Script, Review, YouTube) — all reuse `@video/llm` (MiniMax + GLM providers)
- Edge TTS voiceover (`@video/tts`)
- Benchmark video (`projects/benchmark-v01/`): 6 scenes, 39 seconds, zh-CN explainer about AI chain-of-thought
- §62.4 acceptance automation: 11/11 checks passing
- `bin/video` + `.opencode/command/video.md` for Pi Extension / OpenCode harness integration

## How the tags map to branches

| Tag       | Branch(es)                                                      | Merged in commit(s)                        |
| --------- | --------------------------------------------------------------- | ------------------------------------------ |
| `v0.2`    | `feat/video-agent-v01`                                          | merge commit on main                       |
| `v0.3`    | `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video`          | merge commit on main                       |
| `v0.3.3`  | `feat/v0.3-audio-assets`                                        | merge commit on main                       |
| `v0.3.4`  | `feat/v0.3-audio-mix`                                           | merge commit on main                       |
| `v0.3.5`  | `feat/v0.3-sfx-cues-and-fade`                                   | merge commit on main                       |
| `v0.3.6`  | `fix/v0.3.6-fake-image-default`                                 | merge commit on main                       |
| `v0.3.7`  | `feat/v0.3.7-make-audio-dirs`                                   | merge commit on main                       |
| `v0.3.8`  | `feat/v0.3.8-project-arg-resolution`                            | combined commit tagged `v0.3.9`            |
| `v0.3.9`  | `feat/v0.3.9-draft-merges-audio-plan`                           | merge commit on main                       |
| `v0.3.10` | `feat/v0.3.10-draft-idea-file`                                  | merge commit on main                       |
| `v0.3.11` | `chore/v0.3.11-drop-legacy-traces`                              | merge commit on main                       |
| `v0.5`    | (no separate branch — v0.5 landed on main)                      | `a674437` (+ `d438666` lint config)        |
| `v0.5.1`  | (no separate branch — T5+T6.1 landed on main)                   | `a674437` … (cumulative)                   |
| `v0.5.2`  | (no separate branch — T6.2 + T6.3 + fix landed on main)         | `3da7ff2`, `7d97608`, `638ac88`, `2170a4c` |
| `v0.5.3`  | (no separate branch — flux default + pre-flight landed on main) | TBD in commit message                      |
| `v0.6.0`  | (no separate branch — laya advisory layer landed on main)       | `c3d6691`                                  |
| `v0.7`    | `v0.7-agent-ask`                                                | merge commit on main                       |

All release tags are on `origin` and pushed.

## Versioning convention

- **v0.x.y** — development tags, may be incremented without a strict semver contract.
- **Major bumps (v1.0)** reserved for the first production-ready milestone after GLM image + cloud rendering land.
- Tags are immutable; new work creates a new tag rather than moving an old one.
- **Package manager**: this project uses **pnpm 12.5+** (enforced via the `packageManager` field in `package.json`). The lockfile is `pnpm-lock.yaml`; do not commit `package-lock.json`.
