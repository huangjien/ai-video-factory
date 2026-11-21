# Public-domain video scenes — design note

**Date:** 2026-11-21
**Status:** draft (for approval)
**Package:** `@video/video-sources` (new), `@video/video-components`, `@video/vdsl`,
`@video/make`, `@video/cli`
**Follows:** [2026-11-19-historical-picture-retrieval-design.md](./2026-11-19-historical-picture-retrieval-design.md)
— the same license gate, the same plan→retrieve→resolve flow, the same
attribution discipline, applied to moving pictures.

---

## The problem

Scenes are rendered from stills only: `assets/images/scene_N.jpg` under
`ImageBackground` with Ken-Burns motion. For history films (军事史选题 is
most of the backlog) the archives also hold the *footage* — newsreels,
campaign records, ship and aircraft films. A real moving image carries
evidence a generated still cannot. The ask: use public-domain video in
some scenes, with the same "no copyright problem" guarantee as the
historical pictures.

## The decision

| Choice | Value | Why |
|---|---|---|
| License gate | identical to pictures: **PD / CC0 / PDM only** | same policy the user set for pictures; a video credit line is a credit line nobody maintains either |
| Primary source | Wikimedia Commons `filetype:video` | machine-readable `extmetadata` license per file — the guarantee comes from the file record, same as `commons.ts` for pictures |
| Scope | only scenes a plan marks "footage-suitable"; cap ≤ 5 per film | archival grain against clean generated art is a strong contrast; it should read as deliberate evidence, not noise |
| Placement | background only (`VideoBackground`), narration/BGM/captions unchanged | clip audio is stripped; scene audio rules don't change |
| Mode flag | `--video-sources on\|off`, **default `off`** until the first live run is reviewed; article frontmatter `video-sources: on` opts a project in | mirrors `--image-sources`, but new features stay opt-in until proven |

Rejected: archive.org auto-retrieval in v1 (license records are prose,
not fields — cannot gate mechanically); CC-BY video (same reason as
CC-BY pictures); modern military/broadcast footage (CCTV, 军网, 国防部 —
copyrighted, and the license filter rejects them anyway).

## The flow

```
article.md ──▶ PLAN-V (1 LLM call, whole article)
                   │  per scene: footage-suitable? subject? query? why?
                   ▼
              RETRIEVE (only marked scenes; Commons filetype:video)
                   │  ↓ free-license filter (PD/CC0/PDM)
                   │  ↓ size cap, duration ≥ scene duration
                   ▼
              PREPROCESS (ffmpeg, deterministic)
                   │  cover-crop 1080×1920 · strip audio · 30fps
                   │  h264 yuv420p · trim to scene duration
                   ▼
              RESOLVE ──▶ assets/video/scene_N.mp4 + scene_N.source.yaml
                   │       (+ row in ATTRIBUTION.md)
                   ▼
              RENDER: scene binds VideoBackground instead of ImageBackground
                   (captions, scrim, brand overlays unchanged)
```

Every step allowed to fail, same rule as image-sources: a failure turns
the feature off for this run and the film renders exactly as before.

## The pieces

### 1. `VideoBackground` component (`packages/video-components`)

Modeled on `ImageBackground.tsx`, contract differences called out:

- Remotion `<OffthreadVideo src={videoSrc} muted />` behind the
  existing scrim/caption machinery (reuse, do not fork `captionStyle`).
  No `loop` prop in this Remotion version — preprocess trims each clip
  to the scene's duration, so looping is unnecessary by construction.
