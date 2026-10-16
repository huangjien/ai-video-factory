---
name: video
description: AI Video Factory — drive the full pipeline from research to rendered MP4 via the `video` CLI
argument-hint: "[video-verb] [video-args...]"
---

# /video — drive the AI Video Factory pipeline

This command runs the `video` CLI under the hood. Every `/video <verb> [args...]`
is forwarded to `video <verb> [args...]` — the `bin/video` shell script in the
repo root makes the call. Pass `$ARGUMENTS` as the verbatim CLI args.

## Minimal API (the recommended path — v0.3.9+)

```
1. /video new "<topic-slug>"        — scaffold projects/<slug>/
2. /video draft "<topic>"           — LLM writes article.md + audio-config.yaml
                                      + derived storyboard.yaml (quality-gated:
                                      judge scores /30, below 25 regenerates w/
                                      feedback, best of 3). --duration defaults
                                      to 180 s. --audience, --style, --file <idea>
                                      to seed, --no-review to skip the gate.
   → HUMAN: read/edit article.md + audio-config.yaml (the two human-edit files)
3. /video approve storyboard <slug> — HUMAN GATE (make refuses to render until
                                      this passes)
4. /video make <slug>               — TTS → BGM/SFX → scene images → render →
                                      mix → output/final-mixed.mp4
```

`video make` steps are idempotent — re-running after editing article.md skips
work whose outputs are newer than its inputs (`--dry-run` previews the plan).

### make flags that matter

| Flag | Meaning |
| --- | --- |
| `--image-provider flux\|minimax\|mock\|none` | **flux is the default** (v0.5.3+): local FLUX.2-klein-4B via the Python sidecar — no key, no quota. One-time: `cd packages/media-generators/python && uv sync && uv run python flux_worker.py --download` (~22 GB). A pre-flight health check fails loud with a fix hint if the service isn't ready. |
| `--reference-style-anchor` | (v0.5.2) generate the anchor scene first, then condition every later scene on it (image-to-image) for visual consistency. `--anchor-scene <N>` picks a later anchor (default 1). Off by default. |
| `--lora-config <path>` / `--lora <spec>` | LoRA adapters; auto-discovers `lora-config.yaml` at `<project>` or repo root (license sidecars enforced when declared). |
| `--music-provider auto\|minimax\|mock` | BGM generation (auto = MiniMax music-01 when `MINIMAX_API_KEY` set, else mock). |
| `--bgm-dir/--sfx-dir <dir>` | use your own audio library instead of generation. |
| `--fake` | offline: silent TTS placeholders + no images (`--image-provider none`). |

Flux env knobs (full table in `packages/media-generators/python/README.md`):
`FLUX2_MODEL` (switch to `…-base-4B` 50-step quality path), `FLUX2_STEPS`,
`FLUX2_TEXT_ENCODER_QUANT` (**int8 default** since v0.5.4 — 40% encoder memory
cut, lossless), `FLUX2_OFFLOAD=full` for 9B, `FLUX2_ALLOW_CONCURRENT=1`
(overrides the one-flux-pipeline-at-a-time lock — two concurrent pipelines
swap-thrash a 24 GB machine).

## Fine-grained verbs (back-compat with pre-minimal projects)

```
research → script → storyboard → approve storyboard (GATE) → audio →
review → approve review (GATE) → final
```

| Verb                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `new <id>`                 | scaffold a project under `projects/<id>/`          |
| `research <topic>`         | AI-gather facts + sources + claims                 |
| `script <topic>`           | AI-draft a 7-section script                        |
| `storyboard <topic>`       | AI-draft a VDSL storyboard                         |
| `audio <project>`          | Synthesize voiceover + captions (Edge TTS via Python sidecar) |
| `audio-asset <project>`    | BGM + SFX generation                               |
| `review <project>`         | Read-only Content/Visual/Technical review          |
| `validate <file>`          | VDSL validation (shape + assets + audio)           |
| `status`                   | per-stage checklist + current checkpoint           |
| `approve [stage]`          | human approve; advances state machine              |
| `reject <reason>`          | record feedback, transition to regenerate          |
| `rollback <checkpoint-id>` | confirm + invalidate downstream stages             |
| `resume`                   | resume from last successful stage                  |
| `preview`                  | render preview.mp4 (gated on approved storyboard; `--force` recorded) |
| `final`                    | render final.mp4 (requires review APPROVED; QA error-level findings block it) |
| `thumbnail <project>`      | YouTube thumbnail (`--provider flux\|minimax`, mock default) |
| `shorts <project>`         | 60s Shorts clip                                    |
| `youtube <project>`        | title/description/chapters/thumbnail-prompt package |

Every step writes `runs/<id>.yaml` and updates `state.yaml`.

## Pitfalls that actually bite

- **`--cwd` semantics differ per verb**: `draft`/`script`/`research`/`audio`/
  `review` take the PARENT (workspace) dir and find `projects/<slug>` under it;
  `approve`/`final` take the project dir itself; `make`/`new` take the parent.
  When in doubt, run from the repo root and pass only the slug.
- **Project slug = directory name**. Chinese works (`video draft 玄武门`) but
  keep the slug stable after scaffolding — the state file records the original
  checkpoint ids.
- **Caption safe area**: scene narration must fit 3 lines × 24 zh units
  (≤72 chars). Longer narrations fail VDSL validation before render — split
  the scene or trim at sentence boundaries.
- **Scene ids drive audio filenames**: TTS writes `scene-1.wav…`; ids like
  `s1` break the mix step.
- **article.md is the source of truth**: `video make` re-derives storyboard.yaml
  every run (id-keyed sync — content edits to article DO propagate when ids
  match; hand edits to storyboard.yaml alone do not survive).

## Critical invariants

- **Never auto-approve** storyboard/script/research drafts — the user must
  read and `video approve` explicitly. Agents are drafting; humans decide.
  The CLI enforces this: `preview`/`make` refuse to render without an approved
  storyboard checkpoint, and re-running a generator over an approved stage
  exits non-zero unless `--force` is passed.
- **Credentials stay in env** — never write `MINIMAX_API_KEY` / `GLM_API_KEY`
  to disk. The grep test in the test suite asserts this.
- **Failure exit code is non-zero** — surface LLM/TTS/render errors
  immediately; do not silently retry past bounded budgets.
- **One flux pipeline at a time** — the provider enforces a lock; never
  `FLUX2_ALLOW_CONCURRENT=1` on this 24 GB machine unless you mean it.
