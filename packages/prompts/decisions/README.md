# Decision corpus — what this folder is

**This folder is under source control on purpose. It is not scratch data.**

These files are the labeled cases the decision bench (`video decision
bench`) measures providers against — the counterpart of the prompt-evals
golden set in `packages/prompts/evals/`. The draft-bar accuracy number
(0.926, docs/v0.11-decision-provider-plan.md §7.8) is computed over
exactly these files; deleting them deletes the measurement.

## Why they cannot be regenerated from the repo

Every case was harvested from a real production artifact — a shipped
`article-review.yaml`, a shipped render report, a shipped storyboard
scene. But `projects/*` is **gitignored** (only `benchmark-v01/` is
tracked), so those source artifacts do not survive a fresh clone. This
folder is the only durable copy of the labeled real-failure cases.
Throwing it away means re-collecting them from projects that no longer
exist on disk.

The three corpus builders under `scripts/` regenerate the v0.12
surfaces from the shipped artifacts on disk:
`build-motion-prescreen-corpus.mjs`, `build-caption-overlap-corpus.mjs`
and `build-review-verdict-corpus.mjs`. The draft-bar corpus is
harvested by `video decision backfill`.

## What is here

| Path | What | Source of truth |
|---|---|---|
| `<surface>/<case-id>.yaml` | One labeled case (state, expects, provenance, policy rule) | the artifact named in `provenance.source` |

Surfaces today: `qa-triage` (7), `draft-bar` (176), `caption-overlap`
(68), `review-verdict` (27), and `motion-prescreen` (92) — **370 cases**.
`motion-prescreen` is **retired**: it measured 47/92 = 0.511 (chance) on
2026-11-16, so it is not wired into any command and it does not gate the
provider choice — its cases stay as the durable copy of the measurement.
(The `visual-class` surface was retired with structured routing in v0.12
— see `docs/v0.11-decision-provider-plan.md` §7.5.)
| `POLICY.md` | The labelling rules, per surface | — |
| `prices.yaml` | Provider per-token prices for the bench's cost column | the provider's pricing page |

## What is NOT here (on purpose)

Per-project decision logs (`<project>/decision-log.jsonl`) and
harvest-queue files (`<project>/decision-candidates.yaml`) live under
`projects/` — they are regenerable by re-running (`DECISION_MODE=shadow
video draft` / `video decision backfill` / `video decision harvest`) and
are not tracked. This folder holds the distilled, policy-checked cases;
the per-project logs are the raw stream.

## Hygiene rules

1. Every case carries `provenance.source` naming the artifact it encodes
   — the audit script (`scripts/audit-decision-corpus.mjs`) verifies the
   citation and that the state matches the artifact.
2. `draft-bar` labels are DERIVED — the loader re-runs `verdictToLabel`
   on `source_verdict` and rejects a case whose label disagrees.
   `review-verdict` labels are derived the same way from the artifact's
   own `section_verdict`.
3. Run the audit after adding cases. Do not hand-edit a state to match an
   answer; fix the label or dispute it (`POLICY.md`).
