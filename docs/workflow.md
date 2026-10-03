# Workflow — gates, verbs, recovery

Three human gates (plan §14), persisted as workflow state — never a chat
"please confirm":

| Gate | Command | Blocks |
|---|---|---|
| Storyboard | `video approve storyboard` | `video preview` refuses to render without it (`--force` bypasses, recorded) |
| Review | `video approve review` | `video final` refuses without it |
| Final | `video final` (QA-gated) | error-level QA findings block the export (`--force` bypasses, recorded) |

## Canonical order (agent pipeline)

```bash
video new "<slug>"
video research "<topic>"          # optional, feeds script/storyboard
video script "<topic>" --from-research …
video storyboard "<topic>" --from-research … --from-script …
video approve storyboard --cwd projects/<slug>     # HUMAN GATE 1
video motion <slug> [--bpm 100]                    # Motion Agent (LLM + baseline fallback)
video audio <slug>                                 # TTS → per-scene WAVs + captions
video excalidraw <slug>                            # diagram → .excalidraw + animated svg assets
video review <slug>                                # read-only Content/Visual/Technical review
video preview --cwd projects/<slug>                # QA report + contact sheet (WAITING_REVIEW)
video qa <slug>                                    # rebuild the report; exits 1 on errors
video approve review --cwd projects/<slug>         # HUMAN GATE 2
video final --cwd projects/<slug> [--mix]          # HUMAN GATE 3 (QA-gated) → FINAL_APPROVED
video youtube <slug>                               # publishing metadata
```

## Minimal path (article-driven)

```bash
video draft "<topic>"     # article.md + audio-config.yaml (+ derived storyboard)
video approve storyboard --cwd projects/<slug>     # after reading article.md
video make "<topic>"      # tts → assets → render → mix (idempotent)
```

## Scene-level loop (§39 — the point of the whole system)

```bash
video scene list <slug>              # versions per scene (+ approved marker)
# … edit storyboard.yaml (or let the agent regenerate a scene) …
video preview …                      # re-renders ONLY changed scenes
video scene approve <slug> scene-05  # persist which version you approved
video scene restore <slug> scene-05 1
```

## Recovery (§25/§18.2)

- `video resume` — make-flow projects re-run the idempotent pipeline; CLI-flow
  projects print state + the exact next command.
- `video rollback <checkpoint-id>` — validates the id, marks downstream
  checkpoints invalidated, lands at DRAFT/<target stage>; never overwrites
  artifacts (content restores go through `video scene restore`).
- `video reset [stage] [--force]` — rewind; marks the target checkpoint
  invalidated instead of faking an approval.

## Invariants (enforced by the CLI, not by convention)

- Never auto-approve: preview requires an approved storyboard checkpoint.
- Generators (`research`/`script`/`storyboard`/`audio`/`motion`) refuse to
  overwrite an approved stage or a FINAL_APPROVED project without `--force`.
- `video final` refuses error-level QA findings without `--force`.
- Credentials only ever live in env vars; run records never contain keys
  (grep-tested).
