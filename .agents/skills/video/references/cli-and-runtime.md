# Cli And Runtime

## 4. Provider flags

- LLM: `--model minimax|glm` (default `glm` for draft, review, youtube; `minimax` for storyboard)
- Image / video: `--image-provider minimax|openai|gemini|mock|none`, `--fake`
  - **v0.8.1+: `minimax` is the default for `video make` and
    `video visuals`** (gated on `!fake`; `mock` stays the default for
    `video thumbnail`). One resolver — `resolveImageProvider` in
    `packages/make/src/index.ts` — serves `video make`, `video
    visuals`, and the `--dry-run` impact table, so all three agree.
  - Three hosted HTTP providers, all returning seconds per scene, each
    needing its own key: `minimax` (`MINIMAX_API_KEY`, model
    `image-01`), `openai` (`OPENAI_API_KEY`), `gemini`
    (`GEMINI_API_KEY`). Each returns its own output size; scenes are
    fitted to the requested 1920×1080 frame at render time.
  - `mock` gives deterministic placeholder images, `none` skips image
    generation entirely.
  - `--fake` always resolves to `none` — scenes stay
    `AnimatedIllustration` (caption + animated SVG).
- TTS: `--fake` (offline placeholder). Real narration backends select per
  project via `article.md` frontmatter: `tts_provider: minimax` + `voice:` =
  MiniMax voice_id — T2A v2, needs `MINIMAX_API_KEY`, and **voice CLONING
  is not on Token Plan keys (error 2061; pay-as-you-go only; clones deleted
  after 7 days idle)**; `tts_provider: voicebox` + `voice:` = Voicebox
  profile name/id (local voicebox-server, `VOICEBOX_URL`, default
  `127.0.0.1:17493`; Qwen3-TTS ~7× slower than realtime on MLX);
  omitted/`edge` → Edge TTS voice id. Unknown values warn + fall back to
  Edge. **`tts_provider: f5tts` (2026-10-25)** — local F5-TTS (MLX)
  zero-shot clone, default `steps=6 + rk4` quality-accepted by the
  operator (RTF 2.16 measured; ~8 min per 20-scene film vs voicebox
  ~17 min; steps=4 midpoint is faster but quality-REJECTED, steps=8
  rk4 accepted but no faster than voicebox). Needs:
  uv venv `~/.venvs/f5tts` (python 3.12, `f5-tts-mlx==0.2.6` PINNED with
  `mlx==0.29.3` — mlx 0.32 breaks `mx.random.normal` inside cfm.sample),
  reference clip `~/.f5tts/narrator-zh-ref.wav` (24 kHz, 10–15 s, cut
  from a shipped voicebox scene so the timbre matches) + transcript
  sidecar `.txt`; `voice:` may point at any other wav (its `.txt` is
  the transcript). Fallback chain: f5tts → voicebox → minimax → edge.
  **Default backend (2026-10-28): MiniMax `speech-2.8-hd`** — the
  quality tier, ~0.2× realtime. An A/B of seven backends on one Chinese
  script ranked it first on both quality and speed; the local F5-TTS
  clone came LAST (a 10–15 s reference cannot carry sentence-level
  intonation, which is what "the voice sounds bad" usually means).
  `MINIMAX_DEFAULT_MODEL` in `packages/tts/src/minimax-tts.ts` is the
  single source; the model joins the TTS cache key, so a tier change
  re-synthesizes instead of replaying the old audio.
  **The backend and the voice id are ONE decision** — a voice id only
  means something to the backend that owns it, and an Edge id handed to
  MiniMax fails at synthesis, not at config time. `resolveNarrationConfig`
  (`packages/cli/src/draft-command.ts`) resolves the pair together:
  `--tts` wins; then a carried `tts_provider:`; then a hand-pinned Edge
  voice id (which implies the Edge backend); then the default
  (`minimax` + `Chinese (Mandarin)_Male_Announcer` for zh-CN /
  `English_expressive_narrator` for en-US). Pre-flight: `video make`
  probes voicebox (2 s) and degrades loudly (voicebox down → minimax
  system voice → edge); `video draft` offers the conditional `tts`
  question only when voicebox answers with cloned profiles (answer via
  `--tts voicebox:<profile>|minimax-system|f5tts|edge`; server down ⇒ no
  question, default minimax-system). Cache key is provider- AND
  model-namespaced; re-drafts reset `voice:` (drafter-owned) but
  preserve `tts_provider:`.
- Web search in research: `--no-web` (LLM knowledge only)

Provider fallback (minimax → glm) is automatic on quota / rate-limit errors.

## 5. Package layout (monorepo)