- `videoSrc` resolves via Remotion `staticFile()` — **not** the data-URL
  contract `ImageBackground` uses (data URLs are for stills the headless
  browser paints; video must be served by the bundler's public dir).
  The render step copies `assets/video/scene_N.mp4` into the Remotion
  project's `public/` before render.
- No Ken-Burns (the footage already moves). Optional `fit: "cover"`,
  `scrim: true` inherited from the scene's `background:` block.
- Registered in REGISTRY with its props schema, renderer `remotion`.

### 2. Asset convention + binding (`packages/vdsl`, `packages/draft`)

- Convention: `assets/video/scene_N.mp4` next to the existing
  `assets/images/scene_N.jpg`.
- Binding rule mirrors the image rule (schema comment at
  `packages/vdsl/src/schema.ts:672`): when the file exists, the compiled
  plan switches that scene's background to `VideoBackground` and the
  image-generation step skips it (the still stays on disk, unused —
  cheap and keeps the fallback intact).
- The asset `type: "video"` enum value already exists
  (`ASSET_TYPE_CANONICAL`, schema.ts:495); the storyboard `assets:`
  block lists it with `source: "external"`.

### 3. Preprocessing (`@video/video-sources/preprocess.ts`)

Deterministic ffmpeg, one function, no LLM:

- input: any PD clip (typically 4:3 landscape, grainy, 24–30fps)
- output: `1080×1920` center-cover crop, `-an` (audio stripped),
  `30fps`, `libx264 crf 20 yuv420p`, trimmed to the scene's rendered
  duration (from `readSceneTimings`, the same synced source the audio
  path uses), `-movflags +faststart`
- a `--fit contain` variant (blur-pad) is deliberately **not** built in
  v1 — see Risks.

### 4. Retrieval (`@video/video-sources/sources/commons.ts`)

Clone of `packages/image-sources/src/sources/commons.ts` with:

- `gsrsearch: <terms> filetype:video`, `gsrnamespace=6`,
  `prop=imageinfo&iiprop=url|size|extmetadata|mediatype`
- candidate filter: `mediatype === "video"`, license normalizes to
  PD/CC0/PDM via the existing `normalizeLicense` (vocabulary is the
  same `extmetadata` fields), duration ≥ scene duration, file size
  cap (200 MB download ceiling, `MAX_DOWNLOAD_BYTES` analogue)
- scoring: same shape as `scoreCandidate` (resolution, query-term
  overlap) minus image-specific signals

### 5. Plan / match prompts (`@video/video-sources/plan.ts`, `match.ts`)

- PLAN-V asks per scene: is this scene about a real event/person/
  machine that archival film plausibly documents? propose a Commons
  query. Cap: at most 5 scenes per film, prefer the 2–3 strongest.
- MATCH re-checks the returned candidates against the scene subject
  (same second-LLM-call pattern as picture matching) — a wrong subject
  on screen is worse than a generated still.

### 6. Attribution (same schema, new media type)

`scene-source/1` sidecar (from
`packages/image-sources/src/attribution.ts`) reused verbatim with
`source: "commons-video"`; sidecar at
`assets/video/scene_N.source.yaml`; rows appended to the same project
`ATTRIBUTION.md`. Without the sidecar the validator rejects the scene.

### 7. Orchestration (`packages/make/src/video-sources.ts`)

Mirror of `image-sources.ts`: PLAN-V → RETRIEVE → PREPROCESS → RESOLVE,
`planCacheKey`/`source-plan-cache` reuse, `--video-sources on|off` flag
+ frontmatter resolution (`resolveVideoSourcesMode` — same tolerant
parsing), run record per stage in `runs/`.

### 8. Validation (`packages/vdsl/src/validate-project.ts`)

For every `assets/video/scene_N.mp4`: file exists; ffprobe reports
1080×1920, no audio stream, duration ≥ scene duration − 0.5s; sidecar
present with a free license. Failure = error-level finding (blocks
render), same as missing images.

## Task breakdown

Each task lands with tests and a green `pnpm build`. Order = dependency
order; the minimal hand-placed-clip demo is T1–T4.

- [x] **VS-01 — `VideoBackground` component + registry entry**
  Files: `packages/video-components/src/components/VideoBackground.tsx`,
  `registry.ts`. Scrim + caption reuse; `staticFile` src; no Ken-Burns.
  Done when: registry test validates props; render test in
  `components.test.tsx` pattern mounts one frame from a fixture mp4.
  (~2h)
- [x] **VS-02 — render-side public-dir plumbing**
  Files: wherever `renderPlanToVideo` resolves scene assets (draft/render
  path), copy `assets/video/scene_N.mp4` → Remotion `public/`, pass
  `videoSrc`. Done when: a test render of a one-scene plan with a
  fixture mp4 produces frames visibly differing from the image path.
  (~2h)
- [x] **VS-03 — compile/plan binding rule**
  Files: `packages/vdsl/src/compile.ts` (background resolution next to
  the image bind), schema docs. Done when: compile test — scene with
  `assets/video/scene_N.mp4` yields `component: VideoBackground`; scene
  without stays `ImageBackground`. (~2h)
- [x] **VS-04 — preprocessing module**
  Files: new `packages/video-sources/src/preprocess.ts` + tests.
  Done when: fixture clip → ffprobe asserts 1080×1920, no audio, 30fps,
  duration within ±0.5s of target. (~2h)
- [x] **VS-05 — Commons video source**
  Files: `packages/video-sources/src/sources/commons.ts` + fixture-test.
  Done when: fixture payload parses to candidates with license/duration;
  non-free candidates filtered. (~3h)
- [x] **VS-06 — attribution sidecar + ATTRIBUTION.md writer**
  Files: `packages/video-sources/src/attribution.ts`. Done when:
  sidecar matches `scene-source/1` schema fields; unit test. (~1h)
- [x] **VS-07 — PLAN-V / MATCH prompts + plan cache**
  Files: `packages/video-sources/src/plan.ts`, `match.ts`,
  `packages/make/src/video-source-plan-cache.ts`. Done when: fixture
  LLM responses normalize to plans; cap ≤5 enforced; cache round-trips.
  (~3h)
- [x] **VS-08 — make orchestration + CLI flag**
  Files: `packages/make/src/video-sources.ts`, `packages/cli/src/make-command.ts`.
  Done when: integration test with stubbed source + mock provider
  (pattern: `packages/make/src/image-sources.test.ts`) — failure at any
  step degrades to plain render; `--video-sources` + frontmatter
  resolution covered. (~4h)
- [x] **VS-09 — validator checks**
  Files: `packages/vdsl/src/validate-project.ts` + tests. Done when:
  missing/oversized/audio-bearing/unattributed clip = error finding.
  (~2h)
- [x] **VS-10 — docs**
  Files: `.omp/skills/video/SKILL.md` (rendering reference),
  `docs/plans/index.md` pointer, CLI help text. Done when: skill
  documents `--video-sources`, the asset convention, and the license
  policy. (~1h)
- [x] **VS-11 — live soak on one film**
  Pick 假想敌部队 (military history, strongest archival fit): run
  `make --video-sources on` for real, human-review the ≤5 scenes.
  Done when: one shipped film carries PD footage with attribution rows;
  run records in `runs/`. (~2h incl. review)

### M1 findings (2026-11-21, shipped)

- This Remotion version's `OffthreadVideo` has **no `loop` prop** — preprocess
  trims each clip to the scene duration instead (by construction, the clip
  never runs out mid-scene).
- Remotion's bundler defaults `publicDir` to the **process cwd** (`<remotionRoot>/public`),
  not the entry dir — `renderPlanToVideo` now passes `publicDir` explicitly and
  the entry template sets `window.remotion_staticBase = "/public"` (staticFile
  resolves against it). Without both, `OffthreadVideo` 404s at bundle-root paths.
- The image binding lives render-side (`resolveImageSources` in
  `packages/video-renderer/src/render.ts`), not in `vdsl/compile.ts` — the video
  binding went to the same place (`findSceneVideo` mirrors `findSceneImage`).

### M2 notes (2026-11-21, shipped)

- Attribution sidecars are `.json` (`scene_N.source.json`, schema
  `scene-video-source/1`) — same format family as the picture sidecars;
  the design text above said `.yaml`, the sibling package's convention won.
- `resolveSceneVideo` carries a named `SceneVideoPick` type; the
  resolution record carries the ORIGINAL bytes' sha256 (download fingerprint)
  as a field, not parsed out of the run-log note.
- Prompts: `packages/prompts/prompts/video-source-plan.md` (≤5 scenes,
  footage-existence test) and `video-source-match.md` (era/subject check,
  -1 = none).
- Plan cache: `assets/video/video-source-plan.yaml`, schema
  `video-source-plan/1`, key = the planner's inputs (same discipline as
  the picture plan).
