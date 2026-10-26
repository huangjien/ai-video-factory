# Cross-Model Judging — Design & Plan

**Date:** 2026-10-26
**Status:** Accepted — implemented 2026-10-26
**Requirement:** Every AI scorer (judge) must use a *different model* than the one that generated the artifact it scores.

---

## Context

Three stages in the pipeline use an LLM to score an artifact. One does not:

| Stage | Scorer | Generator model (default) | Judge model (default) | Today |
|---|---|---|---|---|
| Article (`video draft`) | `scoreArticle` in `packages/draft/src/article-review.ts` | glm (research role) | glm — **same instance** | ❌ self-judging |
| Storyboard/script (`video review`) | `callReview` in `packages/review` | minimax (storyboard role) | glm | ✅ different, but by accident — see bug below |
| Prompt evals (`video prompts eval --judge X`) | rubric judge in `packages/cli/src/prompt-evals.ts` | X | X | ❌ self-judging by default |
| Rendered video (`video qa`) | deterministic checks (`packages/qa`) | — | — | ⛔ no LLM; out of scope |

**Key constraint:** only two providers exist (`glm`, `minimax`) and three roles generate artifacts
(research, storyboard, script…). A static role table cannot guarantee "judge ≠ generator" for every
pairing (pigeonhole: `review: glm` collides with the article's glm generator; `review: minimax`
collides with the storyboard's minimax generator). The guarantee must be a **pairing rule in code**,
not a config default.

**Existing bug this design also fixes:** `packages/cli/src/review-command.ts:76` reads
`cfg["research"]` instead of `cfg["review"]`. It matches the intended default only because both
default to glm today; a user override of `review:` in `llm.config.yaml` is silently ignored.
(`youtube`/`bilibili`/`retrospect` commands read `cfg["review"]` correctly.)

---

## The pairing rule (deterministic, no LLM)

```
judge = cfg.review.primary
if judge == generator:            # collision
    judge = cfg.review.fallback   # flip
    warn on stderr
if judge == generator:            # both slots collide (single-provider setup)
    warn loudly, proceed same-model
```

Expressed as one helper in `@video/llm` so every call site shares it. Control flow stays in plain
code (never delegated to a model). `--judge-model` (and evals' `--judge`) override the helper.

---

## Options

### Option A: Judge = `review` role + collision flip (recommended)

- **Approach**: The `review` role keeps its meaning ("the model that grades"). A new
  `pickJudgeProvider(cfg, generatorName)` helper applies the pairing rule above. The article judge
  and storyboard review both route through it; prompt evals get an optional generator/judge split.
  No config schema change; defaults unchanged.
- **Trade-offs**: gains the guarantee for all stages with ~4 small diffs; costs a warning-driven
  fallback (the effective judge model can differ per stage when collisions flip — mitigated by
  recording `judge_model` in every output artifact and run record).
- **Cost**: S (~1 day incl. tests)
- **Risk**: low — library callers of `runScoredDraft` keep old behavior via optional params
  (judgeProvider defaults to the generator provider); CLI always passes it explicitly.

### Option B: Explicit per-stage judge config (`judges: { article, storyboard }` section)

- **Approach**: new config section pins a judge per scored stage. No implicit flips.
- **Trade-offs**: gains explicit per-stage control; costs a bigger config surface, a new Role-like
  type, docs, and it still can't express "≠ generator" — a misconfigured `judges.article: glm` with
  generator glm reintroduces self-judging silently.
- **Cost**: M (~2–3 days)
- **Risk**: medium — config drift; more surface to document and validate.

### Option C: Re-role the article generator to `script` (minimax) so defaults never collide

- **Approach**: `video draft` switches from the research role (glm) to the script role (minimax);
  then review=glm never collides and no pairing logic is needed.
- **Trade-offs**: gains zero extra logic; costs changing the article generation model by default —
  output quality/cost/token-profile changes for every existing user, and `--model`'s documented
  default changes. The research role's role in drafting is load-bearing legacy.
- **Cost**: S in code, M in behavioral fallout
- **Risk**: medium-high — silent quality regression on the pipeline's most sensitive artifact.

---

## Recommendation: Option A

**Confidence**: high.
**Why**: it makes "judge ≠ generator" a code-level invariant instead of a config coincidence, fixes
the `review-command` config bug on the way, costs the least, and changes no generation behavior.
Option C is attractive but trades a silent generation-quality change for a little less logic —
not worth it. Option B can be layered on top of A later if per-stage pinning is ever needed.

---

## Plan

1. **`@video/llm`: pairing helper** — add `pickJudgeProvider(cfg, generatorName): { name, flipped }`
   to `packages/llm/src/config.ts`; export from index.
   *Verify:* unit tests — no-collision → primary; collision → fallback + `flipped: true`;
   double-collision → primary + warning path; explicit preference wins.
2. **Article judged loop (`packages/draft`)** — `ScoredDraftOptions` gains optional
   `judgeProvider` / `judgeFallback`; `produce()` calls `scoreArticle` with them; track judge token
   usage (currently **dropped** — only `draft.usage` is accumulated at `article-review.ts:748`) and
   record `judge_model:` in `renderArticleReviewYaml` output for provenance.
   *Verify:* unit tests with mock providers asserting the judge call went to the other provider and
   judge usage is counted; existing tests stay green (default = generator provider).
3. **`video draft` CLI (`packages/cli/src/draft-command.ts`)** — new `--judge-model <glm|minimax>`
   flag (default: `pickJudgeProvider(cfg, chosenName)`); pass judge providers into
   `runScoredDraft`; warn on collision flip.
   *Verify:* option-parsing test; default run resolves to glm→minimax flip under stock config.
4. **`video review` CLI (`packages/cli/src/review-command.ts:76`)** — read `cfg["review"]` (bug
   fix); apply `pickJudgeProvider` against the storyboard role's primary so a misaligned config
   still can't self-judge.
   *Verify:* existing review-command tests updated; new test for the collision path.
5. **Prompt evals split (`packages/cli/src/prompt-evals.ts`)** — optional `--gen <provider>`:
   when set, generate with it and judge with `--judge`; when unset, keep today's behavior
   (back-compat with recorded baselines). Report rows record both models.
   *Verify:* prompt-evals test gains a split-mode case.
6. **Docs** — USAGE.md / USAGE.zh-CN.md flag tables; regenerate command docs
   (`pnpm docs:commands`); note the pairing rule in the §6 provider-strategy section of
   `docs/AI_Video_Factory_Design_and_Plan_v1.1.md`.
   *Verify:* `pnpm lint && pnpm test` (coverage thresholds: 80% lines / 78% functions on changed
   files); `pnpm prompts:eval --offline` still green.

Parallelizable: steps 1–2 sequential (2 depends on 1); 3–5 can proceed in parallel after 2;
6 last.

**Out of scope:** `video qa` (deterministic by design); `video retrospect` (already uses
`cfg["review"]`); changing any generation-role defaults; adding new providers.

---

## Vertical slice (implement first)

Steps 1 + 3 + the minimal part of 2: one unit test where a mocked glm draft is judged by a mocked
minimax judge through `pickJudgeProvider` collision flip, asserting
(a) the judge provider differs from the generator and (b) `article-review.yaml` records
`judge_model: minimax`. This proves the invariant end-to-end before the remaining call sites move.
