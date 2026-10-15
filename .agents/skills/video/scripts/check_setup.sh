#!/usr/bin/env bash
# check_setup.sh — verify that the AI Video Factory prerequisites are met.
# Usage: bash check_setup.sh [--repo PATH] [--strict]
#
# Exit codes:
#   0 = everything OK
#   1 = one or more optional checks failed (env vars, etc.)
#   2 = one or more required checks failed (Node, pnpm, ffmpeg, video binary)

set -uo pipefail

REPO="${REPO:-$(pwd)}"
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1
[[ "${1:-}" == "--repo" ]] && REPO="${2:-$(pwd)}"

PASS=0
WARN=0
FAIL=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
hdr()  { printf "\n\033[1m%s\033[0m\n" "$1"; }

# ─── 1. Node ────────────────────────────────────────────────────────────────
hdr "Node.js"
if command -v node >/dev/null 2>&1; then
    ver=$(node --version | sed 's/^v//')
    major=${ver%%.*}
    if (( major >= 22 )); then
        ok "node $ver (>= 22 required)"
    else
        fail "node $ver — too old (need >= 22). Install: brew install node OR nvm install 22"
    fi
else
    fail "node not found on PATH. Install: brew install node OR nvm install 22"
fi

# ─── 2. pnpm ────────────────────────────────────────────────────────────────
hdr "pnpm"
if command -v pnpm >/dev/null 2>&1; then
    ver=$(pnpm --version)
    # pnpm 12.5+ is required; print major.minor
    if [[ "$ver" == 12.5* ]] || [[ "$ver" > "12.5" ]]; then
        ok "pnpm $ver (>= 12.5 required)"
    else
        warn "pnpm $ver — older than recommended 12.5+; some workspaces may misbehave"
    fi
else
    fail "pnpm not found. Install via corepack: corepack enable && corepack prepare pnpm@12.5.1 --activate"
fi

# ─── 3. FFmpeg + ffprobe ────────────────────────────────────────────────────
hdr "FFmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
    ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f1-3)"
else
    fail "ffmpeg not found. Install: brew install ffmpeg (mac) OR apt-get install ffmpeg (linux)"
fi
if command -v ffprobe >/dev/null 2>&1; then
    ok "ffprobe present"
else
    fail "ffprobe not found (ships with ffmpeg)"
fi

# ─── 4. video binary ───────────────────────────────────────────────────────────
hdr "video CLI"
video_path=""
if command -v video >/dev/null 2>&1; then
    video_path="$(command -v video)"
    ok "video on PATH: $video_path"
elif [[ -f "$REPO/packages/cli/dist/index.js" ]]; then
    warn "video not on PATH, but entrypoint found: $REPO/packages/cli/dist/index.js"
    warn "  → add bin/video to PATH or invoke as 'node $REPO/packages/cli/dist/index.js'"
    video_path="$REPO/packages/cli/dist/index.js"
else
    fail "video binary not found. Run 'pnpm install && pnpm build' in $REPO"
fi

# Test the entrypoint actually runs
if [[ -n "$video_path" ]]; then
    if "$video_path" --help >/dev/null 2>&1; then
        ok "video responds to --help"
    else
        fail "video found at $video_path but exits non-zero on --help; check node version / build artifacts"
    fi
fi

# ─── 5. API keys ────────────────────────────────────────────────────────────
hdr "API keys"
if [[ -n "${MINIMAX_API_KEY:-}" ]]; then
    masked="${MINIMAX_API_KEY:0:4}…${MINIMAX_API_KEY: -4}"
    ok "MINIMAX_API_KEY set ($masked)"
else
    if [[ "$STRICT" == "1" ]]; then
        fail "MINIMAX_API_KEY not set (required for real image / video generation). Get one from https://api.minimax.io"
    else
        warn "MINIMAX_API_KEY not set — fine for --fake mode; required for real generation"
    fi
fi
if [[ -n "${GLM_API_KEY:-}" ]]; then
    masked="${GLM_API_KEY:0:4}…${GLM_API_KEY: -4}"
    ok "GLM_API_KEY set ($masked)"
else
    warn "GLM_API_KEY not set — LLM calls will fall back to MiniMax (or fail if neither is set)"
fi

# ─── 6. Repo sanity (only if REPO looks like the monorepo) ─────────────────
hdr "Repo"
if [[ -f "$REPO/pnpm-workspace.yaml" ]] || { [[ -f "$REPO/package.json" ]] && grep -q '"workspaces"' "$REPO/package.json" 2>/dev/null; }; then
    ok "$REPO is a pnpm workspace"
    if [[ -d "$REPO/node_modules" ]]; then
        ok "node_modules present"
    else
        warn "node_modules missing — run: pnpm install (in $REPO)"
    fi
    if [[ -d "$REPO/packages/cli/dist" ]]; then
        ok "cli build artifacts present"
    else
        warn "cli not built — run: pnpm build (in $REPO)"
    fi
else
    warn "$REPO doesn't look like the AI Video Factory monorepo (no pnpm-workspace.yaml). Run from the repo root."
fi

# ─── Summary ───────────────────────────────────────────────────────────────
hdr "Summary"
printf "  \033[32m%d passed\033[0m · \033[33m%d warned\033[0m · \033[31m%d failed\033[0m\n" "$PASS" "$WARN" "$FAIL"

if (( FAIL > 0 )); then
    echo
    echo "Required tools missing — fix the red ✗ items above before running video."
    exit 2
fi
if (( WARN > 0 )) && [[ "$STRICT" == "1" ]]; then
    echo
    echo "Strict mode: warnings also block. Re-run without --strict to allow them."
    exit 1
fi
exit 0
