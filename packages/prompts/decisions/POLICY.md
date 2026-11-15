# The decision corpus labelling policy

Every case in this directory carries a label. A label is only worth
measuring if the next person would label the same case the same way —
otherwise the accuracy number moves when the labels do, and the number
measures the labeller, not the model.

So the labels come from **rules**, and every case records which rule
produced it (`policy.rule`). The rules are per surface. Where two rules
both apply and the ORDER between them is a production decision rather
than a fact, the case stays `disputed: true` — it still counts in the
accuracy, and the bench reports the disputed count and the accuracy over
the undisputed cases beside the headline number.

Read the surface's rule, apply it, and you get the label.

---

## qa-triage — `pass` / `review` / `block`

Rule **`qa-finding-level`**. Judge the finding as the render report
describes it:

- `block` — the rendered video is unusable as published: text is
  unreadable, a required asset is missing, or the video contradicts what
  it claims to show. The render was refused or would be refused.
- `review` — a human should look before publishing, but the video is
  still watchable: a scene boundary was missed, a caption is dense, a
  scene ran together.
- `pass` — the finding is cosmetic or informational, and the video can
  ship unchanged.

The level the QA check itself raised is the strongest signal: an `error`
finding is `block`, a `warn` finding is `review`, and a clean render is
`pass`.

---

## draft-bar — `pass` / `revise` / `reject`

Rule **`review-verdict`**. The draft's own review is the authority. The
label is what the review loop concluded, not a second opinion of it:

- `reject` — the review raised a Critical finding or a
  `CRITICAL_BLOCKER` risk flag: the draft cannot be repaired by
  editing, it has to be written again.
- `revise` — the review raised a `MAJOR_REVISION_NEEDED` flag, or
  `passing: false`: the draft holds together and specific parts fail.
- `pass` — neither: publishable as it stands.

The order matters, and it was fixed by a contradiction in the artifacts:
one shipped review says `passing: true` AND raises
`MAJOR_REVISION_NEEDED`. `MAJOR_REVISION_NEEDED` wins — a draft the
review itself wants revised is not a pass.

This is the rule the surface exists to predict. The decision layer would
screen a draft **before** the expensive review runs, so the ground truth
is the verdict the review would have given — and it is already recorded
in the artifact.

**The label is DERIVED, not asserted.** Every draft-bar case carries
the artifact's verdict in `source_verdict`:

```yaml
source_verdict:
  passing: true
  major_revision_needed: true
```

and the loader refuses a fixture whose label disagrees with the rule
(`verdictToLabel` in `packages/prompts/src/decision-evals.ts`). A
draft-bar label cannot drift away from the artifact it claims to
encode.

---

## caption-overlap — a yes/no question

