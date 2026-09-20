---
description: AI Video Factory — full pipeline from research to rendered MP4 (doc §58 Pi Extension)
argument-hint: "[video-args...]"
tools:
  bash: true
  read: true
  write: true
---

# /video — drive the AI Video Factory pipeline

This command runs the `vf` CLI under the hood. Every `/video <verb> [args...]`
is forwarded to `vf <verb> [args...]` — the `bin/video` wrapper in this repo
makes the shell call.

## Pipeline (call in this order)

```
1. /video new "<topic-slug>"                 — scaffold projects/<slug>/
2. /video research "<topic>"                 — drafts research/{research.md, sources.yaml, claims.yaml}
3. /video script "<topic>" \                   — drafts script/script.zh-CN.md
   --from-research projects/<slug>/research
4. /video storyboard "<topic>" \               — drafts storyboard/storyboard.yaml
   --from-research projects/<slug>/research \
   --from-script projects/<slug>/script/script.zh-CN.md
5. /video audio "<slug>"                       — synth per-scene WAVs + captions/zh-CN.srt
   (edit storyboard to reference audio paths in scenes)
6. /video review "<slug>"                      — Content/Visual/Technical review YAMLs
7. /video preview --cwd projects/<slug>         — renders preview.mp4
8. /video approve review --cwd projects/<slug>  — human gate
9. /video final --cwd projects/<slug>           — renders final.mp4
```

## Verbs (one line each)

| Verb | Purpose |
| --- | --- |
| `new <id>` | scaffold a project under `projects/<id>/` |
| `research <topic>` | (v0.2.2) AI-gather facts + sources + claims |
| `script <topic>` | (v0.2.3) AI-draft a 7-section script |
| `storyboard <topic>` | (v0.2.1) AI-draft a VDSL storyboard |
| `audio <project>` | (v0.2.4) Synthesize voiceover + captions |
| `review <project>` | (v0.2.5) Read-only Content/Visual/Technical review |
| `validate <file>` | VDSL validation (shape + assets + audio) |
| `status` | per-stage checklist + current checkpoint |
| `approve [stage]` | human approve; advances state machine |
| `reject <reason>` | record feedback, transition to regenerate |
| `rollback <checkpoint-id>` | confirm + invalidate downstream stages |
| `resume` | resume from last successful stage |
| `preview` | render preview.mp4 |
| `final` | render final.mp4 (requires review APPROVED) |

## Usage

The `bin/video` wrapper (also available as `vf` directly) takes any of the
above verbs and forwards to the underlying CLI. Each step produces files
inside `projects/<slug>/` that the next step picks up — never bypass the
human gate (`vf approve`) unless the user explicitly says to.

## Critical invariants

- **Never auto-approve** storyboard/script/research drafts — the user must
  read and `vf approve` explicitly. Agents are drafting; humans decide.
- **Credentials stay in env** — never write `MINIMAX_API_KEY` / `GLM_API_KEY`
  to disk. The grep test in the test suite asserts this.
- **Failure exit code is non-zero** — surface LLM/TTS/render errors
  immediately; do not silently retry past bounded budgets.
