---
name: video
description: Operate the AI Video Factory monorepo — a pnpm TypeScript pipeline that turns a topic into a 1080p Chinese MP4 via `video draft` and `video make`. Use when the user works in this repo, asks about `video` subcommands, needs to set up the environment, or wants to generate/research/script/storyboard/render/audit/publish a video.
metadata:
  author: local
  source: internal://~/workspace/ai-video-factory
  version: "0.11.1"  # mirrors packages/cli/src/version.ts — the doc reflects the BINARY version, the git/release tag is in docs/RELEASES.md
  last_reviewed: 2026-10-26
  local_only: true
  shipped_versions: [v0.4, v0.5, v0.5.1, v0.5.2, v0.5.3, v0.6, v0.6.0, v0.7, v0.7.1, v0.8, v0.8.1, v0.9, v0.9.1, v0.10, v0.11, v0.11.1]  # mirrors docs/RELEASES.md tag table
---

# AI Video Factory

A pnpm TypeScript monorepo. Two human-edit files (`article.md`, `audio-config.yaml`) drive the pipeline; everything else is derived. Final output is a 1920×1080@30fps MP4 with narration + BGM + SFX.

**Trigger**: load this skill when the user is inside `~/workspace/ai-video-factory` (or any descendant), or mentions `video`, VDSL, storyboard, draft, make, shorts, or YouTube packaging.

## Core principles and decision rules

- `article.md` and `audio-config.yaml` are the human-editable sources. Treat storyboards and render outputs as derived; edit the source and regenerate derived files.
- For end-to-end creation, follow [the project lifecycle](workflows/project-lifecycle.md). Load it when operating commands or handling draft/review/revise.
- If a user asks about visuals, image generation, captions, or rendering behavior, load [rendering and visuals](references/rendering-and-visuals.md).
- For provider selection, package boundaries, or runtime pitfalls, load [CLI and runtime reference](references/cli-and-runtime.md).
- When the CLI or prerequisites fail, load [setup and installation](workflows/setup-and-installation.md), then run its checker.
- Use `--fake` for offline/keyless pipeline checks. Do not claim a command or render succeeded unless it was run and its output inspected.
- Prefer `video draft` and `video make` for the standard create-and-render path; use focused commands only when the requested stage is clear.
- Ask before a paid generation only when an important choice is genuinely unspecified and the ask protocol is available; otherwise honor explicit flags and project frontmatter.
- Never hand-edit derived `storyboard.yaml`; change `article.md` and regenerate it.

## On-demand material

- Procedures: [project lifecycle](workflows/project-lifecycle.md), [setup and installation](workflows/setup-and-installation.md)
- Technical references: [`references/`](references/)
- Executable setup checker: [`scripts/check_setup.sh`](scripts/check_setup.sh)
