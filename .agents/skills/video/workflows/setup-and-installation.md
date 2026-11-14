# Setup and Installation

## 1. Setup (run first if anything fails)

The repo provides a checker. Run it and act on each line:

```bash
bash ~/.agents/skills/video/scripts/check_setup.sh
```

It checks: Node ≥22, pnpm 12.5+, FFmpeg + ffprobe on PATH, the `video` binary resolvable, and `MINIMAX_API_KEY` set if not using `--fake`. Offer to install what's missing:

| Missing | Fix |
|---|---|
| Node | `brew install node` (mac) or `nvm install 22` |
| pnpm | `corepack enable && corepack prepare pnpm@12.5.1 --activate` |
| FFmpeg | `brew install ffmpeg` (mac) / `apt-get install ffmpeg` (linux) |
| `video` binary | Symlink `bin/video` into a PATH dir: `ln -sf ~/workspace/ai-video-factory/bin/video ~/.local/bin/video`. `bin/video` resolves the symlink via `realpath $0` so it works from any PATH location. |
| API key | export `MINIMAX_API_KEY=…` (or `GLM_API_KEY=…` for the LLM) |

### How `video` resolves

```
video                 ← from PATH (e.g. ~/.local/bin/video)
  └→ symlink to    ~/workspace/ai-video-factory/bin/video
      └→ exec      node ~/workspace/ai-video-factory/packages/cli/dist/index.js "$@"
```

The CLI source lives at `packages/cli/src/index.ts`. After `pnpm build`, the entrypoint is `node packages/cli/dist/index.js`. `bin/video` is a thin bash wrapper that resolves the real script path with `realpath $0` before computing the project root — **without that, calling `video` via a symlink breaks** (the wrapper used to use `dirname $0`, which is the symlink path, not the target).

