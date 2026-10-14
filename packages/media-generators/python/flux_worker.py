#!/usr/bin/env python3
"""FLUX.2 Klein 4B local image worker for @video/media-generators.

Speaks a line-delimited JSON protocol on stdin/stdout so the TypeScript
FluxKleinImageProvider can keep ONE warm pipeline alive across a whole
`video make` run (model load dominates per-image cost otherwise).

Modes:
  (default)   daemon: load the pipeline, serve JSONL jobs until stdin EOF
  --selftest  same protocol with mock Pillow images only (no torch model)
  --check     verify the environment (imports + device) and exit
  --download  prefetch model weights into the HF cache and exit
  --check-model REPO_ID  fetch only the small config files (no safetensors)
                  and report is_distilled + the steps/guidance defaults the
                  worker would pick. Doc §T6.1.

Protocol (one JSON object per line, responses on stdout, logs on stderr):
  request : {"id":1,"prompt":"...","width":1920,"height":1080,
             "steps":8,"guidance":4.0,"seed":123,"format":"jpg"}
  response: {"id":1,"ok":true,"file":"/tmp/.../00000001_123.jpg",
             "width":1920,"height":1080,"seed":123,"ms":4521.0}
  error   : {"id":1,"ok":false,"error":"..."}
  event   : {"event":"ready","model":"...","device":"mps",
             "dtype":"bfloat16","distilled":true,"lora":[...],
             "text_encoder_quant":"int8(1,234,567,890→int8)"}

LoRA (applied once at startup so the pipeline stays warm):
  FLUX2_LORA="loras/ink-style.safetensors:0.8,other-adapter"   # scale defaults to 1.0
  Entries may be local .safetensors files, local directories (single
  *.safetensors), or Hugging Face repo ids — anything diffusers
  `load_lora_weights` accepts. Scales are applied via `set_adapters`.

Environment knobs (read at startup):
  FLUX2_MODEL     default black-forest-labs/FLUX.2-klein-4B
  FLUX2_STEPS     default 8 (distilled) / 50 (base)
  FLUX2_GUIDANCE  default 4.0 (ignored by distilled variants)
  FLUX2_DEVICE    auto | mps | cpu   (default auto)
  FLUX2_DTYPE     bfloat16 | float16 | float32 (default bfloat16 on mps)
  FLUX2_OFFLOAD   auto | full | off — MPS group-offload strategy
                  (auto: text encoder streams via group offloading;
                   full: also block-offload the transformer; off: none)
  FLUX2_TEXT_ENCODER_QUANT
                  off | int8 — int8 weight-only quant on the text encoder
                  (Qwen3-4B: 8.1 GB → 4.9 GB on MPS, no quality loss).
                  int4 needs Apple's private mslk framework and is not
                  wired up. Doc §T6.3.
  FLUX2_LORA      comma-separated adapter[:scale] entries
  FLUX2_LORA_CONFIG  absolute path to a lora-config.yaml (overrides
                    FLUX2_LORA when set; sources resolve relative to the
                    config file's directory)
  FLUX2_HF_HOME   HF cache root (set before hub import)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

# Silence the huggingface_hub "unauthenticated requests" warning on first
# call. The worker only needs the hub to download; subsequent runs are cached.
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

DEFAULT_MODEL = "black-forest-labs/FLUX.2-klein-4B"
# FLUX.2 VAE works on 16px-aligned latents; requests are snapped up to a
# multiple of VAE_ALIGN and the decoded image is then fitted to the exact
# requested box with Pillow.
VAE_ALIGN = 16
JPEG_QUALITY = 92


def log(msg: str) -> None:
    sys.stderr.write(f"[flux-worker {time.strftime('%H:%M:%S')}] {msg}\n")
    sys.stderr.flush()


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _apply_hf_home() -> None:
    hf_home = os.environ.get("FLUX2_HF_HOME")
    if hf_home:
        os.environ["HF_HOME"] = hf_home


def parse_lora_env(raw: str | None) -> list[tuple[str, float]]:
    """Parse "path[:scale][,path2[:scale2]]" into (source, scale) pairs."""
    if not raw or not raw.strip():
        return []
    entries: list[tuple[str, float]] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        source, sep, scale_s = part.rpartition(":")
        # Windows-ish paths and plain names without scale land here whole
        if not sep or not source:
            source, scale_s = part, ""
        try:
            scale = float(scale_s) if scale_s else 1.0
        except ValueError:
            scale = 1.0
        entries.append((source, scale))
    return entries


_HF_REPO_RE = __import__("re").compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
_LOCAL_EXT_RE = __import__("re").compile(r"\.(?:safetensors|bin|pt|gguf|ckpt)$", __import__("re").IGNORECASE)


def _is_hf_repo_id(source: str) -> bool:
    if source.startswith(("/", "./", "../")):
        return False
    base = source.rsplit("/", 1)[-1]
    if _LOCAL_EXT_RE.search(base):
        return False
    return bool(_HF_REPO_RE.match(source))


def parse_lora_config(path: str) -> list[tuple[str, float]]:
    """Load a lora-config.yaml and return [(source, scale), …] resolved
    against the config file's directory. HF repo ids are passed through
    unchanged. When FLUX2_LORA_CONFIG is set, this takes priority over
    FLUX2_LORA."""
    import yaml  # pyyaml ships transitively with diffusers / huggingface_hub

    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    loras = raw.get("loras") or []
    if not isinstance(loras, list):
        raise ValueError(f"lora-config.yaml: 'loras' must be a list ({path})")
    config_dir = os.path.dirname(os.path.abspath(path))
    out: list[tuple[str, float]] = []
    for i, entry in enumerate(loras):
        if not isinstance(entry, dict):
            raise ValueError(
                f"lora-config.yaml: loras[{i}] must be an object ({path})"
            )
        source = entry.get("source")
        if not isinstance(source, str) or not source:
            raise ValueError(
                f"lora-config.yaml: loras[{i}].source required ({path})"
            )
        scale_raw = entry.get("scale", 1.0)
        try:
            scale = float(scale_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"lora-config.yaml: loras[{i}].scale must be a number ({path})"
            ) from exc
        if _is_hf_repo_id(source):
            out.append((source, scale))
        else:
            out.append((os.path.abspath(os.path.join(config_dir, source)), scale))
    return out


def snap_up(value: int, align: int = VAE_ALIGN) -> int:
    return ((value + align - 1) // align) * align


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
    except Exception:  # pragma: no cover - torch missing in selftest path
        pass
    return "cpu"


def pick_dtype(requested: str | None, device: str) -> str:
    if requested:
        return requested
    return "bfloat16" if device == "mps" else "float32"


def load_lora(pipe, entries: list[tuple[str, float]]) -> list[str]:
    """Load adapters at startup; scales via set_adapters (doc §peft)."""
    loaded: list[str] = []
    names: list[str] = []
    weights: list[float] = []
    for i, (source, scale) in enumerate(entries):
        kwargs: dict = {}
        if os.path.isdir(source):
            safetensors = sorted(
                f for f in os.listdir(source) if f.endswith(".safetensors")
            )
            if len(safetensors) == 1:
                kwargs["weight_name"] = safetensors[0]
        pipe.load_lora_weights(source, adapter_name=f"lora-{i}", **kwargs)
        names.append(f"lora-{i}")
        weights.append(scale)
        loaded.append(f"{source}:{scale:g}")
    if names:
        pipe.set_adapters(names, weights)
    return loaded


def build_selftest_image(prompt: str, width: int, height: int):
    """Deterministic mock image from the prompt hash — no torch involved."""
    from PIL import Image

    digest = hashlib.sha256(prompt.encode("utf-8")).digest()
    left = tuple(int(c) for c in digest[0:3])
    right = tuple(int(c) for c in digest[3:6])
    strip = Image.new("RGB", (2, 1))
    strip.putpixel((0, 0), left)
    strip.putpixel((1, 0), right)
    return strip.resize((width, height), Image.Resampling.BILINEAR)


def run_check_model(repo_id: str) -> int:
    """Fetch only the small config files (no safetensors) and report the
    bits the worker reads at startup so users can pick a model without
    downloading it. Doc §T6.1."""
    from huggingface_hub import hf_hub_download

    try:
        idx_path = hf_hub_download(repo_id=repo_id, filename="model_index.json")
    except Exception as exc:
        print(json.dumps({"repo_id": repo_id, "error": str(exc)[:400]}))
        return 1
    with open(idx_path, "r", encoding="utf-8") as fh:
        idx = json.load(fh)

    is_distilled = bool(idx.get("is_distilled"))
    transformer = idx.get("transformer")
    transformer_class = transformer[0] if isinstance(transformer, list) and transformer else None
    print(
        json.dumps(
            {
                "repo_id": repo_id,
                "transformer_class": transformer_class,
                "is_distilled": is_distilled,
                "default_steps_with_worker": 8 if is_distilled else 50,
                "guidance_honored": not is_distilled,
                "cache_path": idx_path,
            },
            indent=2,
        )
    )
    return 0


def run_check() -> int:
    _apply_hf_home()
    report: dict = {"model": os.environ.get("FLUX2_MODEL", DEFAULT_MODEL)}
    try:
        import diffusers  # noqa: F401
        import peft
        import PIL
        import torch
        import transformers

        report.update(
            torch=torch.__version__,
            diffusers=diffusers.__version__,
            transformers=transformers.__version__,
            peft=peft.__version__,
            pillow=PIL.__version__,
            mps=bool(torch.backends.mps.is_available()),
            device=pick_device(os.environ.get("FLUX2_DEVICE", "auto")),
        )
        print(json.dumps(report, indent=2))
        return 0
    except ImportError as exc:
        report["error"] = f"import failed: {exc}"
        print(json.dumps(report, indent=2))
        return 1


def run_download() -> int:
    _apply_hf_home()
    from huggingface_hub import snapshot_download

    model = os.environ.get("FLUX2_MODEL", DEFAULT_MODEL)
    path = snapshot_download(repo_id=model)
    print(json.dumps({"model": model, "cache_path": path}, indent=2))
    return 0


def quantize_text_encoder(pipe, mode: str) -> str:
    """Apply weight-only quantization to the text encoder. Doc §T6.3.

    Verified on M4 / 24 GB with the Qwen3-4B text encoder
    (hidden 2560, 36 layers): int8 reduces encoder memory ~40%
    (8.11 GB → 4.85 GB) with no measurable diffusion quality loss
    and ~0.2 s of one-time quant time. int4 needs Apple's private
    mslk framework and is not distributable today, so it is not
    wired up. Returns a short tag the ready event surfaces.
    """
    if mode == "off" or not mode:
        return "off"
    if mode != "int8":
        raise ValueError(
            f"FLUX2_TEXT_ENCODER_QUANT={mode!r} is not supported "
            "(only 'int8' and 'off')"
        )
    import torch
    from torchao.quantization import Int8WeightOnlyConfig, quantize_

    def only_linears(mod, _full_name):
        return isinstance(mod, torch.nn.Linear)

    before_params = sum(p.numel() for p in pipe.text_encoder.parameters())
    quantize_(pipe.text_encoder, Int8WeightOnlyConfig(), filter_fn=only_linears)
    return f"int8({before_params:,}→int8)"


def apply_memory_strategy(pipe, device: str, offload_mode: str) -> None:
    """Keep peak unified-memory usage sane on Apple Silicon.

    22 GB of bf16 weights cannot all stay resident next to macOS on a
    24 GB machine, so the text encoder streams its layers between CPU
    RAM and MPS via diffusers group offloading. On unified memory the
    "transfer" is same-RAM pointer work, so this costs almost nothing
    while halving peak footprint. FLUX2_OFFLOAD=off disables;
    FLUX2_OFFLOAD=full also block-offloads the transformer (for 9B
    variants on small machines).
    """
    if device != "mps" or offload_mode == "off":
        pipe.to(device)
        return
    import torch
    from diffusers.hooks import apply_group_offloading

    cpu = torch.device("cpu")
    mps = torch.device(device)
    apply_group_offloading(
        pipe.text_encoder,
        offload_type="leaf_level",
        offload_device=cpu,
        onload_device=mps,
    )
    if offload_mode == "full":
        apply_group_offloading(
            pipe.transformer,
            offload_type="block_level",
            offload_device=cpu,
            onload_device=mps,
        )
    else:
        pipe.transformer.to(mps)
    pipe.vae.to(mps)


def run_daemon(out_dir: str, selftest: bool) -> int:
    _apply_hf_home()
    os.makedirs(out_dir, exist_ok=True)

    model = os.environ.get("FLUX2_MODEL", DEFAULT_MODEL)
    device = pick_device(os.environ.get("FLUX2_DEVICE", "auto"))
    dtype_name = pick_dtype(os.environ.get("FLUX2_DTYPE"), device)
    env_steps = os.environ.get("FLUX2_STEPS")
    env_guidance = os.environ.get("FLUX2_GUIDANCE")
    lora_env = os.environ.get("FLUX2_LORA")
    lora_config = os.environ.get("FLUX2_LORA_CONFIG")
    if lora_config:
        log(f"loading lora config: {lora_config}")
        lora_entries = parse_lora_config(lora_config)
    else:
        lora_entries = parse_lora_env(lora_env)

    pipe = None
    distilled = False
    quant_tag = os.environ.get("FLUX2_TEXT_ENCODER_QUANT", "off")
    if selftest:
        log("selftest mode — torch model NOT loaded, mock images only")
        if lora_entries:
            log(
                "selftest lora entries (config parsed, load_lora_weights skipped): "
                + ", ".join(f"{s}:{w:g}" for s, w in lora_entries)
            )
    else:
        import torch
        from diffusers import Flux2KleinPipeline

        dtype = getattr(torch, dtype_name)
        log(f"loading {model} on {device} ({dtype_name}) …")
        t0 = time.time()
        pipe = Flux2KleinPipeline.from_pretrained(model, torch_dtype=dtype)
        quant_tag = quantize_text_encoder(pipe, quant_tag)
        offload_mode = os.environ.get("FLUX2_OFFLOAD", "auto")
        apply_memory_strategy(pipe, device, offload_mode)
        pipe.set_progress_bar_config(disable=True)
        for vae_hook in ("enable_tiling", "enable_slicing"):
            try:
                getattr(pipe.vae, vae_hook)()
            except (AttributeError, NotImplementedError):
                pass
        distilled = bool(getattr(pipe.config, "is_distilled", False))
        loaded = load_lora(pipe, lora_entries)
        log(f"pipeline ready in {time.time() - t0:.1f}s (distilled={distilled}, text_encoder_quant={quant_tag})")
        if loaded:
            log(f"lora adapters: {loaded}")

    default_steps = 8 if distilled else 50
    if env_steps:
        default_steps = int(env_steps)
    default_guidance = float(env_guidance) if env_guidance else 4.0

    emit(
        {
            "event": "ready",
            "model": "selftest" if selftest else model,
            "device": "selftest" if selftest else device,
            "dtype": dtype_name,
            "distilled": distilled,
            "lora": [f"{s}:{w:g}" for s, w in lora_entries],
            "text_encoder_quant": quant_tag,
        }
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"id": -1, "ok": False, "error": f"bad request json: {exc}"})
            continue

        jid = job.get("id", -1)
        t0 = time.time()
        try:
            prompt = str(job.get("prompt", "")).strip()
            if not prompt:
                raise ValueError("prompt must be a non-empty string")
            if selftest and prompt.startswith("FAIL:"):
                # Deterministic error injection so the TypeScript protocol
                # tests can exercise the failure path without a model.
                raise ValueError(prompt[5:].strip() or "injected failure")
            width = max(64, int(job.get("width", 1024)))
            height = max(64, int(job.get("height", 1024)))
            steps = int(job.get("steps", default_steps))
            guidance = float(job.get("guidance", default_guidance))
            fmt = job.get("format", "jpg")
            if fmt not in ("jpg", "png"):
                raise ValueError(f"unsupported format: {fmt}")

            seed = job.get("seed")
            if seed is None:
                try:
                    import random

                    seed = random.randrange(2**31 - 1)
                except Exception:
                    seed = 0
            seed = int(seed)

            gen_w, gen_h = snap_up(width), snap_up(height)
            if selftest:
                image = build_selftest_image(prompt, gen_w, gen_h)
            else:
                import torch
                from PIL import Image as PILImage
                from PIL import ImageOps

                kwargs: dict = {
                    "prompt": prompt,
                    "width": gen_w,
                    "height": gen_h,
                    "num_inference_steps": steps,
                    "generator": torch.Generator(device=device).manual_seed(
                        seed
                    ),
                }
                if not distilled:
                    kwargs["guidance_scale"] = guidance
                image = pipe(**kwargs).images[0]
                # Fit the VAE-aligned canvas onto the exact requested box.
                image = ImageOps.fit(
                    image,
                    (width, height),
                    method=PILImage.Resampling.LANCZOS,
                )

            ext = "jpg" if fmt == "jpg" else "png"
            out_path = os.path.join(out_dir, f"{jid:08d}_{seed}.{ext}")
            if fmt == "jpg":
                image.save(out_path, format="JPEG", quality=JPEG_QUALITY)
            else:
                image.save(out_path, format="PNG")
            emit(
                {
                    "id": jid,
                    "ok": True,
                    "file": out_path,
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "ms": round((time.time() - t0) * 1000, 1),
                }
            )
        except Exception as exc:  # noqa: BLE001 - per-job isolation
            log(f"job {jid} failed: {exc}")
            emit({"id": jid, "ok": False, "error": str(exc)[:500]})

    log("stdin closed — worker exiting")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--out-dir", help="directory for generated images")
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="serve mock Pillow images without loading the model",
    )
    parser.add_argument(
        "--check", action="store_true", help="verify environment and exit"
    )
    parser.add_argument(
        "--download", action="store_true", help="prefetch weights and exit"
    )
    parser.add_argument(
        "--check-model",
        metavar="REPO_ID",
        help="fetch model_index.json + transformer config and report is_distilled (no safetensors)",
    )
    args = parser.parse_args()

    if args.check:
        return run_check()
    if args.download:
        return run_download()
    if args.check_model:
        return run_check_model(args.check_model)
    out_dir = args.out_dir or os.curdir
    return run_daemon(out_dir, selftest=args.selftest)


if __name__ == "__main__":
    raise SystemExit(main())
