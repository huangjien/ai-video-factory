# FLUX.2 Klein 4B worker

Local image generation for `@video/media-generators`. Runs Black Forest
Labs' **FLUX.2-klein-4B** (Apache-2.0, step-distilled) through Hugging
Face `diffusers` on Apple Silicon MPS, with LoRA adapter support and
Pillow post-processing. No API key, no quota, no network after the
one-time weight download.

```
TypeScript FluxKleinImageProvider   (../src/flux-image.ts)
        │  spawns once per render, JSON over stdio
        ▼
uv run python flux_worker.py        (this directory)
        │  diffusers Flux2KleinPipeline, warm across all scenes
        ▼
JPEG files in a session temp dir → read + unlinked by the provider
```

## Setup

```bash
cd packages/media-generators/python
uv sync                                            # venv + deps (torch, diffusers, peft, pillow …)
uv run python flux_worker.py --check               # verify imports + MPS
uv run python flux_worker.py --check-model black-forest-labs/FLUX.2-klein-4B
                                                  # peek at a checkpoint's is_distilled + worker defaults (no safetensors downloaded)
uv run python flux_worker.py --download            # ~22 GB → ../../../models/hf/
```

`uv` handles everything (it manages its own Python 3.12 — see
`.python-version`). Weights land in `<repo>/models/hf/` which is
gitignored. The one-time download needs no HF token: klein-4B is ungated.

## Use via the pipeline

```bash
video make <project> --image-provider flux          # scene visuals at 1920×1080
video thumbnail <project> --provider flux           # 1280×720 thumbnails
# Both auto-resolve a lora-config.yaml from <projectRoot> then <repoRoot>
# (see the LoRA section below). Override with --lora-config <path>.

# Push 9B + LoRA under the 24 GB ceiling on M4:
FLUX2_OFFLOAD=full FLUX2_TEXT_ENCODER_QUANT=int8 video make big-project --image-provider flux
```

Standalone smoke (JSON line on stdin, response line on stdout):

```bash
printf '{"id":1,"prompt":"a red cube on snow","width":832,"height":480,"steps":8,"seed":42}\n' \
  | FLUX2_HF_HOME="$(git rev-parse --show-toplevel)/models/hf" uv run python flux_worker.py --out-dir /tmp/out

# Always set FLUX2_HF_HOME for standalone runs. Without it the worker
# writes to the global ~/.cache/huggingface and silently re-downloads
# the full ~15 GB of weights as a second copy.
```

**Picking a model.** The worker auto-detects `is_distilled` from each
checkpoint's `model_index.json` and chooses its steps/guidance defaults
accordingly — so `FLUX2_MODEL=black-forest-labs/FLUX.2-klein-base-4B`
flips the worker to the slower 50-step quality path with guidance
honored, no code change required. Inspect any checkpoint before
downloading with `--check-model`:

```bash
uv run python flux_worker.py --check-model black-forest-labs/FLUX.2-klein-base-4B
# {
#   "repo_id": "black-forest-labs/FLUX.2-klein-base-4B",
#   "is_distilled": false,
#   "default_steps_with_worker": 50,
#   "guidance_honored": true,
#   ...
# }
```

Doc §T6.1.

Reference timing (M4 / 24 GB, bf16): pipeline load ≈ 28 s, first image
≈ 81 s (includes one-time MPS shader warmup), scene-size images ≈ 1–3 min
each. The worker stays warm across a whole render — per-image cost is
generation only.

## LoRA

Two surfaces, both apply adapters once at startup so the pipeline stays
warm. Scales are applied via `set_adapters`.

**Checked-in `lora-config.yaml` (preferred)** — humans declare the
project's style and licensing in a file the agents can see:

```bash
# projects/<id>/lora-config.yaml  (or <repo>/lora-config.yaml)
loras:
  - source: loras/ink-style.safetensors    # rel to config dir, absolute, or HF id
    scale: 0.8
    license: loras/ink-style.license.txt   # enforced when declared
```

The worker reads it via the `FLUX2_LORA_CONFIG` env (set automatically
by `video make --image-provider flux` when the file is present). Source
resolution distinguishes HF repo ids from local files by extension
(`.safetensors` / `.bin` / `.pt` / `.gguf` / `.ckpt` → local).

**One-shot env override** — `FLUX2_LORA="path[:scale][,…]"` for quick
experiments (no project file touched). Useful for CI / ad-hoc styles.

Full schema, precedence, and license-sidecar rules:
`packages/media-generators/src/lora-config.ts` and
`docs/v0.5-local-image-generation-plan.md` §T5.

## Environment knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLUX2_MODEL` | `black-forest-labs/FLUX.2-klein-4B` | any `Flux2KleinPipeline` checkpoint. The 4B is step-distilled (8 steps, guidance ignored); `…-klein-base-4B` is the 50-step quality path with guidance honored. `--check-model <id>` reports which you're looking at. |
| `FLUX2_STEPS` | 8 (distilled) / 50 (base) | denoising steps |
| `FLUX2_GUIDANCE` | 4.0 | ignored by distilled variants |
| `FLUX2_DEVICE` | `auto` | `auto` → MPS when available, else CPU |
| `FLUX2_DTYPE` | `bfloat16` on MPS | `bfloat16` / `float16` / `float32` |
| `FLUX2_OFFLOAD` | `auto` | MPS group-offload: `auto` streams the text encoder, `full` also block-offloads the transformer (9B models), `off` disables |
| `FLUX2_TEXT_ENCODER_QUANT` | `int8` (since v0.5.4) | `int8` quantizes the Qwen3 text encoder's `nn.Linear` weights (40% memory reduction on MPS, no measurable diffusion quality loss). `off` keeps bf16. The int8 default keeps a single pipeline well under the 24 GB ceiling; two *unquantized* concurrent pipelines swap-thrash the machine — the TS provider also takes a single-flight lock (bypass: `FLUX2_ALLOW_CONCURRENT=1`). |
| `FLUX2_LORA` | — | adapter[:scale] entries, comma-separated (legacy one-shot) |
| `FLUX2_LORA_CONFIG` | — | absolute path to a `lora-config.yaml` (overrides `FLUX2_LORA` when set) |
| `FLUX2_HF_HOME` | `<repo>/models/hf` (set by the TS provider) | HF cache root |

## Protocol

One JSON object per line. Requests carry `id / prompt / width / height /
steps / guidance / seed / format`; the optional `referenceImage` field
(v0.5.2, T6.2) is an absolute path to a PNG/JPEG that conditions the
generation (`Flux2KleinPipeline(image=...)`). Responses echo `id` with
either `{ok: true, file, width, height, seed, ms}` or `{ok: false, error}`.
A `{"event": "ready", …}` line is emitted once the pipeline is loaded.
The worker exits cleanly when stdin closes. Dimensions are snapped up to
multiples of 16 (FLUX.2 VAE alignment) and the decoded image is fitted
to the exact requested box with Pillow.

The make pipeline opts into image-to-image via
`video make --image-provider flux --reference-style-anchor` (off by
default): scene 1 is generated first, then every subsequent scene
conditions on that image. Use this for visual consistency across a
video; leave it off when each scene should look independent.

`--selftest` serves deterministic hash-derived gradient JPEGs through the
same protocol without loading torch — it is what the TypeScript tests run
against, and `FAIL:`-prefixed prompts inject errors for the failure-path
tests.
