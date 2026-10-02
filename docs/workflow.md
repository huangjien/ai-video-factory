# Workflow — gates, verbs, recovery

Three human gates (plan §14), persisted as workflow state — never a chat
"please confirm":

| Gate | Command | Blocks |
|---|---|---|
| Storyboard | `vf approve storyboard` | `vf preview` refuses to render without it (`--force` bypasses, recorded) |
| Review | `vf approve review` | `vf final` refuses without it |
| Final | `vf final` (QA-gated) | error-level QA findings block the export (`--force` bypasses, recorded) |

## Canonical order (agent pipeline)

```bash
vf new "<slug>"
vf research "<topic>"          # optional, feeds script/storyboard
vf script "<topic>" --from-research …
vf storyboard "<topic>" --from-research … --from-script …
vf approve storyboard --cwd projects/<slug>     # HUMAN GATE 1
vf motion <slug> [--bpm 100]                    # Motion Agent (LLM + baseline fallback)
vf audio <slug>                                 # TTS → per-scene WAVs + captions
vf excalidraw <slug>                            # diagram → .excalidraw + animated svg assets
vf review <slug>                                # read-only Content/Visual/Technical review
vf preview --cwd projects/<slug>                # QA report + contact sheet (WAITING_REVIEW)
vf qa <slug>                                    # rebuild the report; exits 1 on errors
vf approve review --cwd projects/<slug>         # HUMAN GATE 2
vf final --cwd projects/<slug> [--mix]          # HUMAN GATE 3 (QA-gated) → FINAL_APPROVED
vf youtube <slug>                               # publishing metadata
```

## Minimal path (article-driven)

```bash
vf draft "<topic>"     # article.md + audio-config.yaml (+ derived storyboard)
vf approve storyboard --cwd projects/<slug>     # after reading article.md
vf make "<topic>"      # tts → assets → render → mix (idempotent)
```

## Scene-level loop (§39 — the point of the whole system)

```bash
vf scene list <slug>              # versions per scene (+ approved marker)
# … edit storyboard.yaml (or let the agent regenerate a scene) …
vf preview …                      # re-renders ONLY changed scenes
vf scene approve <slug> scene-05  # persist which version you approved
vf scene restore <slug> scene-05 1
```

## Recovery (§25/§18.2)

- `vf resume` — make-flow projects re-run the idempotent pipeline; CLI-flow
  projects print state + the exact next command.
- `vf rollback <checkpoint-id>` — validates the id, marks downstream
  checkpoints invalidated, lands at DRAFT/<target stage>; never overwrites
  artifacts (content restores go through `vf scene restore`).
- `vf reset [stage] [--force]` — rewind; marks the target checkpoint
  invalidated instead of faking an approval.

## Invariants (enforced by the CLI, not by convention)

- Never auto-approve: preview requires an approved storyboard checkpoint.
- Generators (`research`/`script`/`storyboard`/`audio`/`motion`) refuse to
  overwrite an approved stage or a FINAL_APPROVED project without `--force`.
- `vf final` refuses error-level QA findings without `--force`.
- Credentials only ever live in env vars; run records never contain keys
  (grep-tested).
