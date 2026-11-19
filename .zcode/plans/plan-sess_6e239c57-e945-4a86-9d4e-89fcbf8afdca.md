# Historical picture retrieval for scene images

## Context

Today `video make` / `video visuals` paints every scene with a text-to-image model. For a history film (玄武门, 鸿门宴, 唐) that means an AI approximation of a real person, battle, or artifact — often wrong, always synthetic, never traceable.

Wikimedia Commons, Wikipedia, and the museum open-access APIs hold PD/CC0 paintings, portraits, photographs and maps of exactly these subjects. The repo already has every moving part except the retrieval layer: an LLM brief step, reference-image support in MiniMax H3, content-keyed image caching, a license sidecar convention (BGM's `assets/bgm/<tag>.license.txt`), and a `--dry-run` impact table that predicts spend.

Outcome: before a scene image is generated, the pipeline looks for an authentic freely-licensed historical picture for that scene. An artifact/portrait scene uses the real picture as the frame; a scene needing a composed shot (battle, mood) feeds the picture to the image model as a reference so the composition stays in the film's art style. Every borrowed picture is recorded with author, license and source URL.

## Decisions (confirmed with you)

| Decision | Value |
|---|---|
| Use mode | per scene: `direct` / `reference` / `none` |
| Sources | Wikimedia Commons · Wikipedia article images · on-disk project artifacts · Met / Smithsonian / Openverse |
| Scope | only scenes the plan marks historical → zero network for non-history films |
| License | strict allowlist: PD*, CC0, PDM — no attribution-only licenses |
| Toggle | frontmatter `historical_images` + `--image-sources auto\|off` (default `auto`) |

## New package `@video/image-sources` — `packages/image-sources/`

| File | Responsibility |
|---|---|
| `src/types.ts` | `HistoricalCandidate`, `PictureSource`, `SceneSourcePlan`, `SourceMode` |
| `src/license.ts` | `normalizeLicense`, `isFreeLicense`, `FREE_LICENSE_CODES` |
| `src/sources/commons.ts` | MediaWiki `generator=search` + `imageinfo` + `extmetadata` → candidates |
| `src/sources/wikipedia.ts` | REST `/page/summary/<title>` → lead image → candidate (license resolved via Commons) |
| `src/sources/artifacts.ts` | on-disk scan: character ref sheets (`assets/characters/<id>/refs/<style>/vN.jpg`), earlier `assets/images/scene_*.jpg`, project `research/figures/*` |
| `src/sources/museum.ts` | Met (`isPublicDomain` + `primaryImage`), Smithsonian (CC0 flag), Openverse (`license=cc0,pdm`) |
| `src/retrieve.ts` | fan out over enabled sources, filter by license, dedupe, pick best, download bytes |
| `src/plan.ts` | one LLM call per article → per-scene `{historical, query, mode, reason}` via `callStructuredAgent` (`packages/llm/src/structured-agent.ts`) |
| `src/attribution.ts` | write `assets/images/scene_N.source.json` + `assets/images/ATTRIBUTION.md` |
| `src/image-io.ts` | Pillow convert-to-JPEG + long-edge cap (reuses `resolvePythonDir` from `packages/media-generators/src/contact-sheet.ts`) |

Prompt body: `packages/prompts/prompts/image-source-plan.md` (central prompt registry convention).

## Integration

Files: `packages/make/src/index.ts` (`generateSceneVisuals`), `packages/make/src/visual-cache.ts`, `packages/make/src/impact.ts`, `packages/cli/src/make-command.ts`, `packages/cli/src/visuals-command.ts`, `packages/draft/src/schemas.ts` (frontmatter), `packages/draft/src/image-prompt.ts` (reference note in the brief), `packages/media-generators/src/image.ts` (`supportsReferences` on `ImageProvider`).

Flow inside `generateSceneVisuals`, before the scene pool:

1. **Plan** — one LLM call for the whole article: which scenes are historical, the search query per scene, the mode. Failure → the feature switches itself off and the run continues exactly as today.
2. **Retrieve** — for each historical scene, fan out over the enabled sources in parallel, keep only free-license candidates, pick the best, download the bytes (cap 25 MB). No candidate → plain generation, never a failure.
3. **Apply**
   - `direct` → the fetched bytes become `assets/images/scene_N.jpg` (Pillow → JPEG, long edge ≤ 1920). Zero AI spend for that scene.
   - `reference` → bytes go into `ImageRequest.referenceImages`. `generateWithChain` skips providers without reference support, so MiniMax H3 serves the scene; if no provider in the chain supports references, the reference is dropped and the log says so. Note: H3 edits bill image-in tokens, so a reference scene costs more than a plain t2i scene at the same size — `direct` is the cheap path.
   - `none` → unchanged behaviour.
   - Ladder: `direct` with no candidate → `reference` with any candidate → `none`.
4. **Brief** — in `reference` mode the expanded brief gains one line naming the reference. New optional `referenceNote` on `ScenePromptContext`, spliced in `buildScenePromptMessages` (`packages/draft/src/image-prompt.ts:171`).

## Cache, gate, attribution

- `ImageCacheKeyInput` gains `sourceDigest`: `""` (no source), `direct:<sha256 of image bytes>`, `ref:<sha256 of candidate url + license>`. A changed source invalidates the scene image exactly like a changed `visual:` line does.
- `packages/make/src/impact.ts` (the `--dry-run` table) stays offline — it reads the recorded digest from `scene_N.source.json` instead of re-retrieving.
- `scene_N.source.json` — `{schema, mode, source, title, author, license, license_url, page_url, file_url, retrieved_at, sha256}`.
- `assets/images/ATTRIBUTION.md` — one row per borrowed picture, rewritten at the end of the run.
- The make report prints the BGM-license line shape: `assets/images/scene_7.jpg (Wikimedia Commons, Public domain, "Portrait of Li Shimin")`.

## Failure policy — nothing here breaks a run

No LLM / no API key → no plan, no retrieval, today's behaviour. A source times out or 500s → that source is skipped, the others still answer. No free-license candidate → plain generation. Download fails → plain generation. Every case is a logged line, never an exception out of `generateSceneVisuals`.

## Tests

`packages/image-sources/src/*.test.ts` — license normalisation + allowlist; Commons response parsing (stubbed fetch); Wikipedia summary parsing; museum parsing; artifact scan over a temp dir; plan YAML parsing; the direct→reference→none ladder; attribution writer; cache-key change when the source digest changes.

`packages/make/src/` — integration with a fake provider: `direct` writes the fetched bytes to `scene_N.jpg` plus the source sidecar; `reference` hands `referenceImages` to the provider; a provider without reference support is skipped in the chain.

Run: `pnpm --filter @video/image-sources test`, `pnpm --filter @video/make test`, then the repo suite `pnpm test`.

## Docs

- `.agents/skills/video/SKILL.md` — new section "Historical picture retrieval" (modes, sources, license rule, toggle).
- `packages/prompts/prompts/image-source-plan.md` — the plan prompt.
- `docs/` — one short note in the existing plan-doc folder.

## Out of scope (deliberately not in this change)

- No new provider — MiniMax H3 already does references.
- No change to the caption / bake-text pipeline (baked titles still work on a directly-used picture).
- No SVG support, no colour-grading of borrowed pictures to match the film style.
- The character bible stays text-anchored for scene art; on-disk artifacts are used as *reference* pictures, not as a replacement for the anchor mechanism.

## Verification

1. `pnpm build` — the new package compiles and the workspace links.
2. `pnpm test` — full suite green against the repo's own thresholds.
3. Live check on an existing history project: `node packages/cli/dist/index.js visuals 玄武门 --image-sources auto` — expect `scene_N.source.json` for the historical scenes, an `ATTRIBUTION.md`, and modern/abstract scenes marked non-historical (no network for them).
4. Open one Commons file page and confirm the recorded author + license match.
5. `node packages/cli/dist/index.js make 玄武门 --dry-run` — the impact table still predicts spend correctly with the new `sourceDigest` term.