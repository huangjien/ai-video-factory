# Plans

Milestone plans for the AI Video Factory. One directory per milestone (`vX.Y/`); each holds a
marker file (`milestone-vX.Y-<slug>.md`) whose first line reads `*Status:** Complete|Planned`.

The marker file is what `sync_version.sh --from-gsd` parses: only milestones marked **Complete**
drive the package version.

## Milestones

| Milestone | Status | Marker | Plan | Summary |
|---|---|---|---|---|
| v0.12 | Planned | [`v0.12/milestone-v0.12-decision-surfaces.md`](./v0.12/milestone-v0.12-decision-surfaces.md) | [`v0.12/v0.12-decision-surfaces-plan.md`](./v0.12/v0.12-decision-surfaces-plan.md) | Wire the OpenAI Decisions API into the surfaces the code audit found: 2 prepared-but-unwired surfaces + 3 new ones, all in `shadow`; close the bench's cost-axis gap. |

## Legacy flat plans (read-only)

These predate the `vX.Y/` layout. They are **read-only until migrated** into a `vX.Y/` directory —
do not add to them, and do not delete them.

| File | Covers |
|---|---|
| [`2026-10-19-chinese-storybook-visual-dna-design.md`](./2026-10-19-chinese-storybook-visual-dna-design.md) | The `chinese-storybook` channel's visual DNA (shipped in v0.9.1) |
| [`2026-10-19-chinese-storybook-visual-dna-implementation-plan.md`](./2026-10-19-chinese-storybook-visual-dna-implementation-plan.md) | Its implementation plan |
| [`2026-10-26-cross-model-judging-design.md`](./2026-10-26-cross-model-judging-design.md) | The judge-≠-generator pairing rule (shipped) |
| [`2026-11-18-military-ai-topic-backlog-design.md`](./2026-11-18-military-ai-topic-backlog-design.md) | 5-topic verified-fresh content backlog (military why/mechanism + AI hallucination) |
| [`2026-11-18-backlog-feature-design.md`](./2026-11-18-backlog-feature-design.md) | The `video backlog` feature: idea store, harvest, pick-to-draft loop |
| [`2026-11-18-backlog-feature-implementation-plan.md`](./2026-11-18-backlog-feature-implementation-plan.md) | Its implementation plan (BL-01…BL-08) |

## The decision layer

The decision provider layer's own design — the contract, the two providers, the bench, the corpus
rules and the safety rules — lives outside this directory and is **not** a milestone plan:

- [`../v0.11-decision-provider-plan.md`](../v0.11-decision-provider-plan.md) — design + plan (v0.11)
- [`../RELEASES.md`](../RELEASES.md) — the shipped numbers
