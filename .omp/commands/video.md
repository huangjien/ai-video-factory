---
name: video
description: AI Video Factory — drive the full pipeline from research to rendered MP4 via the `video` CLI
argument-hint: "[video-verb] [video-args...]"
---

# /video — drive the AI Video Factory pipeline

This command runs the `video` CLI. Every `/video <verb> [args...]` is
forwarded to `video <verb> [args...]` — the `bin/video` shell script in the
repo root makes the shell call. Use the slash form to invoke a
verb; pass `$ARGUMENTS` as the verbatim CLI args.

```bash
/video new "demo"
/video draft "AI 思维链"
/video approve storyboard --cwd projects/demo
/video make "demo"
/video retrospect demo
/video status demo
```

## Pipeline (call in this order)

```
1.  /video new "<topic-slug>"                 — scaffold projects/<slug>/
2.  /video research "<topic>"                 — drafts research/{research.md, sources.yaml, claims.yaml}
3.  /video script "<topic>" \
        --from-research projects/<slug>/research  — drafts script/script.zh-CN.md
4.  /video storyboard "<topic>" \
        --from-research projects/<slug>/research \
        --from-script projects/<slug>/script/script.zh-CN.md   — drafts storyboard.yaml
5.  /video approve storyboard --cwd projects/<slug>   — HUMAN GATE
6.  /video audio "<slug>"                     — synth per-scene WAVs + captions SRT
7.  /video review "<slug>"                     — review YAMLs
8.  /video preview --cwd projects/<slug>        — renders preview.mp4
9.  /video approve review --cwd projects/<slug> — human gate
11. /video final --cwd projects/<slug>          — renders final.mp4 (QA-gated)
12. /video thumbnail "<slug>" --provider minimax
13. /video shorts "<slug>" --provider minimax
14. /video youtube "<slug>"
```

## Verbs (one line each)

| Verb                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `new <id>`                 | scaffold a project under `projects/<id>/`          |
| `research <topic>`         | (v0.2.2) AI-gather facts + sources + claims        |
| `script <topic>`           | (v0.2.3) AI-draft a 7-section script               |
| `storyboard <topic>`       | (v0.2.1) AI-draft a VDSL storyboard                |
| `audio <project>`           | (v0.2.4) Synthesize voiceover + captions           |
| `audio-plan <project>`     | regenerate audio-config.yaml from current article  |
| `audio-asset <project>`    | materialise BGM/SFX files into `assets/audio-assets/` |
| `mix <project>`            | mix narration + BGM + SFX into final-mixed.mp4    |
| `review <project>`         | (v0.2.5) Content/Visual/Technical review YAMLs     |
| `draft <topic>`            | **v0.3** write article.md + audio-config.yaml + storyboard.yaml in one call |
| `make <project>`           | **v0.3** TTS → assets → render → mix (--dry-run, --fake, --image-provider mock\|minimax\|none) |
| `retrospect <project>`     | **v0.4** read last few runs + QA, write 3 article.md edits |
| `status`                   | per-stage checklist + current checkpoint + QA finding |
| `approve [stage]`          | human approve; advances state machine              |
| `reject <reason>`          | record feedback, transition to regenerate          |
| `rollback <checkpoint-id>` | confirm + invalidate downstream stages             |
| `resume`                   | resume from last successful stage                  |
| `reset [to-stage]`         | rewind the state machine (with `--force` for FINAL_APPROVED) |
| `validate <file>`          | VDSL validation (shape + assets + audio)           |
| `preview`                  | render preview.mp4 (refuses until `approve storyboard` passes; `--force` bypasses and is recorded) |
| `qa <project>`             | rebuild QA render report; exits non-zero on error-level findings |
| `final`                    | render final.mp4 (requires review APPROVED; QA-gated — error-level findings block it, `--force` bypasses) |
| `studio <project>`         | open Remotion Studio live preview                  |
| `youtube <project>`        | write title.txt / description.md / thumbnail-prompt.txt / shorts-hook.txt / chapters.vtt |
| `thumbnail <project>`      | render `youtube/thumbnail.{png,jpg}` (mock default; `--provider minimax` for real AI) |
| `shorts <project>`         | render `yaml/shorts.mp4` (mock by default; `--provider minimax` for real AI video) |
| `scene <list\|restore\|approve>` | per-scene version history                  |

## Critical invariants

- **Never auto-approve** storyboard/script/research drafts — the user must
  read and `video approve` explicitly. Agents are drafting; humans decide.
  The CLI enforces this: `preview` refuses to render without an approved
  storyboard checkpoint, and re-running a generator over an approved stage
  exits non-zero unless `--force` is passed.
- **Credentials stay in env** — never write `MINIMAX_API_KEY` / `GLM_API_KEY`
  to disk. The grep test in the test suite asserts this.
- **Failure exit code is non-zero** — surface LLM/TTS/render errors
  immediately; do not silently retry past bounded budgets.

## Forwarding pattern

When the user types `/video draft "AI 思维链"`, expand to:

```bash
bin/video draft "AI 思维链"
# or equivalently:
node packages/cli/dist/index.js draft "AI 思维链"
```

Both are equivalent — `bin/video` is a thin shell wrapper that forwards to
the compiled CLI. `bin/video` is the only artefact a user needs to
remember; the `node packages/cli/dist/index.js` path is documented for
maintainers.