```
packages/
├── cli               # the `video` command (entry: packages/cli/src/index.ts)
├── draft             # article.md + audio-config.yaml generation
├── script            # narration script generator
├── agent-storyboard  # VDSL storyboard agent
├── audio-plan        # voice/BGM/SFX planning
├── audio-assets      # BGM/SFX generator
├── audio-mix         # mix narration + BGM + SFX
├── tts               # TTS provider abstraction
├── vdsl              # VDSL schema (Zod)
├── video-components  # React/Remotion components
├── video-renderer    # Remotion render pipeline
├── media-generators  # image / video provider abstractions
├── llm               # minimax / glm provider clients
├── make              # make-command orchestrator
├── review            # review agent
├── research          # research agent + MiniMax web search
├── youtube           # YouTube package + thumbnail prompt + shorts hook
└── workflow          # pipeline state machine
```

`pnpm build` at the root compiles every package via `tsc -b`.

## 6. Common pitfalls

- **Keyless smoke run (no API keys needed)**: write `article.md` (frontmatter: project/language/duration_target_sec/voice + `## Scenes` fenced YAML) and an `audio-config.yaml` (`voice: zh-CN-XiaoxiaoNeural`, `bgm: "calm"`, `sfx: {scene_1: whoosh}` — flat keys, not nested objects), then `video approve storyboard <project>` (gate) and `video make <project> --fake`. For deterministic placeholder images without any key, use `--image-provider mock`.
- **`no scene-N.wav files` in mix**: article scene ids must be `scene-1`, `scene-2`, … — TTS names narration WAVs after article ids and mix matches `/^scene[-_]\d+\.wav$/`. Ids like `s1` break the mix step.
- **`video` not found**: symlink `bin/video` into a PATH dir (see §1). Verify with `which video` and `realpath $(which video)`.
- **`Cannot find module '.../packages/cli/dist/index.js'`** — the `video` / `video` wrapper resolved the wrong project root. The bundled `bin/video` uses `realpath $0`, so this only happens with a custom wrapper that uses `dirname $0` or `$(pwd)`. Fix: either rebuild via `pnpm build`, or replace any custom wrapper with `bin/video`.
- **`MINIMAX_API_KEY` missing**: needed for real image / video generation; not needed for `--fake`.
- **`pnpm test` slow**: vitest runs across all packages with coverage. Use `pnpm vitest run packages/<name>` to scope.
- **Render stuck on port**: Remotion needs a free port; check `output/` for crash logs.
- **Render parallelism**: `RENDER_POOL` env (default 2, cap 4) runs scene
  renders in a worker pool, one private Chrome per worker (2026-10-25;
  28-scene benchmark: 419 s → 363 s). Set `RENDER_POOL=1` to restore the
  serial shared-browser path on constrained machines.
