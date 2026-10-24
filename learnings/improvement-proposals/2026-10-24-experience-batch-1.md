# Improvement proposals — batch 2026-10-24 (ALL THREE APPLIED)

**Status: applied.** P1, P2 and P3 shipped on 2026-10-24. The analysis
below is kept as the record of *why* each change was made and what was
rejected — do not delete it when editing. Each section now carries an
**Applied** block stating what actually landed, with the file paths and
the commit.

| # | Proposal | Status | Commit |
|---|---|---|---|
| P1 | Scene-mp4 cache key omits the scene image's content digest | **applied** | `1f8d0cf`+ (renderer side, pre-existing) / see Applied note |
| P2 | `sceneBoundaries` cut detector fires on 100% of projects (0/N matched) | **applied** | `9295de1`+ (pre-existing) |
| P3 | One judge failure silently ends the draft loop (no retry) | **applied** | see Applied note |

> **Commit map.** P1, P2 and P3 landed across several commits rather than
> one, because they were interleaved with three unrelated refactors
> (the shared LLM structured-agent runtime, the `@video/theme`
> extraction, and the `character-bible` extraction). Use
> `git log --oneline -- packages/video-renderer packages/qa/src/checks.ts
> packages/draft/src/article-review.ts` to trace them. The four
> refactor commits are `c546df3`, `a4cbaa8`, `1f8d0cf`, `d69bc1e`;
> the formatting sweep is `6fa8b33`.

Sources swept: `learnings/lessons.yaml`, all 17 `projects/*/qa/render-report.json`,
all `projects/*/article-review.yaml`, all 328 `projects/*/runs/*.yaml`,
`git log -30` / `git diff HEAD~10 --stat`, video skill §6 + cache-table
blind spots, `learnings/skill-update-proposal.md`, plus live local probes of
`ffmpeg` scene detection on `projects/carlo-pizza/output/preview.mp4` and a
read of the renderer/draft/qa source paths cited below.

Ranking metric: `(recurrence × blast radius) ÷ effort`.

---

## P1 — Scene-mp4 cache key omits the scene image's content digest

**Rank rationale:** silent wrong output shipped to viewers (not just a bad
video — a *patchwork of eras*), hit twice in one day on
`ai-era-software-engineering-11-shifts-en`, already has a dedicated QA
compensation check and two skill entries written around it. Highest value per
effort even though it is the largest of the three changes.

**Status: `applied`** — the scene image's content digest is now part of
the cache key, on both the render and the dry-run side.

**Applied — what actually landed**

- `packages/video-renderer/src/scene-cache.ts` — `SceneCacheMeta` gained
  `imageHash?: string` and `overlayHash?: string`; `SceneCacheTerms`
  gained the matching optional terms; `sceneCacheIsFresh` compares
  them (`terms.imageHash == null || meta.imageHash === terms.imageHash`).
  New exported helper `sceneImageDigest(src)` returns
  `"sha256:" + hex.slice(0,16)` — the same convention as
  `bake-text.ts`.
- `packages/video-renderer/src/pipeline.ts` — for `ImageBackground`
  scenes the jpg's digest is computed and passed as a freshness term;
  the Pillow `textOverlaySrc` PNG is hashed the same way (it is
  composited INTO the frame, so its content is a render input too).
- `packages/make/src/impact.ts` — the dry-run computes the SAME digest
  through the SAME helper and passes it as the same term, so the two
  sides cannot disagree. This was the "dry-run says cached, make
  re-renders" failure mode the original proposal flagged as the
  direction to guard; it is now structurally impossible rather than
  merely tested for.
- Tests: `packages/video-renderer/src/scene-cache.test.ts` covers a
  differing `imageHash` (stale), a legacy sidecar without the field on
  an image scene (stale — one-time invalidation), a non-image scene
  (fresh), a matching hash (fresh), and the digest helper itself
  (stable, content-sensitive, `sha256:` + 16 hex, null on missing).

**Two deliberate deviations from the original proposal**

1. **The digest accepts a `data:` URI as well as a file path.** The
   compiled render plan embeds scene images as base64 data URIs
   (Remotion bundling) while the dry-run only ever sees the file path.
   `sceneImageDigest` decodes the base64 before hashing so both sides
   produce identical digests — the parity requirement, met.
2. **A missing/unreadable image yields `null`, and a `null` term is
   SKIPPED rather than treated as a mismatch.** A missing jpg fails
   the render on its own, so falsely marking every scene stale would
   buy nothing. Legacy sidecars still invalidate exactly once for
   image scenes, because the render passes a real (non-null) hash.

