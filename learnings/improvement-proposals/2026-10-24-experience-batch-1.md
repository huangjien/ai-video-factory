# Improvement proposals — batch 2026-10-24 (PROPOSE mode, nothing applied)

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

**Status: `needs-human-design`** — it extends the documented scene-cache
contract (sidecar schema + freshness terms). Note the contract itself
pre-announces this exact fix: the skill's cache table says "until the key
includes an image digest, force re-renders with `rm scenes/*.mp4`". So this
is design *sign-off*, not open design.

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

**Proposed change (minimal)**

- `packages/qa/src/checks.ts:322`: `gte(scene,0.4)` → `gte(scene,0.02)`,
  with a comment stating the measured basis (illustration-to-illustration
  cuts score 0.01–0.02; camera footage was the old calibration).
- Larger alternative if the operator prefers robustness over a one-liner:
  replace the global threshold with per-boundary local-peak matching (a cut
  "counts" if the max scene score within ±0.5 s of the expected start is a
  local maximum above a small floor). ~1 day, more test surface. The minimal
  change is recommended first; it is monotone-safe (extra detections never
  reduce `matched`, the gate only needs ≥50% of boundaries matched).

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

- In the attempt loop, when `scoreArticle` throws `ArticleReviewError`
  (parse/schema only), retry the judge **once** on the same draft before
  treating it as unreviewable and breaking. Do not retry provider errors
  (fallback already handled them). Keep it deterministic: fixed single retry,
  no feedback prompt needed for v1 (an optional v2 feeds the schema error
  text back as a corrective message — operator's call).
- Result: a transient judge hiccup costs one extra judge call instead of the
  remaining draft attempts and an unreviewed video.

**Effort:** ~1–2 h.

**Verification plan**

- Red first (`packages/draft/src/article-review.test.ts`): stub provider
  whose judge response is invalid JSON on first judge call and valid on the
  second; assert the loop records attempt 1 with `scoreError`, continues, and
  attempt 2 carries a real score (current code breaks after attempt 1 — red).
- Also assert: two consecutive judge failures still break the loop after
  exactly one retry (bounded).
- `pnpm vitest run packages/draft`, `pnpm build`.

**Risk**

- One extra paid judge call per judge breakdown — bounded at 1, and only in
  the rare failure case.
- If the judge *systematically* returns localized keys (model-dependent), the
  retry burns a call then still fails honestly; if that recurs, the follow-up
  would be a prompt/schema-level fix (e.g. coercing or rejecting unknown keys
  pre-parse) — **that** part touches judge acceptance semantics, so it would
  need its own design discussion; not included here.

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