Rule **`caption-band`**. The statement is: *two pieces of text are drawn
in the bottom band at the same time, so at least one of them cannot be
read.* The answer is `true` when both the caption and another text (a
lower-third subtitle, a card's own title) occupy the bottom band
together, `false` when the caption sits alone.

The expected band (e.g. `0.8 … 1.0`) is the confidence the answer
should carry: a clear overlap is near-certain, a marginal one is not.

---

## motion-prescreen — `keep` / `refine`

Rule **`motion-specificity`**. Judge the plan against the scene it
animates:

- `keep` — the plan already gives the scene a clear motion that matches
  its content, and a second pass would not change what the viewer sees.
- `refine` — the plan is generic: the scene gets the same motion as its
  neighbours, or the motion contradicts what the scene is about.

---

## What the policy changed

Applying this policy to the corpus moved three labels, and the moves are
recorded rather than hidden:

- `checklist-missed` → `ledger-stacks-not-a-checklist` — the case had a
  scene's CAPTION as its state instead of its image. The audit
  (`scripts/audit-decision-corpus.mjs`) caught it. The scene's caption
  reads 清单 (a checklist) but its image is a photograph of two ledger
  stacks, so the photo rule wins and the label is `AnimatedIllustration`.
- `grade-a-with-two-major-findings` — the artifact contradicts itself
  (`passing: true` AND `MAJOR_REVISION_NEEDED`); the rule now settles
  it as `revise`, and the label moved from `pass` to `revise`.
- Five draft-bar cases that were marked `disputed` are settled by the
  verdict rule and are no longer disputed.

## Two fixes moved the labels and the model (2026-11-14)

**1. The offset was the wording's.** The model used to answer one notch
stricter than the review's verdict at every grade. Four wordings were
measured over the same 176 cases (`scripts/experiment-decision-question.mjs`);
the severity-anchored one — which defines what a Major finding means —
took draft-bar accuracy from 0.415 to 0.813, and its content is now the
production wording (`decision-draft-bar.md`).

**2. The rule misread the loop's gate.** The first `review-verdict` rule
mapped `MAJOR_REVISION_NEEDED` to `revise` — but the loop's own gate
(`passesBar`) blocks only on a Critical finding, and six shipped
artifacts hold `passing: true` plus the flag. The rule now matches
`passesBar`: Critical → `reject`, else the review's `passing` flag
decides. Six labels moved (`revise` → `pass`), the loader re-derives and
re-checks every one of them, and draft-bar went **0.813 → 0.926** — the
bench gate (0.9) clears.

Neither fix touched a label by hand. The wording fix moved the model;
the rule fix moved six labels that contradicted the artifact they cite.

## The provider and the mode

`openai` (the Decisions API, model `gpt-6-luna`) is the default for every
surface, and the layer runs **on by default** (the bench gate cleared —
0.924 ≥ 0.9). `DECISION_MODE=off|shadow|on`, `DECISION_PROVIDER` /
`DECISION_MODEL` override per run; the vitest global setup pins the mode
off so tests stay hermetic.

**One acting surface is wired: the QA advisory.** `video qa` consults the
model per finding and writes `advisory: pass|review|block` (plus a
confidence) onto the finding in `qa/render-report.json`. It never gates —
`--strict` reads the check's `level`, and the advisory's baseline IS the
level mapping (the corpus measured the model agreeing with it 7/7). The
decision and its revisit conditions are recorded in
`docs/v0.11-decision-provider-plan.md` §15. `minimax` stays a measured
alternative, not a default: its self-reported probability was not stable
across runs (brier 0.006 → 0.941 over seven runs of the same corpus),
and its monthly plan ran dry on 2026-11-14 under the measurement
campaign's load — available most days, but a heavy bench spends the
month's budget. When the quota is out the layer degrades to the
deterministic path; the shadow rows carry the error.

## Harvested cases

`video decision backfill <project>` consults the decision model about a
project's EXISTING review attempts (no draft is re-run), and
`video decision harvest <project>` turns the answers into cases.

For `draft-bar` the label is **derived** from the review's own verdict by
the `review-verdict` rule, so a harvested case needs no human ruling and
can be moved into the corpus unchanged — the loader re-checks the
derivation when it loads it. The corpus loader also rejects a case whose
id is not unique, which is why the id keeps every script's letters (a
CJK project name must not collapse to an empty string).

The per-project `decision-candidates.yaml` queue is only produced for
`draft-bar` today; the labels are derived from the review's own verdict,
so a harvested case needs no human ruling.

## Adding a case

0. Run `node scripts/audit-decision-corpus.mjs` — it checks that every
   case's state is a real scene's `visual:` line in the project it names,
   and that every file it cites still exists. A case copied by hand out
   of a log drifts; the audit is what catches it.

1. Find a real artifact: a shipped render report, a shipped article
   review, a shipped storyboard scene, a dated `RELEASES.md` entry.
2. Write the state the decision would see — the finding, the findings,
   the scene's description.
3. Label it with the rule above, and record which rule you used.
4. If two rules both fire and their order is the disagreement, set
   `disputed: true` and say in `dispute` what the other reading is.
5. `provenance.source` names the artifact and the line in it. A case
   without provenance is an invented one.