- Make wiring: `--video-sources on|off` (default off, frontmatter
  `video_sources:`), runs inside `generateSceneVisuals` before the image
  loop; scenes with a clip skip image generation entirely.

### VS-11 live-soak findings (2026-11-21, two films)

- **假想敌部队** (18 scenes): PLAN-V planned 1 scene ("USAF aggressor
  squadron" — well-reasoned); Commons had nothing usable → clean degrade.
  **航母拦阻着舰** (15 scenes): PLAN-V planned 4 scenes, all real and
  specific (2016 Eisenhower E-2D cable failure, 1981 Nimitz EA-6B crash,
  2022 Vinson F-35C crash) — Commons video had none of them (US Navy
  footage lives on DVIDS/navy.mil, not Commons; Commons holds the
  photos). Both runs degraded exactly as designed; no crash, no spend
  beyond the plan call.
- **Coverage gap confirmed, and one ladder gap found**: the planned query
  "carrier arrestment landing" (jargon) found nothing, while plain
  "carrier landing" returns several PD clips (F-35C first landing,
  X-47B arrested landing, Carrier Airwing Five FCLP). Future work: the
  video ladder should append the de-jargonised phrase (drop the noun
  modifier) — not built here.
- **Acceptance met by the hand-placed path**: the 2016 E-2 cable-snap USN
  clip (PD, 14.7 s) was placed on the cable-snap scene (scene-08) via the
  M1 path: preprocessed (1080×1920, silent, 13 s), sidecar + attribution
  row written, `video validate` clean, re-rendered. The rendered frame is
  pixel-identical to the preprocessed clip (mean channel diff 0.0), and
  the pre-clip render differs by 51.8 — the clip is on screen.
- **Cache fix shipped during the soak**: placing a clip did NOT
  invalidate the cached scene mp4 (the sidecar had no clip term — the
  "lying dry-run" incident class again). `clipHash` is now a cache term
  on both sides (renderer + offline dry-run), with the usual one-time
  invalidation for legacy sidecars.
- Side observation (pre-existing feature, not this one): re-running
  `video make` regenerated several historical PICTURES again ("stale
  image (visual/style changed)") — same-prompt churn the picture cache
  was supposed to have fixed; separate issue.

## Sequencing

| Slice | Tasks | Result |
|---|---|---|
| M1 minimal (hand-placed clip) | VS-01–VS-04 | a hand-downloaded PD clip renders as a scene background — proves the render path |
| M2 automated retrieval | VS-05–VS-08 | `--video-sources on` end to end |
| M3 guardrails + ship | VS-09–VS-11 | validated, documented, soaked |

## Risks

- **Commons video coverage is thin for Chinese military topics.** Most
  usable footage is PD-US/PD-China newsreel-era. If PLAN-V finds no
  suitable scene, the feature costs one cheap LLM call and nothing
  else — acceptable. Do not loosen the license gate to fix this.
- **Aesthetic clash** (grain, 4:3 content in a 9:16 cover-crop): the
  ≤5-scene cap, scrim, and the "evidence cut" framing are the
  mitigation; review at VS-11 decides whether a `contain`/blur-pad
  variant is ever needed (not built now).
- **Content-ID claims** occasionally hit even PD-US footage. The
  sidecar + ATTRIBUTION.md give the provenance needed to answer a
  claim; they are mandatory, not optional.
- **Render cost**: `<OffthreadVideo>` extracts frames per scene at
  render time — scenes are ≤16 s, fine; do not use video for
  long-running backgrounds.

## What is deliberately not here (v1)

- archive.org / Prelinger auto-retrieval (license records are prose)
- clip audio in the mix (narration + BGM stay the only audio)
- `contain`/blur-pad fit variant
- picture-in-picture / split-screen compositions
- douyin/shorts-specific cutdowns of footage scenes