- **Storyboard schema mismatch**: `video validate projects/<id>/storyboard/storyboard.yaml --root projects/<id>`.
- **Edge TTS fails**: try `--fake` to confirm pipeline; fall back to a different voice via `audio-config.yaml`.
- **Style consistency across scenes**: sampling drifts ground dominance (warm cream vs cool teal) even inside a locked-palette style. Steer per-scene grounds in the `visual:` line ("on a warm cream ground") when the block must match; regenerate rejects by deleting `scene_N.jpg` + `scene_N.cache.json`. Sketch idioms (whiteboard) render poorly on minimax (thin pen ink, palette drift) — prefer painted styles there, or `--image-provider openai`.
- **Scene-mp4 cache keys on image content (fixed 2026-10-24, P1)**: `imageHash` (sha256 of the compiled data-URI's decoded bytes) is part of scene freshness, so regenerated scene images re-render their scene mp4 automatically; legacy sidecars invalidate once. `video qa`'s `stale-render` warn stays as a backstop. Dry-run parity lives in `impact.ts` via the shared `sceneImageDigest`.
- **en-US drafts need `captions_source: caption`**: narration source overflows the caption safe area and `video make` refuses to render. Add it to `article.md` frontmatter after drafting. Note: patching frontmatter does NOT re-derive an existing storyboard (sync only fires on scene-id changes) — `rm storyboard/storyboard.yaml` to force re-derivation.
- **Long LLM steps: run foreground, retry once**: GLM http2 streams occasionally die mid-draft (`ECONNRESET` ~8min in, unhandled). Backgrounded CLI steps can also be killed silently between harness turns. Re-run the same command in the foreground before switching providers; nothing is written on failure, so retries are clean.
- **Never hand-edit `storyboard/storyboard.yaml`**: `sync-durations` rewrites it in place, and its line edits (inserting `captions.speech_sec`, dropping overrunning animations) are collected against the ORIGINAL line numbers — apply both kinds in ONE descending pass or the drops cut the wrong lines (observed 2026-10-24: a lead-in insert shifted every later index and the storyboard stopped parsing). Change `article.md` and delete the storyboard instead.
- **The CLI runs the built `dist/`**: `pnpm build` after changing a package, or the next `video make` silently uses the old code (this cost a full re-render cycle on 2026-10-24).
- **YouTube chapters: the model names the SCENE, the pipeline names the TIME.** The packager used to ask the model for timestamps, and the model computed them on the article's DECLARED timeline (~295 s) while the film is timed by the MEASURED narration (~221 s) — so the last 20 s fell outside any chapter and the last chapter was one second long. Now a chapter carries `scene: <1-based position>` and `deriveChapterTimestamps` (`packages/cli/src/youtube-command.ts`) turns that into a timestamp on the rendered timeline, with the last chapter ending at the film's duration. If you ever see a chapter contract change, keep the arithmetic on this side: the model names the place, the pipeline measures it.
- **Richer key-info banners without bake.json**: the Pillow overlay picks text by priority — `visual.props.text_overlay` (curated line) → `visual.props.caption` → … → captions text. Set `text_overlay` on a scene's `visual.props` in storyboard.yaml for a stronger banner than the caption; it survives re-derives only if the article's scene content stays consistent (see content-aware sync).
- **Disk usage**: `node_modules`, `output/`, and Remotion caches grow fast; `pnpm store prune` periodically.


## 7. What the draft stage does to the clock

### One run record per model call

`video draft` writes a run record for every model call, as the call happens:

| File | What it records |
|---|---|
| `runs/draft-*.yaml` | the generation call |
| `runs/draft-judge-*.yaml` | the scoring call (often another provider) |
| `runs/draft-audio-plan-*.yaml` | the audio plan call |

Each carries the serving `provider`, the `model`, the `tokens`, a real
`duration_ms` (the other stages used to write `0`), and a `telemetry` block:
`requests`, `streams`, `headers_timeout_retries`, `reasoning_tokens`.

- `headers_timeout_retries > 0` means the client threw a request away and
  re-issued it. It is 0 on a healthy run: `packages/llm/src/http.ts` gives
  the shared undici pool a 40-minute header wait, so a slow completion is
  no longer killed at undici's 300 s default and started over.
  `LLM_HTTP_TIMEOUT_MS` shortens that ceiling.
- `reasoning_tokens` is what the model spent THINKING. The judge asks for
  none (MiniMax-M3 then skips thinking entirely: 31,916 output tokens /
  161 s → 1,692 tokens / 9.5 s for the same scorecard); the draft keeps
  its — without it the article comes out half-length (19 scenes / 215 s
  against a 480 s target).

### The judge is averaged, and the ladder follows the defects

The judge's noise on ONE draft is **±1.9 points** (ten judgments of the
same article: 84.2 / 85.8 / 87.4 / 88.0 / 88.0 / 88.4 / 88.8 / 89.0 /
90.2 / 90.8 — sd 1.85, range 6.6) and the 90-point bar sits inside that
band. So `video draft` judges each draft **twice** and averages
(`--judge-samples <n>`, default 2): the per-indicator scores are averaged,
the findings/comment/suggestions come from the **median** judgment, and
every sample's tokens are counted. Measured: the pair-averages have sd
**1.28** against the single samples' 1.85. `article-review.yaml` records
the spread (`judge_samples`, `judge_sample_scores`) — the score is the
MEAN of those judgments.

The loop's progress test no longer reads the raw score. A revision counts
as progress when **the defect load shrank** (Critical 3, Major 2, Moderate
1, Minor 0.5) **or** the score moved by more than 1.0 point. A revision
that shrank the defects but left the score flat keeps the surgical line
alive instead of being thrown away for a blind rewrite; the blind rewrite
stays as the escape hatch when neither the defects nor the score moved.

### The rubric and the drafter agree

The judge scores against the writer's contract, and the contract is in
the drafter prompt (section 21). Four rules matter when a draft comes
back with findings you cannot act on:

- **A runnable example** — when the article defines a protocol, schema,
  interface or configuration, it must carry one filled-in JSON/YAML
  instance (field names AND types) plus what validation failure does.
  A field LIST is not an example.
- **One name per concept**, and **the narration is not a second copy**:
  a scene that mentions a list or a rule set must match the prose
  exactly — same items, same names, no additions, no omissions.
- **Sources** carry a checkable locator (version, chapter, section or
  official URL); an author-made mapping is marked as the author's.
- **Calibrated claims**: "必然" / "不可能" / "always" are defects only
  when the article's own evidence contradicts them.

The judge's side of the contract is in the review prompt: the ±10%
scene-duration tolerance, the YAML frontmatter as metadata rather than
content, and a `visual:` line judged as an art-direction line rather
than as prose.

The pipeline has its own hard limits, and the drafter is told them:
the burned caption IS the scene narration, so a narration that wraps
past **4 lines of 24 units** (about 90 CJK characters) fails
`video make` with a caption overflow.
