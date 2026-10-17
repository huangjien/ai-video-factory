# Project cleanup: remove dead code/tests, reconcile versions, fix stale docs

Policy set: version.ts → **0.9.0**; export sweep = **barrels + zero-importer symbols** (error classes and zod sub-schemas stay exported). All changes stay uncommitted; your in-flight learn/prompts/make-draft WIP files are only touched where listed as doc fixes.

## 1. Delete dead code (verified 0 importers)

| Target | Evidence |
|---|---|
| `packages/video-renderer/src/HelloRoot.tsx` | nothing imports it; the real Remotion entries are generated Root.tsx |
| `packages/video-renderer/scripts/render-hello.mjs` + `render:hello` script entries (root + video-renderer package.json) | bundles an entry with no `registerRoot` → composition "hello" can't resolve; broken v0.1 relic |
| `.claude/skills/flux-{asset-review,image-prompting,visual-consistency,2-klein-local-gen}` — 4 git-tracked dangling symlinks | targets deleted in 95a8086 |
| `packages/media-generators/python/__pycache__/flux_worker.cpython-312.pyc` (git-tracked) | source `flux_worker.py` deleted; `__pycache__` now gitignored but never `git rm`'d |
| `packages/media-generators/dist/lora-config.*` + `dist/flux-image.*` if present (local, gitignored) | stale build outputs of deleted sources |
| `packages/video-renderer/.studio/studio-live{,2,3}/` (local, gitignored) | untracked generated studio workspaces, regenerable via `video studio` |
| `packages/llm/src/laya.ts` `LAYA_DEFAULTS`… **no — keep** (tested) | — |

Also verify-then-delete: `packages/tts/src/edge-tts.ts` `mockEdgeTTSProvider` — explorer found 0 production callers (only tts.test.ts + edge-tts-provider.test.ts). I'll confirm `make --fake` doesn't route to it; if confirmed: delete + delete its two test blocks.

**Keep:** `scripts/render-visual-smoke.mjs` (referenced by your in-flight SKILL.md), `scripts/render-brand-smoke.mjs` (documented in INSTALLATION), all python sidecars, DoodleScene (still hand-reachable by design).

## 2. Barrel + export cleanup

- Remove from `src/index.ts` barrels, 0 cross-package importers: `extractYaml` re-exports in **research, agent-storyboard, script**; `ContentReviewSchema`/`VisualReviewSchema`/`TechnicalReviewSchema`/`ReviewVerdict` in **review** (keep the module-level exports — they compose `ReviewPackageSchema`).
- Delete outright: `ClaimStatusType` (research/schemas.ts — zero references anywhere).
- De-export (used inside module only, no test imports): `textUnits` (media/captions), `COMPONENT_ENTRANCE`, `EASING_RULES`, `ENTRANCE_MAX_SCENE_FRACTION` (motion/heuristics), `DEPENDENCY_MAP` (workflow/invalidation), `STATE_FILENAME` (workflow/project), `assertPlanRenderable`, `sweepRemotionTemp` (video-renderer/render), `DRAFT_COMPILE`, `renderScenesIncrementally` (video-renderer/pipeline), `sceneOpacityAtFrame`, `transitionFramesFor` (video-renderer/Root).
- Stays exported: all `*Error` classes, remaining zod sub-schemas (published-package API convention).

## 3. Version reconciliation

- `packages/cli/src/version.ts`: `"0.7.1"` → `"0.9.0"`; README headline "(v0.4)" → "(v0.9)". Tagging/RELEASES entries stay yours to cut.

## 4. Config consistency (fixes the stale-dist test class)

- Add missing root `tsconfig.json` references + `vitest.config.ts` aliases for `draft`, `make`, `audio-plan` (all other 21 packages are wired).

## 5. Doc fixes

**WRONG → fix:** README `ARCHITECTURE.md`→`architecture.md` (case; also CONTRIBUTING ×2), README EdgeTTSProvider blurb → Python sidecar (not `edge-tts-universal`), `warm-sunset` → `sunset-pop`, `## ## Audio Mixing/Assets/YouTube` headings, duplicate `## Principles` block, stale v0.2 framing line; CONTRIBUTING ffmpeg "4.x+" → "9.x", "same five commands" → four, pnpm 12.5.1 → 12.11.2, media-generators row +OpenAI/Gemini, llm row +LayaClient; INSTALLATION en+zh `ZH_VOICE/EN_VOICE` → `packages/make/src/tts-cache.ts`, `MUSIC_PROMPTS` pointer → `packages/prompts/prompts/music.json`, zh-CN "15 components" → 24; architecture.md header "v0.6.0" → v0.9 as-built.
**MISSING → add:** CONTRIBUTING + architecture.md package tables: `draft`, `make`, `learn`, `qa`, `motion`, `audio-plan`, `media` (+ `prompts` in architecture); README back-compat verb paragraph: `motion`, `qa`, `scene` (+ mention learn/prompts/studio/theme/laya/excalidraw); README one-paragraph pointer to the central prompt registry; `.opencode/command/video.md` verb table sync.
**Flux doc remnants:** `skills/INVENTORY.md` drop the 4 flux skill entries; remove the flux cross-reference lines in 5 skill SKILL.md files (explainer-video, motion-art-direction, shot-composition, motion-background, color-motion); `docs/v0.5-local-image-generation-plan.md` gets a SUPERSEDED banner like its flux sibling.
**SKILL.md (your WIP file — additive factual fixes only):** 25→24 components, youtube model default = glm, MUSIC_PROMPTS → music.json, §7 doc paths `docs/…` + case, add missing verbs to the command table, add v0.9 to shipped_versions.

## 6. Verification

1. `pnpm build` + `pnpm test` (130 files/994 tests baseline — expect fewer tests only where mockEdgeTTSProvider blocks are removed) + `pnpm lint` + prettier check.
2. `pnpm run docs:commands` after verb-table source edits; grep for zero remaining `flux`/`ARCHITECTURE.md`/`warm-sunset` hits.
3. `video --version` prints 0.9.0 from built dist.

Estimate: ~4 h. Nothing is committed; deletions of git-tracked files stage as working-tree deletions for your review.