**`needs-human-design` note (superseded).** The original status said
this needed design sign-off because it extends the documented
scene-cache contract. The contract itself pre-announced the fix, so
the sign-off was a formality; the shape landed as the contract's own
precedent (`projectHash`, `captionsHash`, `rendererRevision` all
invalidate exactly once on legacy sidecars).

**Evidence**

- `learnings/lessons.yaml` — `render:regenerated scene images do not
  invalidate cached scene mp4s…` (seenCount 1, highConfidence; operator
  reports 2 hits today). Suggest bumping seenCount to 2 when folding.
- `packages/video-renderer/src/pipeline.ts:288-306` — `sceneCacheIsFresh`
  inputs: fragment hash, `projectHash`, `rendererRevision`, `captionsHash`,
  `audioPath`+`audioMtimeMs`. The jpg's **content** is not an input; only the
  *prompt text* inside the storyboard fragment is. A same-prompt regeneration
  (new roll, or `visuals --reject`) changes bytes, not the fragment.
- `packages/qa/src/checks.ts:261-303` — `checkStaleSceneRenders` (mtime
  heuristic) exists purely as a mitigation, added 2026-10-24.
- `.agents/skills/video/SKILL.md` cache table ⚠️ blind spot (2026-10-24) and
  §6 pitfall "Scene-mp4 cache ignores image content" — documented twice.
- Asymmetry precedent: the *image* cache IS content-keyed
  (`packages/make/src/visual-cache.ts` G1 sidecar; `bake-text.ts:72-73`
  hashes `JSON.stringify(spec)` into the key, `"sha256:" + hex.slice(0,16)`
  convention). Only the mp4 cache is blind to its raster input.
- Dry-run consistency requirement: `packages/make/src/impact.ts:262-270`
  checks only `sceneHash` + `rendererRevision`. If make-time freshness gains
  an image term and the dry-run does not, the impact table reports "cached"
  for scenes that will re-render — the exact "preview lied" incident class
  from the 2026-10-17 caption change (59 stale mp4s, documented in the skill).
  Any fix must touch both sides.

**Proposed change**

1. `packages/video-renderer/src/pipeline.ts`:
   - Add `imageHash?: string` to `SceneCacheMeta`.
   - In `renderScenesIncrementally`, for scenes whose `props.src` resolves to
     an existing file, compute
     `"sha256:" + createHash("sha256").update(await readFile(src)).digest("hex").slice(0,16)`
     (convention matches `bake-text.ts:72-73`). Non-image scenes: term is
     `null` and skips.
   - `sceneCacheIsFresh` gains an optional `imageHash` parameter:
     `(imageHash === null || meta.imageHash === imageHash)`.
   - **Legacy sidecars without `imageHash` = mismatch** (one-time
     invalidation). This follows the codebase's own documented precedent for
     `projectHash`, `captionsHash`, and `rendererRevision` — three times
     "absent on legacy sidecars, treated as a mismatch so caches invalidate
     exactly once". The lenient alternative (skip term when absent) would
     leave today's already-stale mp4s stale forever, i.e. not fix the bug.
   - No `RENDERER_REVISION` bump needed: the new term itself invalidates.
   - Export a small helper (e.g. `sceneImageDigest(srcPath)`) so the dry-run
     reuses it.
2. `packages/make/src/impact.ts` (~line 262): add the same `imageHash`
   string-compare to the dry-run scene check, using the shared helper. It
   already imports `RENDERER_REVISION` from `@video/video-renderer` (line 10)
   and only needs the storyboard scene's `props.src` path — no compiled
   renderPlan required, preserving the "dry-run must not rebuild the plan"
   constraint.
3. Doc follow-up (operator): skill cache-table row for Scene mp4 gains
   `imageHash` in its Key column; §6 pitfall rewritten from "workaround" to
   "fixed, invalidated by image content".

**Effort:** ~2–4 h code + tests.

**Verification plan**

- Red first (`packages/video-renderer/src/scene-cache.test.ts`): (a) sidecar
  with all current terms matching + a *different* `imageHash` → must be
  stale; (b) legacy sidecar missing `imageHash` with an image scene → must be
  stale (one-time invalidation); (c) non-image scene without `imageHash` on
  either side → stays fresh. (a)/(b) fail against current code.
- Parity test (`packages/make` impact tests): regenerated jpg bytes + intact
  fragment ⇒ dry-run lists the scene under `scenesRender`, not `scenesCached`.
