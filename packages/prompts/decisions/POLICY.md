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

## visual-class — which component renders the scene

Two rules, and the order between them is the whole disagreement.

Rule **`structure-over-photo`** — when the scene describes a STRUCTURE
the viewer must SEE to understand it, pick the component that draws
that structure, even when the scene is described as a photograph:

| the scene shows | the component |
|---|---|
| stages that feed each other | `FlowChart` |
| events in order along a rail | `Timeline` |
| a ring of arrows, a loop that repeats | `CycleDiagram` |
| two rings with an intersection | `VennDiagram` |
| layers stacked widest at the base | `PyramidDiagram` |
| items to work through | `Checklist` |
| a ranked list | `Leaderboard` |
| values compared by length | `BarChart` |
| numbers side by side | `StatGrid` |
| a command line | `Terminal` |
| someone else's words | `QuoteBlock` |
| one claim to remember | `Callout` |
| the point of the scene, stated | `BigIdea` |

Rule **`photo`** — when the scene describes a photograph with nothing to
draw, pick `AnimatedIllustration`.

Rule **`thesis`** — when the scene's point is a statement and no
structure has to be seen, pick `BigIdea`. A bare mention of a structure
is not a structure to show: a scene that says "the checklist keeps
growing" but lists no items has nothing for `Checklist` to render.

**The disputed band.** A scene that describes a STRUCTURE *as a
photograph* fires both rules. Which one wins is a production decision —
whether a video shows a diagram or a photo of the idea — so those cases
stay `disputed: true`, with the note saying which structure was read
into it.

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

## The offset was the wording's — fixed 2026-11-14

The decision model used to answer **one notch stricter** than the
review's verdict at every grade: `reject` where the review said `revise`,
`revise` where the review said `pass`. The per-grade cross-tab showed the
offset was uniform, which pointed at the wording rather than the model.

`scripts/experiment-decision-question.mjs` tested four wordings. The
winner (v3, severity-anchored) adds one sentence that defines the
boundary: *"A Major finding means 'this part must be fixed'. On its own
it does not mean 'rewrite the draft'."* Verdict accuracy on draft-bar
went **0.415 → 0.813**, and its content is now the production wording
(`decision-draft-bar.md`).

The labels were never touched: they stay the artifact's own verdict, and
the `review-verdict` rule is unchanged. Fixing the question moved the
model; the corpus did not move.

## Harvested cases## Harvested cases

`video decision backfill <project>` consults the decision model about a
project's EXISTING review attempts (no draft is re-run), and
`video decision harvest <project>` turns the answers into cases.

For `draft-bar` the label is **derived** from the review's own verdict by
the `review-verdict` rule, so a harvested case needs no human ruling and
can be moved into the corpus unchanged — the loader re-checks the
derivation when it loads it. The corpus loader also rejects a case whose
id is not unique, which is why the id keeps every script's letters (a
CJK project name must not collapse to an empty string).

For `visual-class` the label is PROPOSED and the case stays disputed: a
human rules on whether the scene shows a structure or a photograph.

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
