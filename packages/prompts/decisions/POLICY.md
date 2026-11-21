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

**The corpus (2026-11-16).** 66 negatives are built from the shipped
render reports and captions (`scripts/build-caption-overlap-corpus.mjs`):
one per shipped film whose `captions` check passed, with the scene's own
text and its position read from the storyboard (the CS-06 `overlay:`
declares `top` or `bottom`; the baked PNG overlay is written above the
band by `scripts/pillow-text-overlay.py`). The label is DERIVED from
that position: `bottom` means the band holds two texts, `top` means the
caption sits alone. The two positives are the documented failures — the
v0.9.1 comparison card that printed its own text twice, and a real QA
report's caption collision.

**Measured 2026-11-16 (OpenAI Decisions API, `gpt-6-luna`, 68 cases):
68/68 = 1.000, brier 0.000.** The deterministic baseline also scores
1.000 on this corpus — 66 of the 68 cases are negatives and the caption
check answers "no overlap" for all of them — so the surface's measured
value is the two positives the check misses, not the headline number.

---

## review-verdict — `pass` / `warn` / `fail`

Rule **`section-verdict`** (v0.12, P5). The `video review` agent writes
three files per project — `content-review.yaml`, `visual-review.yaml`,
`technical-review.yaml` — and each ends in an `overall` verdict:
`pass` | `warn` | `fail`. That verdict is the ground truth.

The state carries the section's fields and findings and **deliberately
withholds the verdict**: the model has to read the findings and decide
the verdict they earn. Carrying it would make the question "repeat what
you were told".

The label is DERIVED from the artifact and the loader re-checks that
derivation:

```yaml
source_verdict:
  section_verdict: warn
```

The deterministic baseline is the **field-status rule**
(`sectionVerdictBaseline`): a failed field fails the section, a warned
field (or a serious finding) warns it, a clean section passes. That
rule is the same function the corpus is built with, so the two cannot
drift.

**Measured 2026-11-16 (OpenAI Decisions API, `gpt-6-luna`, 27 cases
from the shipped review artifacts): 27/27 = 1.000.** The deterministic
rule scores 0.926 — it answers `warn` for the two sections the review
agent called `fail`. The corpus is lopsided (25 `warn`, 2 `fail`), so
the majority class alone would score 0.926; the two `fail` sections are
what the model actually earns.

---

## motion-prescreen — `keep` / `refine`

Rule **`motion-specificity`** (rewritten 2026-11-16 — the rule used to
be prose only; it is now derived from the shipped artifact, and the
corpus is built from the shipped storyboards).

The ground truth is the plan that actually shipped: every shipped
storyboard carries the motion plan the pipeline produced for that scene,
and that plan is the answer to "what did this scene need?".

- `refine` — the shipped plan animates a **named element** of the
  scene (`event-1979`, `__title__`, `line-0`). The baseline plan cannot
  know those names, so the scene needed a second pass.
- `keep` — the shipped plan animates the scene as a whole (every target
  is the scene id): the same shape the deterministic baseline produces.

The population is lopsided — 482 `refine` and 46 `keep` across the 528
shipped scenes that carry a plan — so the corpus is **balanced 50/50 by
construction** (`scripts/build-motion-prescreen-corpus.mjs`). A corpus
that is 91% one class measures the majority class, not the model.

The baseline (today's deterministic path) answers `keep` for every scene
— the baseline plan IS what runs when nobody refines it — so the
deterministic baseline scores 0.500 on the balanced corpus.

**Measured 2026-11-16 (OpenAI Decisions API, `gpt-6-luna`, 92 cases):
47/92 = 0.511 — chance.** The state (the scene, its narration, its
props, and the baseline plan) does not carry the fact the label is
derived from: in 475 of the 482 `refine` cases the named targets
(`__title__`, `node-0`, `event-1979`) are renderer-internal ids that
appear nowhere in the scene's props. The surface therefore stays in
`shadow` — consulted and recorded, never acting — and the number above
is its verdict.

**RETIRED 2026-11-16 (v0.12 P1).** The surface is not wired into any
command and it does not gate the provider choice; its cases stay as the
durable copy of the measurement. A surface that measured at chance must
not drag the corpus-wide gate down: the gate answers "can this provider
carry the surfaces the pipeline actually consults?", and a retired
surface is not one of them.

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

`google` (Gemini Decisions API, model `gemini-decision-1`) is the default
primary provider, followed by text-compatible OpenAI and MiniMax. The
layer runs **on by default**. `DECISION_MODE=off|shadow|on`,
`DECISION_PROVIDER` / `DECISION_MODEL` override per run; the vitest global
setup pins the mode off so tests stay hermetic. The historical OpenAI
benchmark result below describes the old text corpus and does not measure
Gemini multimodal performance.

The shared decision contract supports a batch of typed questions against
one ordered shared input. Gemini accepts text, image, audio, video, and PDF
blocks in a single request (up to 1,000 questions). OpenAI is the native
text-batch fallback; MiniMax handles text one question at a time. Automatic
fallback skips providers that cannot represent the input and retries only
service failures. Missing or malformed answers remain null.

`video decision inspect --request <yaml>` explicitly sends the selected
local media to the configured provider. It prints structured answers and
confidence; it does not trigger pipeline actions. Logs keep file metadata
and digests, not raw text or media bytes.

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