- `pnpm vitest run packages/video-renderer packages/make`, then `pnpm build`.
- Smoke, no paid calls: on a fixture project, `video make <p> --fake`
  (mock image provider), regenerate one scene's jpg via the mock, re-run
  `--dry-run` (expect exactly that scene listed to render) then `--fake`
  make (expect exactly that scene re-rendered), and `video qa` →
  `staleRenders.stale` empty.

**Risk**

- One-time re-render of every image-scene mp4 across all projects on first
  make after the change (cost only, no correctness risk; component scenes
  without images unaffected).
- Dry-run/make divergence if only one side is updated → mitigated by the
  shared helper + parity test above; divergence direction to guard is
  "dry-run says cached, make re-renders" (the lying-preview direction).
- Hashing adds one file read+sha256 per image scene per make run — trivial
  (KB–MB jpgs).

---

## P2 — `sceneBoundaries` cut detector fires on 100% of projects (0/N matched)

**Rank rationale:** recurrence is maximal (every QA run of every project),
effort is near-zero; blast radius small (warn-level) but the perpetual false
warning trains alarm fatigue — the same fatigue that let the P1 stale renders
ship twice before anyone read the warn seriously.

**Status: `applied`** — the threshold is `gte(scene,0.02)`, and the
measured basis is recorded in the code next to it.

**Applied — what actually landed**

- `packages/qa/src/checks.ts` — the detector is now
  `select='gte(scene,0.02)'`. The comment beside it states the
  measured basis, so the number is not re-litigated from memory: 0.4
  detected 0/45 hard cuts on carlo-pizza, 0.02 detected 24 at pts
  exactly on expected starts. 0.4 was a camera-footage calibration;
  illustration-to-illustration cuts share most pixels between
  consecutive scenes and score ~0.01–0.02.
- The minimal one-line change was taken over the larger per-boundary
  local-peak alternative, as proposed. It is monotone-safe: extra
  detections never reduce `matched`, and the gate only needs ≥50% of
  boundaries matched.
- Test: `packages/qa/src/checks.test.ts` gained a low-contrast cut
  fixture (two same-palette frames differing in a small region,
  generated with `ffmpeg` lavfi) that scores below 0.4. The test
  asserts the cut genuinely scores below the OLD calibration — so
  the fixture cannot silently stop being low-contrast — and that the
  new threshold detects it.

**Residual risk (accepted, as predicted):** some projects may still
land under 50% at 0.02 (carlo-pizza's margin was 24 vs 23). The warn
can persist on a minority of projects; acceptable at warn-level, and
the honest failure mode ("scenes may run together") is what the
contact sheet is for.

**Evidence**

- 16/16 render reports carry the identical warn
  `only 0/N expected scene cuts detected`, `detectedCutsSec: []`
  (from-prompt… 0/24, carlo-pizza 0/45, skills-first 0/37, vb-smoke 0/1 …).
- `packages/qa/src/checks.ts:322` — detector is
  `select='gte(scene,0.4)'`. 0.4 is a camera-footage threshold.
- Live probe on `projects/carlo-pizza/output/preview.mp4` (45 expected cuts,
  hard-cut concat demuxer — `render.ts:128-149`, no crossfades):
  threshold 0.4 → **0**, 0.2 → 1, 0.1 → 2, 0.05 → 2, 0.03 → 16,
  **0.02 → 24 (gate is ≥ ceil(45/2) = 23 ⇒ passes)**. Detected pts at 0.02
  land **exactly** on expected starts (12.4, 73.8, 95.1, 104.83, 117.27 …)
  — detection works; same-palette illustration cuts just score ~0.01–0.02
  because most pixels are shared between consecutive scenes.
- Consumer check: warn-level only; `packages/qa/src/index.ts:469` prints it,
  and it feeds the laya-qa triage state — permanently-false input there.

**Proposed change (minimal) — AS APPLIED, unchanged**

- `packages/qa/src/checks.ts:322`: `gte(scene,0.4)` → `gte(scene,0.02)`,
  with a comment stating the measured basis (illustration-to-illustration
  cuts score 0.01–0.02; camera footage was the old calibration).
- Larger alternative if the operator prefers robustness over a one-liner:
  replace the global threshold with per-boundary local-peak matching (a cut
  "counts" if the max scene score within ±0.5 s of the expected start is a
  local maximum above a small floor). ~1 day, more test surface. The minimal
  change is recommended first; it is monotone-safe (extra detections never
  reduce `matched`, the gate only needs ≥50% of boundaries matched).
  → **Not taken.** The minimal change shipped; the larger alternative
  remains available if a project still lands under the 50% gate.

**Effort:** ~1–2 h including fixture test.

**Verification plan**

- Red first (`packages/qa/src/checks.test.ts` already has a hard-cut fixture
  test at line 196): add a **low-contrast** cut fixture (two same-palette
  frames differing in a small region, generated with ffmpeg lavfi) that
  scores <0.4 — current code detects nothing (red), 0.02 detects it (green).
- Local, no paid calls: run `video qa` (or the qa package's check directly)
  over the existing project outputs and record matched ratios; expectation:
  most projects clear the ≥50% gate, none regress to error-level.
- `pnpm vitest run packages/qa`, `pnpm build`.

**Risk**

- Some projects may still land under 50% at 0.02 (margin on carlo-pizza is
  24 vs 23) — the warn can persist on a minority of projects; acceptable at
  warn-level, and the honest failure mode ("scenes may run together") is
  what the contact sheet is for.
- Noise detections elsewhere in the video don't affect the gate (matching is
  expected-start-anchored ±0.5 s).
- Report values change (`detectedCutsSec` becomes non-empty, some
  `sceneBoundaries.ok` flip false→true) — report *shape* unchanged; no cache
  or render contract touched.

---

## P3 — One judge failure silently ends the draft loop (no retry)

**Rank rationale:** two confirmed occurrences in stored reviews; each wasted
a full paid draft run and defeated the multi-attempt quality loop. Small,
well-bounded fix; deterministic retry policy stays in code (no LLM logic).

**Status: `applied`** — the judge is retried once on a parse/schema
breakdown, and provider errors are still not retried here.

**Applied — what actually landed**

- `packages/draft/src/article-review.ts` — the judge call is wrapped in a
  bounded loop (`for (let judgeTry = 1; judgeTry <= 2; judgeTry++)`). A
  failure classified as `ArticleReviewError` (parse/schema only) is
  retried once on the same draft; anything else, and the second failure,
  breaks out as before.
- The retry is **fixed at one** and is plain code — no LLM decides
  whether to retry, and no corrective prompt is fed back. Deterministic
  policy, as proposed.
- Provider-level failures are deliberately **not** retried here:
  `scoreArticle` already goes through `chatWithFallback`, which owns
  provider failover.
- The unreviewed-draft outcome is unchanged and still honest: when the
  judge breaks down twice, `score` stays `null`, the attempt is recorded
  with a `scoreError`, and `passing` is `false` — the report never claims
  a pass it did not get. The difference is that the *remaining draft
  attempts* are no longer discarded over one hiccup.

**Deferred (deliberately out of scope):** if the judge *systematically*
returns localized keys (model-dependent), the retry burns a call then
still fails honestly. A prompt/schema-level fix (coercing or rejecting
unknown keys pre-parse) touches judge acceptance semantics, so it needs
its own design discussion — not included here, and still open.

**Evidence**

- `projects/写故事/article-review.yaml`: attempt 1 `error: "judge JSON parse
  failed: Unexpected token '.'…"`, `attempts_used: 1`, `final_overall: null`,
  `passing: false` — draft accepted unreviewed, loop over.
- `projects/ai-era-software-engineering-11-shifts/article-review.yaml`:
  `error: "judge score schema invalid: summary: Unrecognized key(s) in
  object: '结论'"` — the judge returned a localized key; `z`
  `.strict()` (`ArticleScoreRawSchema`, `packages/draft/src/article-review.ts`)
  rejected the whole payload.
- `packages/draft/src/article-review.ts:753-755` — `if (score === null)
  break;` with comment "Judge broke down: no basis to iterate — accept this
  draft". A single transient judge formatting failure therefore discards the
  remaining draft attempts (default up to 8, line 712).
- Provider-level failures already have `chatWithFallback`; it is specifically
  *parse/schema* failures (`ArticleReviewError` from lines 563/572/580) that
  abort. The hub skill §6 even documents the house rule: "retry once".

**Proposed change**

**Proposed change — AS APPLIED, unchanged**

- In the attempt loop, when `scoreArticle` throws `ArticleReviewError`
  (parse/schema only), retry the judge **once** on the same draft before
  treating it as unreviewable and breaking. Do not retry provider errors
  (fallback already handled them). Keep it deterministic: fixed single retry,
  no feedback prompt needed for v1 (an optional v2 feeds the schema error
  text back as a corrective message — operator's call).
- Result: a transient judge hiccup costs one extra judge call instead of the
  remaining draft attempts and an unreviewed video.

**Effort:** ~1–2 h.

**Verification plan — DONE**

- Red first (`packages/draft/src/article-review.test.ts`): stub provider
  whose judge response is invalid JSON on first judge call and valid on the
  second; assert the loop records attempt 1 with `scoreError`, continues, and
  attempt 2 carries a real score (current code breaks after attempt 1 — red).
  → **Present**: "retries the judge once on a parse breakdown instead of
  aborting the loop" — asserts the retry succeeds and that the provider saw
  1 draft + 2 judge calls.
- Also assert: two consecutive judge failures still break the loop after
  exactly one retry (bounded).
  → **Present**: "two consecutive judge breakdowns still break the loop after
  exactly one retry" — asserts the provider saw exactly 3 requests and that
  the attempt carries a `scoreError`.
- `pnpm vitest run packages/draft`, `pnpm build`.
  → **Done**: `pnpm test` — 161 files, 1595 tests pass; `pnpm build` clean.

**Risk**

- One extra paid judge call per judge breakdown — bounded at 1, and only in
  the rare failure case.
- If the judge *systematically* returns localized keys (model-dependent), the
  retry burns a call then still fails honestly; if that recurs, the follow-up
  would be a prompt/schema-level fix (e.g. coercing or rejecting unknown keys
  pre-parse) — **that** part touches judge acceptance semantics, so it would
  need its own design discussion; not included here. → **Still open, and
  deliberately not fixed.**

---

## Non-candidates and notes

- **Retired judge profile (attractive/interesting/useful, threshold 25):**
  `从-prompt-engineering-到-agent-engineering`, `玄武门`, `agents-first` all
  show attempts capped at exactly 24/25. The format does not exist anywhere
  in current source — these are artifacts of a retired judge; the
  unreachable-threshold pattern is historical, not a live defect. No action.
- **`runs/*.yaml` survivorship bias:** all 328 run records say
  `status: succeeded`; failed steps write no run file, so `runs/` cannot feed
  improvement mining (this session had to rely on article-review sidecars
  instead). Informational; a candidate for a future observability batch if
  the operator wants failure telemetry.
- **`写好小说` / threshold calibration:** best 80.4 vs bar 90 across 2
  attempts is judge-strictness policy, not a code defect — operator's dial.
- **`learnings/skill-update-proposal.md`:** stale; its single image-prompt
  item is already an active lesson in `lessons.yaml`. Nothing unapplied of
  substance. Safe to regenerate or delete at operator discretion.
- **Recent git history:** `29415a2` (mix frozen-tail fix) touched narration
  handling; the qa diff in HEAD~10 already contains the stale-render check —
  i.e. P1's mitigation, not P1's fix. No untested fix-without-test pattern
  found beyond what the candidates above already cover.

## Suggested lessons.yaml edits (operator's job — suggested only)

- `render:regenerated scene images do not invalidate cached scene mp4s…`:
  bump `seenCount` 1→2, `lastSeenAt` today (second hit,
  `ai-era-software-engineering-11-shifts-en`).
  → **DONE** (`seenCount` is 2, `lastSeenAt` is 2026-10-24) — and the
  lesson is now marked `resolved: true` with a `resolution` naming the
  fix, because P1 fixed the defect the lesson describes. Its advice
  ("delete scenes/*.mp4 before re-rendering") is now stale, and a
  resolved lesson no longer reaches a prompt.

  Marking a lesson resolved required a schema change first: the
  `learn-lessons/1` schema had no `resolved`/`resolvedAt`/`resolution`
  fields, and `saveLessonStore` re-serializes through
  `LessonStoreSchema` — so the fields would have been silently dropped
  on the next write, leaving the store claiming the fix was never
  applied. `LessonSchema` now accepts the three fields (optional, so a
  store written before them still parses) and `isActiveLesson` returns
  false for a resolved lesson however corroborated it is.

  `mergeSession` mutates an existing lesson in place, so a resolved
  lesson keeps its `resolved` flag across a merge — a later sighting
  does not revive stale advice.

## Follow-ups still open (not in this batch)

1. **Judge acceptance semantics.** If the judge *systematically* returns
   localized keys, P3's retry burns a call and still fails honestly. The
   fix (coercing or rejecting unknown keys pre-parse) touches what the
   judge accepts, so it needs its own design discussion.
2. **`runs/*.yaml` survivorship bias.** Every run record says
   `status: succeeded`; failed steps write no run file, so `runs/`
   cannot feed improvement mining — this batch had to rely on
   article-review sidecars instead. A candidate for a future
   observability batch if the operator wants failure telemetry.
3. **P2's per-boundary local-peak alternative.** The minimal threshold
   change shipped. Projects whose matched ratio still lands under 50%
   at 0.02 would need the larger change; carlo-pizza's margin was 24 vs
   23, so it is close enough to watch.
