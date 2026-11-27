# Release Notes

Each tagged release of the AI Video Factory. The full pipeline goes:

```
video research → script → storyboard → audio (TTS) → audio-asset (BGM+SFX)
            ↓
       (write audio-assets/mix.yaml: bgm, sfx per scene_N, fades)
            ↓
       video preview → video approve review → video final --mix → final-mixed.mp4
            ↓
       video thumbnail --provider minimax → real AI thumbnail
       video shorts --provider minimax    → real AI Shorts clip
       video youtube                         → YouTube publishing package
       video review                          → Content/Visual/Technical review YAMLs
```

## Unreleased — the public install: Apache-2.0, one bundled npm package

**Licence.** The repository is Apache-2.0 (`LICENSE`), and every package
manifest carries `license: "Apache-2.0"`.

**Model ids in one file.** Every model id the pipeline serves — chat,
decision, image, video, TTS — and the provider routing per role now live in
[`config/llm.yaml`](../config/llm.yaml). There are no built-in copies: the
thirteen hard-coded ids (and seven copies of a `modelFor` helper that
recorded every unknown provider as `MiniMax-M3`) are gone, and
`defaultModel(kind, provider)` reads the file. `LL_CONFIG` overrides only
the keys it names; on the API path a missing or blank id throws instead of
defaulting (a run record writes `unknown` rather than fail its step), and a
malformed file is reported with the offending key. The published bundle
ships the file under `assets/config/`.

**One package to install.** `scripts/build-bundle.mjs` inlines all 28
`@video/*` packages into a single ESM file (`cli.js`), keeps the ten
third-party dependencies external, vendors the runtime files the inlined
packages read from disk (the Remotion `Root.js`, the prompt bodies, the
python helpers, the prompt golden set), and drops compiled test files:
**1.3 MB packed, 237 files** — against 545 for the unbundled package.

```
pnpm run build:bundle     # tsc -b + esbuild → packages/cli/dist-bundle/
pnpm run pack:cli        # … + npm pack → video-cli-<version>.tgz
pnpm run publish:cli     # … + npm publish --access public
```

The npm scope is `@video` (unclaimed; first-come per package name).

Three runtime dependencies broke under bundling and are now dual-layout
(workspace **and** installed): the Remotion Root's absolute path, the
prompt bodies' directory, and the python helpers the pipeline shells out
to. Verified by installing the tarball into an empty directory and
rendering a real MP4 there.

Not in the published package: the curated BGM library (171 MB — use
`--bgm-dir`) and `video studio` (needs the source checkout).

**A night that finishes sooner.** The pipeline's own clock was the one
number nobody had: the run records carried per-call durations but no
stage trace, so a slow night could not be attributed. Four serial waits
now run in parallel, each measured on this machine:

| What | Before | After |
|---|---|---|
| Remotion bundle, 15 scenes (`RENDER_POOL=2`) | 137 s (a bundle per scene) | 98 s (built once, reused) |
| Narration, 15-scene article (181 s of speech) | 36.9 s | 10.5 s (four scenes at once) |
| The draft's two judge samples | 70 s of calls | 40 s of wall time |
| Fact checks, three `FACT_*` claims | 267 s of calls | 112 s of wall time |

The bundle is cached per entry-hash under `VIDEO_BUNDLE_CACHE`
(`off` forces a private bundle per scene), narration runs four at a time
for a remote provider and one at a time for a local model server
(`TTS_POOL` overrides both), and the draft's samples and fact checks are
requested together — the fact-check notes still reach the reviser in
claim order. Each stage of the auto producer now records its own wall
time, so the next slow night says where it went. Every fact-check call
writes a `draft-research` run record, failures included.

**One malformed line no longer loses a research answer.** A web page
title copied verbatim into a YAML value (`title: …的历史是什么？ :
r/AskHistorians`) leaves a plain scalar YAML cannot read — ": " ends a
scalar and starts a mapping — and the whole answer was lost: twice in
six research calls on 2026-11-25, each after two minutes of searching.
The shared YAML reader now quotes such a value and parses it again. The
repair runs only on text that already failed to parse, so no answer that
parsed before is read differently now.

**The judge ranks by what the audience valued, not only by what it
clicked.** `video analytics` (new) replaces the views-only Python script.
It pulls the public YouTube videos and the hundred most recent Bilibili
videos — views, likes, comments, and on Bilibili coins, favorites, shares
and danmaku — and writes `docs/analytics/<date>-report.md`, opening with
a ranked digest: which topic lanes lead and lag on each platform, which
lengths get watched, Shorts against long-form, Chinese against English,
and the videos few people saw but the ones who did valued. The backlog
judge reads that digest first and is told how to read it: engagement is
an appetite a lane has not reached yet; a topic is judged where it is
actually watched (on 2026-11-25: YouTube's views are Shorts, 33.8 against
0.2 views/day for long-form, and long-form lives on Bilibili); a video
younger than three days is a launch size, not a rate. The analysis is
pure and tested against the real catalogue, every platform reply is read
through a guard, and a pull that cannot run exits non-zero with the fix
in its message. Retention and subscribers need the YouTube Analytics API
enabled on the project — until then the report says so.

**The backlog now knows what the channel can feed.** `video analytics`
gained a supply side: it counts the open ideas per topic lane and sets
them against the channel's own numbers. On 2026-11-26 the gap was blunt —
Bilibili served 45 views a day for 神话比较 against a channel median of
0.6, and the backlog held one idea for it; 叙事思维与数学 held 43 ideas
and served 0.1 a day. The report says so in a section the judge never
reads: how many ideas are waiting is not evidence about any one of them.

`video backlog harvest` grew a second pass for exactly those lanes: one
call per under-supplied lane, up to three topics, marked `demand:<lane>`
with the evidence that asked for them in the note. The document pass
learned to order its candidates by the same evidence (the document still
decides what is possible; the evidence decides the order and the `why`).
Both passes land as `proposed` — a human still approves every idea, and
`--no-demand` turns the second pass off.

**A proposal reaches the drafter whole, and in the channel's register.**
The first demand-harvested episode showed two gaps on its way to the
screen. `video draft --from-backlog` read an entry's `content`, and a
harvested proposal carries a `note` and `anchors` instead — so the
drafter was handed the title alone. The context is now composed from the
note's premise and the anchors. And one premise, phrased as "three
bureaucracies of access control", pulled the drafter into a
distributed-systems explainer that the judge scored 81/100; both harvest
prompts now ask for the premise in the viewer's own words. The same
proposal drafted for a general audience scored 97.2/100 grade A on the
first attempt.

**Shorts are a publish step, not a question.** `video shorts --upload`
extracts the clip and uploads it to YouTube as a private Short; the
description comes from the film's own package. Before, the upload lived
only inside the auto-producer, so a Short by hand meant a hand-rolled
API call. The owner ruled on 2026-11-26 that Shorts ship by default in
both languages; the skill doc says so.

**The YouTube description's source list points at the work named.** The
packager was told to cite research URLs and given an article with none,
so it wrote links from memory — the Katha Upanishad's first chapter
linked to the Brihadaranyaka index. A link must now be the exact work,
and a named work without a link beats a wrong one.

**A draft knows who it is written for.** The drafter's default audience
is "developers" — right for the software lanes, wrong for the rest: a
mythology proposal drafted that way came back as an access-control
explainer (83/100), and the same proposal with the audience named scored
97/100. A demand proposal carries its lane, and each lane now names its
audience, so the auto-producer drafts a mythology episode for people who
watch mythology.

**The decision layer's measurement machinery is gone; the layer stays.**
An audit of the modules the pipeline actually reaches found the layer's
corpus side doing nothing for the pipeline: 371 labelled cases that
nothing read at runtime, a bench that measured the providers against
them, a harvest that turned disagreements into cases, and an audit
script. The bench's number was what justified switching the layer on,
so with the corpus gone that justification went with it — and the
decision layer keeps asking (default `on`), recording its answers
beside the deterministic baseline on every draft, QA report and caption
check. The rules the answers are held to stay (they are the runtime's,
in `packages/prompts/src/decision-policy.ts`), and so do the eight
prompts, one per surface. `video decision` keeps `inspect`; `bench`,
`harvest` and `backfill` are gone, and so is the retired `visual-class`
surface with them.

The same audit removed what nothing reached: `packages/draft/src/
visual-decision.ts` (the visual-classifier surface that never shipped),
ten scripts with no caller — one-off per-film visual rewrites, the old
manual Shorts upload path that `video shorts --upload` replaced — and
the candidate machinery that fed the corpus.

## v0.12 (2026-11-16) — the decision layer, the 2.6 image provider, and two films

Three things shipped together:

1. **The decision layer, everywhere it fits.** It had a contract
   (`choice` / `score` / `noul` with a confidence) and two wired
   surfaces. This release wires three more, fills in the bench's missing
   cost column, and **measures two candidates into cancellation** before
   writing a line of surface code for them.
2. **The OpenAI image provider moves to `gpt-image-2.6-flare`**, measured
   against MiniMax `image-01` on a real shipped scene prompt (same
   prompt, same minute, `scripts/measure-image-providers.mjs`):

   | provider | wall clock | cost/image | prompt fidelity |
   |---|---|---|---|
   | minimax image-01 | 17.2 s | $0.0196 | atmosphere, but the diagram it was asked for was unreadable |
   | **gpt-image-2.6-flare `low`** | **8.1 s** | **$0.0203** | followed the prompt's two-part structure and drew a legible diagram |
   | gpt-image-2.6-flare `medium` | 8.6 s | $0.0357 | same structure, cleaner glyphs |
   | gpt-image-2.6-sunburst `medium` | 41.7 s | $0.0357 | same price, 4× slower |

   `low` costs what image-01 costs, renders twice as fast, and is the
   only one of the three that drew the diagram the prompt asked for. 2.6
   also takes custom dimensions, so the provider now asks for the
   composition size itself (1920×1088 for 16:9) instead of snapping to
   the 1536×1024 recommended set and letting the renderer crop. The 2.5
   models stay reachable through `defaultModel`.
3. **Two films** — 《孙子兵法的数学原理》 (zh) and The Hidden Mathematics
   of Sun Tzu (en) — re-shot on the new provider and published.

**The bench can rank providers now.** `packages/prompts/decisions/prices.yaml`
was empty, so every cost column read `n/a` and the ranking rule never
reached its tiebreaker. The prices are now filled from each provider's own
pricing page (read 2026-11-16): `gpt-6-luna` $0.10/M input · $0.50/M
output, `MiniMax-M3.1-Flash` $0.15/M · $0.60/M — **$0.000050 per
decision** for the OpenAI provider. A full re-run of the corpus measured
**174/187 = 0.930**, brier **0.000**, p50 210 ms, p95 488 ms; the shipped
release note's 0.924 is corrected to the 0.930 that §7.5's table and the
re-run agree on.

**Three new surfaces, all advisory.** Each one is consulted, logged to
`<project>/decision-log.jsonl` beside a deterministic baseline, and
**never acts** — the pipeline's output is byte-identical with the layer
on and off.

| surface | where | measured (live API, 2026-11-16) |
|---|---|---|
| `caption-overlap` | `video qa` | 68/68 = **1.000**, brier **0.000** — including the two documented failures the deterministic caption check misses. |
| `review-verdict` | `video review` | 27/27 = **1.000** against the review agent's own per-section verdict, where the field-status rule scores 0.926. |

The `motion-prescreen` surface was wired, measured at chance (**47/92 =
0.511** on a balanced corpus from 26 shipped storyboards — the label says
which elements the shipped plan animates, and those are renderer-internal
ids the model cannot see) and **retired**: it is not wired into any
command and it does not gate the provider choice. The bench now gates over
the ACTIVE surfaces and compares the baseline **per surface**, so a
retired surface cannot drag the corpus-wide gate down. Over the active
surfaces the OpenAI provider measures **265/278 = 0.953** and stays
eligible.

**Two candidates measured into cancellation.** The image-brief skip
(`scripts/measure-image-brief-expansion.mjs`): the shipped `visual:`
lines are already concrete prose (median 104 characters over 1189
scenes) and the expander's real job is to translate and structure them
into the six-part English brief — there is no bare-category population
to skip, so the surface has no corpus. The article judge's per-dimension
score (`scripts/measure-judge-dimension-scores.mjs`): a `score` decision
agrees with the judge's own numbers (mean absolute error **0.366** on the
0–5 scale, 53/56 within one point) but cannot replace the judge (it also
returns findings and risk flags) and cannot save the judge's call.

**Also:** the prompt-eval harness now reads each rubric axis through the
Decisions API's `score` question, so an axis carries a calibrated
confidence beside the chat judge's number; and `packages/llm/src/decision/consult.ts`
collects the consult loop the surfaces used to copy.

**`video mix` now reads `audio-config.yaml`.** The standalone command
read `mix.yaml` — a file the pipeline does not write — and ignored the
SFX cues entirely, so it mixed a DIFFERENT track than `video make` did:
on the 孙子兵法 film the command played `ambient-take-your-pick` with 0
cues where the make step played `light-gravity` with 2 cues (measured
2026-11-16). The translation now lives in one place
(`mixOptionsFromAudioConfig` in `@video/make`) and both paths use it;
the flags override the file. `--bgm` accepts a library tag as well as a
path.

**`mix.yaml` is downgraded to a fallback.** The v0.3.5 mix format is
still read — an old project keeps mixing the way it did — but it only
fills the gaps `audio-config.yaml` leaves, and the mixer now prints a
warning when it is there, naming the keys to move. The docs (`README.md`
§SFX Cues + BGM Fades, `docs/USAGE.md` §6.5 and its zh-CN twin,
`docs/CONTRIBUTING.md`) mark it legacy and carry the migration: copy
`bgm:`, `sfx:`, `bgm_fade_in_sec:` and `bgm_fade_out_sec:` into
`audio-config.yaml`, delete the file.

**Two films shipped on the new provider — 《孙子兵法的数学原理》 (zh) and
The Hidden Mathematics of Sun Tzu (en).** Both were published on
2026-11-16, and both were re-shot because the first cut's diagrams were
unreadable: MiniMax `image-01` drew the six-row ratio table as an EMPTY
grid and the Lanchester equations as chalk scribbles. The three Chinese
scenes that carry an argument (the ratio table, the equations, the
curve) and all twenty-two English scenes were re-shot with
`gpt-image-2.6-flare`.

| | zh | en |
|---|---|---|
| YouTube | https://youtu.be/0p4h_hg93fQ | https://youtu.be/qy656c_h5h4 |
| Bilibili | https://www.bilibili.com/video/BV1TBsu6vEwd | https://www.bilibili.com/video/BV15Zsz6PEFS |

The first uploads of both films were deleted on YouTube and **marked**
`【旧版·已重拍】` on Bilibili (the creator-center delete endpoint is not
reachable with the uploader's cookies, so the old uploads were marked
rather than deleted — `scripts/bili-mark-superseded.py` does the
marking, by driving the creator center the way the shelved Zhihu
uploader does). The draft score was 93/100 (zh) and 91.1/100 (en), both
grade A on the first attempt; the Chinese film ran 266.9 s, the English
291.6 s, both QA-clean.

**A third film on the new provider: "The AI Pricing Shift" (EN + zh).**
From the draft `docs/draft/ai_era_software_value_and_pricing.md` — what
should customers pay for when the software does the work. The English cut
scored **93.7/100 (grade A)** on the first attempt (27 scenes, 723 words,
324 s); the Chinese cut came from the `l10n` path, which **shares the
image store — zero image spend** — and ran 326 s. Both QA-clean.

| | YouTube | Bilibili |
|---|---|---|
| 中文 | https://youtu.be/0_PkAM91V20 | https://www.bilibili.com/video/BV1oGsD6YEgK |
| English | https://youtu.be/RKZttuu0xQM | https://www.bilibili.com/video/BV1d5sD6wEKb |

Two operational findings came out of it and are worth keeping: **English
narration overflows the caption safe area** (the caption block is capped at
4 lines × 24 units and an ASCII character counts 0.5 a unit, so ~192
characters — a 190-character narration wraps to 5 lines and fails the VDSL
validation for the whole render), and **`gpt-image-2.6` is fast alone and
slow in parallel** (8–12 s per image single-threaded, 60–150 s under the
pipeline's 4-way concurrency). The handover note lives at
`projects/ai-era-software-value-and-pricing/HANDOVER.md`.

**The OpenAI image provider moves to `gpt-image-2.6-flare`.** Measured
against MiniMax image-01 on a real shipped scene prompt (same prompt,
same minute, `scripts/measure-image-providers.mjs`):

| provider | wall clock | cost/image | prompt fidelity |
|---|---|---|---|
| minimax image-01 | 17.2 s | $0.0196 | atmosphere, but the diagram it was asked for was unreadable |
| **gpt-image-2.6-flare `low`** | **8.1 s** | **$0.0203** | followed the prompt's two-part structure and drew a legible diagram |
| gpt-image-2.6-flare `medium` | 8.6 s | $0.0357 | same structure, cleaner glyphs |
| gpt-image-2.6-sunburst `medium` | 41.7 s | $0.0357 | same price, 4× slower |

`low` costs what image-01 costs, renders twice as fast, and is the only
one of the three that drew the diagram the prompt asked for. 2.6 also
takes custom dimensions, so the provider now asks for the composition
size itself (1920×1088 for 16:9) instead of snapping to the 1536×1024
recommended set and letting the renderer crop. The 2.5 models stay
reachable through `defaultModel`.

The corpus is **370 cases across 5 surfaces**, every one derived from a
shipped artifact. The labelling rules are in
`packages/prompts/decisions/POLICY.md`; the plan is in
`docs/plans/v0.12/`.

## v0.11.2 (2026-11-15) — the brand icon's background is transparent

The corner watermark (`brand.yaml` → `assets/brand/icon.png`) shipped as
an RGB PNG with no alpha channel: the avatar was drawn on a solid teal
gradient, so every scene carried an **opaque teal square** in its
bottom-right corner.

The icon is now RGBA with the background cut out. Two things made the cut
non-trivial, and both are handled by
`scripts/make-brand-icon-transparent.py`:

- a plain flood fill leaks nowhere useful — the anti-aliased pixels along
  the silhouette are far from the seed colour in at least one channel, so
  they wall off the teal wedge behind the shoulders. The script fits the
  smooth background GRADIENT instead (a cubic per channel, mean residual
  ~2.7 units) and derives the alpha from each pixel's distance to it;
- colour-keying the background leaves a teal halo, so the edge pixels are
  UNMULTIPLIED against the fitted field — the artwork keeps its own
  colour and no fringe survives.

Measured on the shipped icon: 39.0% transparent, 0.78% feathered (the
1-2 px silhouette edge), 60.2% opaque artwork.
`packages/video-renderer/src/brand-icon-alpha.test.ts` fails the build if
the icon loses its alpha channel, its corners stop being transparent, or
the avatar stops being opaque.

## v0.11.1 (2026-11-15) — English videos: a real subtitle, and no lost text

Two defects, found on the shipped en-US films.

**The bottom band repeated the top.** `video translate` switched en-US
articles to `captions_source: caption`, so the burned-in track carried the
scene's short `caption:` label — the SAME text the Pillow key-info banner
already bakes into the top of the frame. The frame said the same thing
twice and the viewer got no subtitle at all. A translation now burns the
NARRATION, exactly like the source language; the label stays at the top
where it belongs.

**The cue builder dropped text.** `buildCaptionCues` wrapped a group and
then sliced the wrap to two lines. The greedy wrapper breaks at word
boundaries, so a group that exactly fills the unit budget can still need
a third line — and that tail was silently dropped. Measured on the
en-US film of 定向创造: **19 of 40 scenes lost subtitle text**. The
overflow now becomes its own cue: the two-row limit still holds at any
instant, and no text is lost (0 of 540 scenes across the 15 en-US
projects, verified by compiling every shipped storyboard).

Also: the SRT writer used the narration unconditionally while the
compiler honoured `captions.text` — the two tracks could disagree (CS-07).
Both now resolve the same text.

Re-render an existing en-US film with `video make <project> --lang en-US`
(the shipped l10n storyboards were patched in place). A new translation
picks the fix up automatically.

## v0.11 (2026-11-15) — Decision layer, MiniMax H3 Image, structured components removed

Three features, one breaking change.

**Decision layer (advisory, default on).** A provider-agnostic decision
runtime (`@video/llm` `decision/*`) whose contract is a System One
decision — `choice` / `score` / `noul` with a confidence. OpenAI's
**Decisions API** (`gpt-6-luna`) is the measured default: 0.930 over the
187-case labeled corpus, Brier 0.000 on every run, 149 ms p50, and
$0.000050 per decision at the verified Standard-tier price (§7.5/§7.8
of `docs/v0.11-decision-provider-plan.md`). Wired surfaces: the draft
loop's draft-bar verdict consult, and a per-finding advisory in
`video qa` reports. `DECISION_MODE=off|shadow|on` (default off since 2026-11-26 — the layer records and nothing acts, so the consult was a paid call for a log line);
the provider is a chain — OpenAI first, MiniMax second on an
availability failure — and every log row records the provider that
served it; everything degrades to the deterministic path. Tooling: `video decision
bench` (accuracy/calibration/latency/cost per surface),
`video decision harvest` + `video decision backfill` (the 176-case
draft-bar corpus is derived from shipped review artifacts — no human
labelling), and a 187-case corpus under `packages/prompts/decisions/`
with a labelling policy whose rules are loader-enforced.

**MiniMax H3 Image (`minimax-h3`).** Next-gen image provider with
generation AND reference-image editing (`video thumbnail --provider
minimax-h3 --reference <img>`). Exact-pixel output (native 1080p scene
images — image-01 capped 16:9 at 1280×720). `constraintGuard` keeps the
prompt's hard constraints (palette hex, no-text band) alive through the
API's prompt enhancement: markers auto-extracted, dropped markers
trigger one verbatim re-generation. ~$0.02/image at 1K (pricing §16).
Default image provider is UNCHANGED (`minimax` image-01).

**BREAKING — the 14 structured scene components are removed.** FlowChart,
Timeline, MapInsert, Callout, QuoteBlock, StatGrid, BarChart, Leaderboard,
Checklist, BigIdea, PyramidDiagram, VennDiagram, CycleDiagram, Terminal.
Measured: 13% of shipped scenes (194/1496), concentrated in early
hand-authored dev projects; 81%+ of scenes render as photos; the keyword
router and the decision model agreed on every structural scene (routing
was a confirmation surface). The classifier reduces to a Title gate +
AnimatedIllustration fall-through; the visual-class decision surface is
retired. Old storyboards referencing removed components render those
scenes as skipped (not fatal) — re-run `video draft` to regenerate.
`examples/` and the `benchmark-v01` fixture are converted.

**Also in v0.11** — the two streams documented below as Unreleased at
the time of writing (BGM library + Bilibili packaging + en-US captions;
Voicebox + MiniMax TTS providers), plus the prompt-evals harness
(`video prompts eval`, documented in v0.10's plan).

## v0.9.1 (2026-10-18) — TTS providers, draft quality bar, Ask gate, visual cache key

Consolidates two Unreleased streams (Voicebox + MiniMax TTS providers, preflight policy, draft quality bar 90/A with 8 attempts, ask-gate tts question) and the v0.9 visual-cache hardening into a single release.

`minimax` became the default image provider in v0.8.1; this release deletes
the local model entirely. It cost **~1–3 min/scene** on Apple Silicon while
every hosted provider returns in seconds — unacceptable for a pipeline whose
iteration loop is "edit `article.md`, re-render".

**Deleted**

- `packages/media-generators/src/flux-image.ts` + test, and the Python sidecar
  `flux_worker.py` (`packages/media-generators/python/` keeps only
  `contact_sheet.py`).
- `lora-config.ts` + test, and the `lora-config.yaml` convention — LoRA had no
  consumer outside that provider.
- `--lora`, `--lora-config`, `--reference-style-anchor`, `--anchor-scene` from
  `video make`; `--lora`, `--lora-config`, `--text`, `--no-text`,
  `--text-position` from `video thumbnail`.
- `visual_bible:` frontmatter and its parser (`parseVisualBible`,
  `sceneRefNames`, `visualBibleRefPath`) — image-to-image conditioning had no
  remaining provider.
- `ImageRequest.referenceImage` and `ImageRequest.textOverlay` — both were
  honoured only by the deleted provider.
- Four skills: `flux2-klein-local-gen`, `flux-image-prompting`,
  `flux-visual-consistency`, `flux-asset-review`.
- `models/` (**23 GB** of weights) and the uv `.venv`. The Python project is
  now Pillow-only: `uv.lock` went from ~30 packages to 2.

**Kept**

`--image-provider minimax|openai|gemini|mock|none`, `minimax` still the
default. The v0.8 content-keyed image cache, `video make --dry-run` impact
table, and the `video visuals` contact sheet + `require_visual_approval` gate
are untouched; the cache key simply lost its LoRA / ref-digest / style-anchor
inputs, so **existing images regenerate once** on the next `make`.

**What you can no longer do**

LoRA style adapters, cross-scene image-to-image consistency (style anchor or
Visual Bible refs), Pillow text overlays on generated images, and native
1920×1080 scene output — hosted providers cap 16:9 at 1280×720, which the
renderer upscales. The last one bites `video thumbnail`: the overlay that
rendered CJK titles crisply was Pillow inside the deleted worker, so
`youtube/thumbnail.*` must now be typed in YouTube Studio.

## Unreleased — the 300-second tax, and a draft stage that leaves a trace

**A long model call is no longer paid for twice.** Node's bundled undici
gives up waiting for response headers after 300 seconds, and a
non-streaming chat completion sends its headers only after the whole
answer is generated — so every completion slower than five minutes died
with `UND_ERR_HEADERS_TIMEOUT`, threw its tokens away, and was issued
again as a stream. The 2026-11-13 draft (`projects/任务式指挥与agent设计`)
paid that tax on every one of its five judge calls: **94 minutes of wall
clock for ten model calls, about half of it spent on requests that were
discarded.**

The cause was a regression, not a provider limit. `7d1aec5` (2026-09-25)
raised the ceiling to 900 s through a custom undici `Agent`;
`f618cdf` (2026-09-27) replaced that Agent with `AbortSignal.timeout` to
dodge a Node-22 incompatibility and **silently dropped the ceiling back
to 300 s** — `AbortSignal` bounds the whole request, not the header wait,
so it could not replace what it replaced.

- `packages/llm/src/http.ts` (new) — one shared undici `Agent` with
  `headersTimeout` / `bodyTimeout` at the 40-minute `LLM_TIMEOUT_MS`, used
  by every provider call. The Node-22 problem f618cdf hit does not apply
  here: both the `fetch` and the `Agent` come from the same standalone
  `undici` package, so the pool accepts its own dispatcher.
  `LLM_HTTP_TIMEOUT_MS` overrides the ceiling for an operator who wants a
  shorter wait.
- The streaming re-issue stays as a safety net, but it is now unreachable
  in practice: a request that would have died at 300 s simply waits.

**The draft stage now leaves a trace.** It wrote no run record at all, so
a 94-minute draft could only be reconstructed from file mtimes, and every
`duration_ms` in the project read 0.

- One run record per model call, written as the call happens:
  `runs/draft-*.yaml` (generation), `runs/draft-judge-*.yaml` (scoring),
  `runs/draft-audio-plan-*.yaml` (the audio plan). Each carries the
  serving provider, the model, the tokens, a **real** `duration_ms`, and a
  `telemetry` block: `requests`, `streams`, `headers_timeout_retries`.
- `ProviderTelemetry` (`packages/llm/src/provider.ts`) travels with every
  provider response. A failed attempt attaches its own numbers to the
  error, and the retry layer folds the discarded attempts into the
  surviving response — so a request that was thrown away is counted, not
  lost.

**The judge's answer was 91% hidden thinking.** Measured on the 2026-11-13
article with MiniMax-M3: the judge wrote **119,029 characters**, of which
**108,846 (91%) were reasoning nobody reads** — 31,916 output tokens and
161 s to produce a 10,183-character scorecard. Trimming the scorecard
fields would have saved 9% of that; the reasoning was the cost.

- `ChatRequest.thinking` (`packages/llm/src/provider.ts`) asks a provider
  to skip its reasoning. MiniMax-M3 honours it
  (`thinking: {"type":"disabled"}` — "Skips thinking and answers
  directly"); **GLM-5.3 cannot** — its thinking is forced and the
  parameter is rejected, so the GLM provider deliberately drops the field
  rather than sending it and failing the call.
- The **judge** asks for no reasoning
  (`packages/draft/src/article-review.ts`): **1,692 output tokens and 9.5 s**
  for the same article, scoring **88.8** against **88.4** with reasoning
  (four no-reasoning runs spanned 85.8–90.8 — that spread is the judge's
  own noise, not the reasoning).
- The **draft keeps its reasoning.** Without it the article comes out
  half-length — 19 scenes / 215 s against a 480 s target, versus 33 scenes
  / 480 s with reasoning — because the model plans the scene budget while
  it thinks.

- `telemetry.reasoning_tokens` records the overhead per call, so the run
  record shows what the thinking cost instead of hiding it in the token
  count.

**The ladder stops re-rolling the dice.** The judge's noise on ONE draft
is **±1.9 points** — ten judgments of the same article: 84.2 / 85.8 / 87.4
/ 88.0 / 88.0 / 88.4 / 88.8 / 89.0 / 90.2 / 90.8 (sd 1.85, range 6.6) —
and the 90-point bar sits *inside* that band. The 2026-11-13 run spent five
attempts and passed on a +7.6 jump from a blind rewrite: luck, not
improvement.

- `video draft` now judges each draft **twice** and averages
  (`--judge-samples`, default 2). The per-indicator scores are averaged;
  the findings, comment and suggestions come from the **median**
  judgment; every sample's tokens and telemetry are counted. Measured on
  the same ten judgments: the pair-averages have sd **1.28** against the
  single samples' 1.85, and a range of 3.5 against 6.6 — the √2 the
  averaging predicts.
- The loop's progress test no longer reads the raw score. A revision
  counts as progress when **the defect load shrank** (Critical 3, Major 2,
  Moderate 1, Minor 0.5) **or** the score moved by more than
  `IMPROVEMENT_MARGIN` (1.0 point — inside the noise band on purpose). A
  revision that shrank the defects but left the score flat now keeps the
  surgical line alive instead of being thrown away for a blind rewrite;
  a blind rewrite is still the escape hatch when neither the defects nor
  the score moved.

**The rubric and the drafter finally agree.** The judge kept filing
findings the writer was never asked to satisfy: a missing runnable
example (its own headline complaint, four times across the 2026-11-13
run), terminology drift between the prose and the narration, sources
without a locator, absolute claims. Each was a finding the writer could
not have avoided — and the loop paid a full generation + judging round
for each one.

- `packages/prompts/prompts/draft-article.md` — new section 21: a
  **runnable example** whenever the article defines a protocol, schema,
  interface or configuration (field names AND types, plus what
  validation failure does); **one name per concept**; **the narration is
  not a second copy** (a scene that mentions a list must match the prose
  exactly); a **checkable locator** for every named external source, with
  author-made mappings marked as the author's; **calibrated claims** (no
  absolutes the evidence cannot carry); **no dangling pronouns**. The
  final-validation list gained five checks for them.
- `packages/prompts/prompts/draft-article-review.md` — new section "THE
  WRITER'S CONTRACT": the judge now scores against the contract it was
  given. The **±10% scene-duration tolerance** (it was filing
  FORMAT_VIOLATION for a 0.6% miss — 477 s against 480 s), the YAML
  frontmatter as **metadata rather than content**, a `visual:` line as an
  **art-direction line rather than prose**, and what the writer is
  required to supply. Its PROCEDURE step 3 also stopped contradicting
  its own FINDINGS section ("non-zero / non-five" vs "below 4").
- The prompt-eval snapshots were regenerated
  (`video prompts eval --offline --update-snapshots`).
- `article-review.yaml` now records the judge's spread:
  `judge_samples: N` and `judge_sample_scores: [...]`. The score is the
  MEAN of those judgments — a report that hides the spread makes a
  noisy score look certain.

**Two more gaps the film run exposed.** Rendering the 95.4 article found
a hard pipeline constraint the drafter had never been told:

- The burned caption IS the scene narration, and the renderer rejects a
  narration that wraps past 4 lines of 24 units. The drafter prompt now
  states the limit (about 90 CJK characters per scene) and the
  final-validation list checks it — otherwise `video make` fails on the
  caption overflow with the draft looking perfect.
- `video make`'s render step reported `preview failed` with no reason
  when the reason lived in the outcome's lines (the storyboard approval
  gate does). The step now carries the actual first line.
- **The narration IS the film.** Every scene's duration is re-timed to
  its measured speech, so the finished film's length is the narration's
  length — and the drafter prompt said the narration should fill only
  55-70% of the target. A draft that followed that rule produced a
  **329-second film for a 480-second target** (69%). The prompt now
  states the contract the pipeline actually implements: the narration's
  SPEECH TIME equals `duration_target_sec` (220-300 Chinese characters
  per minute × the duration in minutes), and each scene's declared
  duration matches its own narration. Measured: **2,125 characters →
  ~451 s of speech → 94% of the target**, the same shape as the shipped
  films (93%, 88%, 97%).

Measured on the same topic with the same knobs: **95.4 / grade A, zero
findings** (before: 91.2 with four findings). The judge's headline
complaint moved from "最大的缺口是缺少一个可运行的任务对象与执行链示例"
to the next level up ("补上一个可运行的最小编排器实现") — the gap the
writer was never told about is closed.

The prompt costs what it cost before: a generation re-measurement with
the new prompt ran 167 s / 26,152 output tokens (156 tok/s) against
171 s / 27,969 (164 tok/s) with the old one. The 818 s generation in
the scored run was a provider-side outlier (40 tok/s) — the judge call
in that same run held the normal 159 tok/s.

**`--candidates` was registered but never mapped.** The flag reached
commander and was then dropped by `draftCliOptsToDraftOptions`, so every
film of 240 s or longer ran the auto default — **2 parallel candidates,
2× the generation spend** — no matter what the user asked for. Now the
flag maps through.

Measured on the replay of the 2026-11-13 topic: the judge-shaped call
(29 KB article + 11 KB rubric) that took **523.5 s** — 300.1 s discarded,
223 s real — now completes in one request.

## v0.11 (continued) — BGM library, Bilibili packaging, en-US captions

**BGM is a local library, not a service.** `assets/bgm/` is the single source
of truth for background music (17 tracks, `<mood>-<slug>.mp3` + a sibling
`.license.txt`); the MiniMax music-01 generation path, its provider, the
`--music-provider` flag and the `MUSIC_PROMPTS` map are **removed** — the API
had been returning `410 This Music API is no longer available` anyway, so
every generated bed was silently degrading to a 1-second silent placeholder.
`bgm: <tag>` now resolves project-local `assets/audio-assets/bgm/` first,
then the library, then `assets/brand/`, and hands ffmpeg the file **in place**
— previously a tag was copied to `assets/audio-assets/bgm/<tag>.wav`, which
wrote mp3 bytes under a .wav name and duplicated the track per project. An
unresolvable tag warns, lists what is available, and mixes silence rather
than failing the render. `music.json` is now the library index
(`loadBgmCatalogue`) carrying each track's **measured** duration, LUFS and
dynamic range plus `use_when`/`avoid_when`; the audio planner reads it through
`renderBgmCatalogue()`. Two measurements that a filename cannot answer now
drive selection: loudness spans ~8 dB while the mixer applies one fixed bed
level, and tracks shorter than the runtime loop (most of them) at a seam.
`video draft`'s BGM question offered `calm | epic | guofeng | …` — generation
prompts that are not files, so every option pointed at nothing; it now offers
real tags.

**`video bilibili`** packages Bilibili submission metadata
(title / 简介 / ≤10 tags / suggested 分区 / cover brief → `bilibili/CHECKLIST.md`).
Bilibili has no public upload API for third-party tools, so this is
packaging-only by design. `suggested_category` is a section **name**, not a
numeric `tid`: a wrong tid does not error, it files the video somewhere
unrelated and nobody notices until after publishing. Any model failure
degrades to a deterministic package instead of failing, which is the one
behaviour `video youtube` lacks.

**English videos can render at all.** The caption overlay is validated against
the bottom safe area (3 lines × 24 CJK units, ASCII 0.5) — ~144 characters for
English, while English narration runs 150-220 per scene, so `source: narration`
failed validation on 19 of 23 scenes and the render was refused. New
`captions_source` frontmatter (`narration` default, `caption` for the short
label) fixes it and stops a designed card printing its own text twice.

**Comparison cards** no longer render positional placeholders. Titles are
content-derived: the caption's own contrast pair wins when it yields both
sides, `还是` is recognised as a contrast connective (the commonest way a
Chinese caption states one — "精确，还是结构"), and the title budget is
language-aware so an English title is no longer cut mid-word
("Promoted into inf…"). Items no longer pull sentences from a prose section
matched by index, which with 7 sections across 25 scenes put one scene's
content on another scene's card.

## v0.11 (continued) — Voicebox + MiniMax TTS providers (cloned voices)

`video make` can narrate through a local [Voicebox](https://voicebox.sh)
server: set `tts_provider: voicebox` + `voice: <profile>` in `article.md`
frontmatter; `tts_provider: minimax` narrates through MiniMax T2A v2
(`speech-2.8-turbo`, system or cloned voice ids — cloning requires a
pay-as-you-go key, Token Plan gets error 2061; unused cloned voices are
deleted after 7 days). New providers:
`VoiceboxTTSProvider` (`packages/tts/src/voicebox.ts`) drives the v0.5.0
async REST flow (`/generate` → poll `/history/{id}` → `/audio/{id}`);
base URL from `VOICEBOX_URL` (default
`http://127.0.0.1:17493`). The TTS cache key is now provider-namespaced
(edge hashes unchanged — existing sidecars stay valid; `--fake` runs no
longer share a key namespace with real syntheses). The `--dry-run` impact
table now resolves voice from `article.md` frontmatter like the synthesis
path does, instead of `audio-config.yaml`'s voice (which make ignores).

Pre-flight policy: `video make` probes voicebox before synthesizing and
degrades loudly (down → MiniMax system voice → Edge); `video draft` adds
a conditional `tts` question to the video-ask envelope — offered only
when the local server answers with cloned profiles, answered via
`--tts voicebox:<profile>|minimax-system|edge` and stamped into
frontmatter as `tts_provider` + `voice`.

## v0.8.1 — minimax is the default image provider

Local FLUX.2 Klein 4B costs **~1–3 min/scene** on Apple Silicon, which
made `video make` unusable for iteration. `minimax` is now the default
for scene images. One product call, plus a dedup.

- **Default flips back to `minimax`.** New `resolveImageProvider(fake,
  explicit)` in `packages/make/src/index.ts` replaces the
  `opts.imageProvider ?? (opts.fake ? "none" : "flux")` expression that
  was **duplicated in three places** — `runMake`, the read-only
  `computeMakeImpact` (`--dry-run` table), and `video visuals`. They had
  to agree or the impact table predicted spend the render never made;
  now they cannot drift.
- **What you give up by default:** LoRA (`--lora` / `lora-config.yaml`),
  image-to-image conditioning (`--reference-style-anchor`,
  `visual_bible:` refs), Pillow `textOverlay`, and native 1920×1080 —
  the MiniMax API caps 16:9 at 1280×720, which the renderer upscales.
  All four remain available behind `--image-provider flux`.
- **What you gain:** seconds per scene, no local 22 GB weight download,
  no MPS memory pressure.
- **Tests:** `packages/make/src/fake-image-default.test.ts` now asserts
  the resolver contract (fake ⇒ `none`; omitted ⇒ `minimax`; explicit
  wins even under `--fake`) and exercises
  `updateStoryboardForImages` through the public API instead of
  regex-matching `index.ts` source text. Two source-text assertions
  (`opts.imageProvider ?? …`, `caption: prevText`) were deleted; both
  invariants now have behavior tests.

## v0.8 — Visual Guardrails (freshness + review)

The least-reviewed part of the pipeline now has three guardrails.
Plan: `docs/v0.8-visual-guardrails-plan.md`.

- **Content-keyed image cache.** Every generated `assets/images/scene_N.jpg`
  gets a `scene_N.cache.json` sidecar hashing its inputs (visual line,
  `image_style`, provider, LoRA, Visual-Bible refs, geometry). Editing a
  scene's `visual:` line or flipping `image_style` now **regenerates that
  image** — pre-v0.8 the cache keyed on file existence, so edits silently
  never reached the picture. Pre-existing images without a sidecar are
  adopted (kept + keyed), so upgrading never re-spends on untouched
  scenes.
- **Impact table.** `video make <project> --dry-run` prints, read-only:
  which images regenerate / scenes re-render / WAVs re-synthesize, the
  visuals-gate state, and article↔storyboard drift (the id-keyed-sync
  limitation, surfaced rather than silently fixed).
- **Keyframe review (opt-in).** `require_visual_approval: true` in
  article.md frontmatter arms a third human gate:
  `video visuals <project>` generates images + a Pillow contact sheet
  (`assets/images/contact-sheet.png`), `video approve visuals <project>`
  freezes the set into `checkpoints/visuals.yaml`, and `video make`
  refuses to render until the on-disk set matches (naming stale scenes).
  `video visuals <project> --reject 7 --reason "…"` force-regenerates one
  scene. Gate off by default ⇒ v0.7.1 behavior exactly. The workflow stage
  machine (`V01_STAGES`) is untouched — the gate is a checkpoint record,
  not a stage.
- **Visual Bible (opt-in).** `visual_bible:` in article.md frontmatter
  declares named reference images (`assets/visual-bible/<file>`) mapped to
  scenes; generation conditions on them through the existing flux
  image-to-image path. Scene refs win over `--reference-style-anchor`;
  v0.8 conditions on the first resolved ref (one conditioning image per
  scene). Ref content participates in the cache key, so editing a
  reference regenerates the scenes it conditions. Malformed frontmatter
  warns and degrades — article.md is human-edited and never bricks.
- Also in this release: vitest suites are now hermetic against live agent
  harnesses (`vitest-global-setup.ts` scrubs `OPENCODE_PID` & friends —
  a suite run inside opencode no longer changes CLI behavior).

## v0.7.1 — Live Pipeline Progress (video-progress/1)

Long runs stop being silent. `video make` and `video draft` now print
live progress to **stderr** (stdout stays artifact-clean): step starts
(`▷ tts`), per-scene items with position and elapsed time
(`✓ [3/23] tts scene_03  4s`), and a heartbeat for any single call
longer than 30 s (`⏳ generate-visuals … 95s`, repeating every 20 s) —
a 20–40 min make run is no longer indistinguishable from a hang, for
agents polling background output and humans alike. The final report
table is unchanged; emission is structured events
(`ProgressEvent`/`heartbeat` from `@video/make`), defaulting to
silence for library callers.

## v0.7 — Agent-Aware Draft Questions (video-ask/1)

`video draft` no longer burns a full scored draft on silent defaults
when it runs inside an agent harness. When the CLI detects an agent
in the environment and one or more style knobs were left unspecified,
it prints a machine-readable question set to stdout
(`protocol: "video-ask/1"`) and exits 2 — before any provider is
constructed or any file written, so nothing is spent. The presenting
agent relays the questions through its native question UI and re-runs
the command with explicit flags.

### What changed

- **Auto-detect agent harnesses, emit a machine-readable question
  set** (`video draft`): zcode (`ZCODE_APP_VERSION`), Claude Code
  (`CLAUDECODE`), oh-my-openagent (`OMO_CODING_AGENT_DIR` — verified in
  the installed 5.1.30 source), oh-my-pi (`OMP_CODING_AGENT_DIR`) and
  pi-fork sessions (`PI_CODING_AGENT_DIR`; plain pi sets no marker)
  are detected out of the box; OpenCode exports no stable
  child-process marker and any other harness can be declared via
  `VIDEO_ASK_ENV=VAR,VAR=VALUE,…` (user-extendable comma list, no
  code change). Exit codes: `0` ran · `1` failure
  (unchanged) · `2` questions pending — run not started, nothing
  spent. On exit 2 stdout is pure JSON (jq-parseable); human-readable
  hints go to stderr.
- **Explicit flags always win — fully-specified runs are
  byte-identical**: questions are only ever emitted for knobs the
  caller did not pass, so replay scripts and agent-launched sub-runs
  never see a surprise exit 2. Unattended sub-runs pass `--no-ask`;
  headless cron/launchd shells set `VIDEO_ASK=off`.
- **New `--bgm <tag|none>` flag on `video draft`**: stamps the
  answered tag into a **fresh** `audio-config.yaml` as `bgm: <tag>`
  (`none` → `bgm: null`), overriding the audio-plan LLM's pick for
  the `bgm:` key only — voice and SFX stay LLM-chosen. An existing
  `audio-config.yaml` wins with a warning (hand edits are never
  overwritten); `--no-audio-plan` drops the `bgm` question entirely.
- **`--ask` / `--no-ask` overrides + `VIDEO_ASK=off` / `force`
  env**: `--no-ask` and `VIDEO_ASK=off` suppress the protocol;
  `--ask` and `VIDEO_ASK=force` force questions even with no harness
  detected; the default is auto (ask iff agent detected AND ≥1 knob
  unspecified). Unknown `VIDEO_ASK` values warn on stderr and behave
  as auto.
- **Question set = `lang` / `duration` / `image_style` / `style` /
  `bgm`**, each with a default and a recommended value that the
  presenting agent highlights (and may replace with a topic-aware
  pick, stating the reason). Only unspecified knobs are asked;
  `audience`, `model`, and the review-gate knobs stay flag-only.

Full contract: `docs/v0.7-agent-ask-protocol-plan.md`.

## v0.6.0 — advisory decision layer (withdrawn)

**Date:** 2026-10-14

This release shipped an ADVISORY decision-model sidecar: a local
service that returned bounded decisions (`choice`/`score`/`noul` +
probabilities) to the pipeline. It was never a chat model and never a
provider. Three rules governed every surface: advisory only (never a
human gate, never a workflow transition), degrade-to-current-behavior
(a decision call never threw — null on any failure), shadow first (the
mode flag defaulted to **off**).

The whole layer was withdrawn and its code removed in `e681bda`. Its
service, its sidecar data files and its CLI verb are gone with it, and
the pipeline kept the current behaviour. Nothing in the tree depends on
it any more.

## v0.4 — Visual & Publishing Quality

**Branch:** `feat/v0.4-video-quality`
**Tags:** `v0.4`

Seven quality wins — same human-gate principle, no breaking changes to the
two-file edit model (`article.md` + `audio-config.yaml`).

### What changed

- **Auto-captions from article** (`video draft` → T1): every auto-generated
  storyboard now carries `captions: { source: narration }`. Opt out with
  `--no-captions`. The existing `writeCaptionsSrt` step in `@video/make`
  produces `captions/<lang>.srt`; the new flag stops the overlay from
  loading it.
- **Visual-variety classifier** (T2, `packages/draft/src/visual-classifier.ts`):
  the article's `visual:` field is classified into the right VDSL
  component (FlowChart / Comparison / Terminal / Timeline / Callout /
  Illustration) instead of every scene being `AnimatedIllustration`.
  First scene still `Title`. Keyword vocabulary is bilingual (zh-CN +
  en-US). Hand-edited storyboards are preserved on subsequent runs.
- **Image prompt expansion** (T3, `--image-provider minimax`): the
  80-char `visual:` is rewritten into a 2-3 sentence image prompt
  (subject · environment · lighting · composition · style) via a
  cheap LLM call (≤400 chars, temperature 0.4). Cached on
  `sha256(visual|caption|narration[:200])` so re-runs are free.
  Audit sidecar: `assets/images/scene_N.prompt.txt`.
- **`--style <theme>` flag** (T8, `video draft`): `style.theme: warm-sunset`
  instead of the hardcoded `dark-tech`. Plumbed through CLI → article
  frontmatter → storyboard.
- **Hook ↔ YouTube coherence** (T4): the YouTube agent now receives the
  article's hook and topic explicitly. The thumbnail prompt is checked
  against a banned-token list (`text` / `字幕` / `字体` / `logo文字` /
  `海报` / `界面` / `仪表盘` / `截图` / …) and re-prompted once on a
  hit. The CLI never silently accepts a poster-style prompt.
- **QA gate in `video final`** + **QA surfacing in `video status`** (T6, T7):
  `video final` already ran QA + gated on errors; `video status` now prints
  `QA: ✗ N errors, ✓ M warnings` (or `✓ …`) so users know without
  running `video qa` manually.
- **`video retrospect <project>`** (T10): cheap LLM call that reads the
  last 5 `runs/*.yaml` + the latest QA report and writes
  `projects/<slug>/retrospect.md` with 3 concrete edits to
  `article.md`. `--dry-run` shows the prompt without calling the LLM.
  Records a run.
- **CLI banner** (T9): `video` and `video --help` print the minimal-API
  quickstart above the verb list.
- **Scene-aware mock Shorts** (T5): `video shorts` (mock) now snaps to
  the second scene boundary by default, skipping the `Title` card.
  Override with `--start <sec>`.

### New files

- `packages/draft/src/visual-classifier.ts` (+ test)
- `packages/draft/src/image-prompt.ts`
- `packages/cli/src/retrospect-command.ts` (+ test)

### Tests

- 481 + 9 new tests, 76 → 79 test files. `npm test` green.
- `pnpm run acceptance` (§62.4) still green.

### Non-changes

- The two-file edit model (`article.md` + `audio-config.yaml`) is
  unchanged.
- No auto-publishing, no auto-approve.
- Per-segment BGM transitions + cloud rendering + GLM image provider
  are still deliberately deferred (no verified spec).

## v0.4.1 — pi / oh-my-pi adapter

**Branch:** `feat/v0.4.1-pi-adapter`
**Tags:** `v0.4.1`

The harness adapter section of the README is no longer OpenCode-only.
The repo now ships first-class integration with `pi / oh-my-pi`
(`@oh-my-pi/pi-coding-agent`, `omp.sh`):

- **`.omp/commands/video.md`** — native slash command. OMP discovers
  commands at `<cwd>/.omp/commands/*.md`; `name` + `description`
  frontmatter, plus a body that documents the canonical pipeline,
  every verb, and the critical invariants. Identical in spirit to the
  existing `.opencode/command/video.md`.
- **`.omp/skills/<name>/SKILL.md`** — symlinks for all 28 third-party
  skills in `.agents/skills/` so OMP's native skill provider picks
  them up. Single source of truth remains `.agents/skills/`; OMP just
  needs the directory layout it expects.
- **`.omp/settings.json`** — enables native project commands, custom
  skill directories, and `/skill:<name>` interactive commands.

No new packages, no changes to the `video` CLI. The CLI stays the
harness-agnostic surface; every adapter forwards to it (OpenCode,
OMP, Claude Code, Codex, Gemini, or plain shell via `bin/video`).

## v0.4.2 — four new `style.theme` palettes

`packages/video-components/src/theme.ts` grows from 4 to 8 built-in
palettes. Total stays small so users can pick by name without a
picker UI:

- `forest-moss` — emerald / lime. Sustainability / botanical / outdoor.
- `sunset-pop` — near-black / bright yellow. Energetic consumer /
  entertainment.
- `terminal-vintage` — phosphor green on dark gray. Dev tutorials /
  retro hacker nostalgia. Uses JetBrains Mono across all roles and
  `linear` easing for the classic CRT feel.
- `paper-cream` — soft beige / burnt orange. Product / food /
  family-friendly explainers. Warmer and more modern than `paper-light`.

All four pass the existing luma-contrast smoke test
(`primary`/`background` spread > 120). Unknown / misspelled names
still fall back to `dark-tech` — renders never crash on a typo. The
`--style <name>` flag on `video draft` is unchanged; the article
frontmatter `theme: <name>` field carries through unchanged. New docs:

- `docs/INSTALLATION_AND_USAGE.md` §"Available themes (v0.4.2)" —
  English table.
- `docs/INSTALLATION_AND_USAGE.zh-CN.md` §"可用主题（v0.4.2）" —
  zh-CN mirror.

- Test additions (`packages/video-components/src/theme-registry.test.ts`):
  3 new cases — assert the 4 v0.4.2 names exist, `resolveTheme` finds
  them, and `terminal-vintage` uses JetBrains Mono everywhere.

## v0.4.4 — cosmetic UX redesign (creator / playback feel)

A surface pass that unifies the CLI typography + the video output palette
around the creator/playback aesthetic. **No changes to the human-gate
principle, the two human-edit files (`article.md`, `audio-config.yaml`),
or the acceptance gate.** Storyboards keep their current theme unless
`style.theme: ai-red` is set explicitly. The post-v0.4 visual plan
(`docs/v0.4-video-quality-plan.md`) is otherwise complete; this release is
its cosmetic + operator-UX follow-through.

**User-facing CLI surface:**

- New `packages/cli/src/ui.ts` — shared glyph vocabulary (`✓ ✗ ! ▷ ⏭ ● ○`)
  - `brandBannerLine()` + `channelHeader(name, state)` helpers.
- 8 commands now open with `brandBannerLine()` + `channelHeader(project,
"stage · verdict · provider")`: `status`, `make`, `new`, `qa`, `youtube`,
  `retrospect`, `review`, `validate`. Inline `\u2713`/`\u2717` glyphs
  replaced with `MARK_OK`/`MARK_FAIL`.
- New `video theme` verb (`packages/cli/src/theme-command.ts` + tests):
  palette index with ANSI truecolor swatches; `video theme <name>` for
  one palette's full token set; `video theme --cwd <root>` resolves
  a project's current `style.theme`. Honors the `NO_COLOR` env per the
  <https://no-color.org> convention.
- `video validate` now surfaces a stderr hint when `style.theme` names
  an unknown palette: lists every known name + a `video theme`
  cross-reference. Exit code unchanged (still 0 / 1 on validation
  status); the hint goes to stderr so structured-data pipelines aren't
  polluted.
- `video --help` BANNER: tagline refined, version 0.1.0 → 0.4.0,
  theme-preset list added; extended in-source sync comment lists every
  doc that must move in lockstep with the BANNER.

**Video output surface:**

- New `ai-red` palette (`#0F0F0F` player dark / `#FF0000` signature red /
  `#FFFFFF` text) registered as `style.theme: ai-red` (renamed from
  an exploratory `youtube-red` to avoid the trademark).
- New `channel-banner` intro gradient in `INTRO_GRADIENTS` (red → dark
  chrome) — pairs with `ai-red` for end-to-end creator look.
- `EndCard` CTA: square 8px-radius → subscribe-shaped pill
  (`border-radius: 999`, accent glow, inline SVG play triangle). API
  unchanged; the SVG replaces the `▶` text glyph so renders no longer
  depend on font fallback.

**Source-of-truth updates:**

- `packages/video-components/src/theme.ts` — `aiRedTheme` exported and
  registered in `THEMES` (now 9 entries).
- `packages/video-components/src/components/BrandOverlay.tsx` —
  `INTRO_GRADIENTS["channel-banner"]` added.
- `packages/video-components/src/components/EndCard.tsx` — pill CTA +
  inline SVG.
- `packages/cli/src/ui.ts` (new) — shared glyph + header helpers.
- `packages/cli/src/{index,status,make,new,qa,youtube,retrospect,review,
validate,theme}-command.ts` — banner + ui markers.
- `packages/cli/src/{theme,validate}-command.test.ts` — new + extended
  test coverage (16 new test cases: 13 for `theme`, 3 for the validate
  hint).
- `packages/video-components/src/theme-registry.test.ts` — `toBe(8)`
  loosened to `toBeGreaterThanOrEqual(8)` since post-v0.4 theme additions
  legitimately grow the registry; the explicit per-name `toContain`
  checks still catch accidental removals.

**Tests:**

- `pnpm test` → **92 / 92 files, 653 / 653 tests pass**.
- `npm run acceptance` → **11 / 11 §62.4 checks pass** (render exists,
  no external AI providers, state FINAL_APPROVED, status exits 0).

**Docs synced in this release:**

- `README.md` — `video theme` row added to the minimal-API table; new
  "Theme presets" subsection with 9-row table; cross-reference to
  `video theme` for inspection.
- `docs/INSTALLATION_AND_USAGE.md` (EN + zh-CN) — theme count lifted
  from "eight" to "nine"; `ai-red` row added; `video theme` mention.
- `docs/schema.md` — `ai-red` row in the theme table.
- `docs/CONTRIBUTING.md` + `docs/architecture.md` +
  `docs/architecture-v01-map.md` — `@video/video-components` row updated
  to current counts (24 scene components + chrome overlays + 7 animation
  primitives + 9 themes + 5 intro gradients).
- `packages/cli/src/index.ts` — extended BANNER sync comment to list
  every doc surface that must move in lockstep with the BANNER.

## v0.5.2 — image-to-image style anchor + idempotency fix

Builds on v0.5 with **image-to-image style consistency** across a
video. When `--image-provider flux --reference-style-anchor` is
set, the orchestrator generates the anchor scene first, then
conditions every subsequent scene on it via the 4B pipeline's
`image=` argument (the 9B KV variant is gated; not used here). New
`--anchor-scene <N>` (default 1) lets the user pick a later scene
as the anchor. Off by default — current per-scene-independent
behavior is preserved.

A real bug was caught and fixed in the same release: the first
version of the orchestrator only set `styleAnchor` in the
post-generation try-block, so re-runs with
`--reference-style-anchor` silently dropped the anchor when the
anchor scene's image already existed on disk. Now the anchor is
promoted on both fresh and idempotent paths. Guarded by a vitest
regression test (`packages/make/src/style-anchor.test.ts`).

**User-facing CLI surface:**

- `video make <p> --image-provider flux --reference-style-anchor` —
  style anchor mode (off by default).
- `video make <p> --image-provider flux --reference-style-anchor --anchor-scene <N>` —
  1-based scene number to use as the anchor.
- `video make` and `video thumbnail` now accept `--lora-config` and
  `--lora` (covered under v0.5.1, but threaded through here).

**Source-of-truth updates:**

- `packages/media-generators/src/image.ts` — `ImageRequest` gains
  optional `referenceImage?: string` (backwards-compatible: providers
  that don't support it ignore the field).
- `packages/media-generators/src/flux-image.ts` — `FluxKleinImageProvider`
  forwards `referenceImage` into the JSONL job envelope.
- `packages/media-generators/python/flux_worker.py` — new
  `referenceImage` field on the request protocol; opens the file via
  PIL in real mode and validates readability in selftest mode;
  passes it as `image=` to `Flux2KleinPipeline.__call__`.
- `packages/make/src/index.ts` — `generateSceneVisuals` is now
  exported; `referenceStyleAnchor` and `anchorScene` options with
  idempotency-safe promotion; warning when `anchorScene > scene count`.
- `packages/cli/src/make-command.ts` — `--reference-style-anchor` and
  `--anchor-scene <n>` options (with positive-integer parser).

**Tests:**

- 4 new vitest cases in `style-anchor.test.ts` (fresh run, idempotent
  regression, anchorScene=3, anchorScene > count warning).
- 2 new vitest cases in `flux-image.test.ts` (reference-image happy
  path and missing-file negative path).
- `pnpm build` clean; 233 / 233 tests green.

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T6.2 marked shipped
  with the real-pipeline evidence (per-pixel RMS diff p95 = 225/255
  between t2i and i2i at 512×512, 4 steps on the 4B pipeline).
- `README.md` — new "Style anchor — image-to-image across scenes"
  subsection under "Local Image Generation".
- `packages/media-generators/python/README.md` — protocol section
  documents the `referenceImage` field.
- `~/.agents/skills/video/SKILL.md` — synced to v0.5.2 surface.

## v0.5.1 — LoRA config surface + base-4B model switch

Builds on v0.5 with the **LoRA conventions** (T5) and the **base-4B
quality path** (T6.1) from the v0.5 plan. Adapters are now a
checked-in human-edit file (`lora-config.yaml` at `<projectRoot>` or
`<repo>`), mirroring the `audio-config.yaml` convention. License
sidecars are enforced when declared. The legacy `FLUX2_LORA` env /
`lora:` option still works for quick experiments. `flux_worker.py
--check-model <repo_id>` reports the `is_distilled` field for any
checkpoint so users can pick between the 4B (8 steps, distilled)
and the 4B base (50 steps, guidance honored) variants before
committing to a multi-GB download.

**User-facing CLI surface:**

- `video make <p> --lora-config <path>` — explicit lora-config.yaml
  path (overrides the auto-resolved file).
- `video make <p> --lora <spec>` — legacy "path[:scale][,…]" string
  form.
- `video thumbnail <p> --provider flux` now auto-resolves
  lora-config.yaml and accepts the same `--lora-config` /
  `--lora` overrides as `video make`.

**Source-of-truth updates:**

- `packages/media-generators/src/lora-config.ts` — `lora-config.yaml`
  loader + `resolveLoraConfigPath` with project-→-root-→-env
  precedence. Source resolution distinguishes HF repo ids from local
  files by extension (`.safetensors` / `.bin` / `.pt` / `.gguf` /
  `.ckpt` → local).
- `packages/media-generators/src/flux-image.ts` — new
  `loraConfigPath` provider option, flows as `FLUX2_LORA_CONFIG` env
  to the worker.
- `packages/media-generators/python/flux_worker.py` —
  `parse_lora_config`; existing `load_lora_weights` /
  `set_adapters` path reused.
- `packages/make/src/index.ts` — `generateSceneVisuals` resolves
  lora config (project → root) when the provider is flux.
- `packages/cli/src/{make,thumbnail}-command.ts` — `--lora-config` and
  `--lora` options.
- `packages/media-generators/python/flux_worker.py` — new
  `--check-model REPO_ID` mode that fetches only `model_index.json`
  (no safetensors) and reports `is_distilled` + the worker-derived
  step/guidance defaults.

**Tests:**

- 8 new vitest cases in `lora-config.test.ts` (empty config, source
  resolution, scale+license, sidecar enforcement, malformed YAML,
  precedence ordering for `resolveLoraConfigPath`).
- 2 new vitest cases in `flux-image.test.ts` (end-to-end against the
  `--selftest` worker: lora-config forward-through, license
  sidecar path propagation).
- 2 new vitest cases in `flux-image.test.ts` (real LoRA download +
  real 4B pipeline smoke: `fal/flux-2-klein-4B-outpaint-lora`,
  Apache-2.0; pipeline ready in 27.5 s, lora adapter loaded, 75 s
  per image post-ready).
- `pnpm build` clean; all tests green at the time of the v0.5
  merge (the v0.5 entry is the same merge, since T5 + T6.1 landed
  there).

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T5 and §T6.1 marked
  shipped with the verification evidence.
- `README.md` — new "LoRA style adapters" section under "Local
  Image Generation".
- `packages/media-generators/python/README.md` — new "LoRA" section
  documenting the two surfaces (config file + env override).
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5.1 surface.

## v0.5 — local FLUX.2 Klein 4B image generation

The headline v0.5 release. Adds a fourth image provider
(`--image-provider flux`) that runs `black-forest-labs/FLUX.2-klein-4B`
locally on Apple Silicon via a Python sidecar (Hugging Face
`diffusers` + `pillow` + LoRA). No API key, no quota, no network
after the one-time ~22 GB weight download. The TS provider keeps
one warm pipeline across a render via a JSONL stdio protocol;
the worker applies MPS group offloading so the ~22 GB bf16 stack
fits in 24 GB unified memory on Apple Silicon.

T1–T4 of the v0.5 plan (`docs/v0.5-local-image-generation-plan.md`)
are all shipped: Python worker, TS provider, full pipeline
wiring (make + thumbnail), env config, weights downloaded. The
design doc was written first and the implementation followed its
acceptance criteria end-to-end (real-pipeline smoke on this M4:
load 27.5 s, first image 81 s incl. shader warmup, valid JPEG at
exact requested dimensions).

**User-facing CLI surface:**

- `video make <p> --image-provider flux` — scene visuals at
  1920×1080 from the local model.
- `video thumbnail <p> --provider flux` — 1280×720 thumbnails.
- New Python sidecar under `packages/media-generators/python/`:
  `uv sync` to install deps; `uv run python flux_worker.py
--download` to fetch weights; `uv run python flux_worker.py
--check` to verify MPS.

**Source-of-truth updates (this is a long list — v0.5 was a real
milestone):**

- `packages/media-generators/python/pyproject.toml` — uv-managed
  Python 3.12 env (lockfile committed): torch, diffusers,
  transformers, accelerate, peft, safetensors, pillow,
  huggingface_hub. (torchao added in v0.5.2.)
- `packages/media-generators/python/flux_worker.py` — JSONL daemon
  - `--check` / `--download` / `--selftest` / `--check-model`
    modes; VAE-align dim snapping + Pillow fit; MPS group-offload
    memory strategy; per-job error isolation.
- `packages/media-generators/src/image.ts` — `ImageProvider` contract
  unchanged (since v0.2).
- `packages/media-generators/src/flux-image.ts` — `FluxKleinImageProvider`
  implementing `ImageProvider` via worker subprocess; lazy spawn,
  ready handshake, per-job timeouts, crash-restart on next call,
  stderr tail surfaced in `ImageGenerationError`, `dispose()` +
  parent-exit kill.
- `packages/media-generators/src/{index,minimax-image,minimax-video}.ts` —
  new provider + new exports.
- `packages/make/src/index.ts` — `generateSceneVisuals` widens
  provider union to include `flux`; constructs `FluxKleinImageProvider`
  with env-resolved lora config.
- `packages/cli/src/{make,thumbnail}-command.ts` — `flux` added to
  the `--image-provider` and `--provider` choices; help text
  updated.
- `.gitignore` — `models/` (weights) and `.venv/` added.
- `eslint.config.mjs` — `**/.venv/**` and `**/models/**` added
  to ignores so the Python venv's bundled JS doesn't get linted.

**Tests:**

- New `packages/media-generators/src/flux-image.test.ts` — 6
  initial cases (provider name, empty-prompt guard, JPEG magic
  bytes, determinism, worker-error propagation, missing-sidecar
  guard).
- Real pipeline smoke on this M4: 640×384 at 6 steps, ~22 s warm
  per image, JPEG validated by PIL.
- `pnpm build` clean; all tests green at the time of the v0.5
  merge (per the v0.5 commit message: 227 across media-generators,
  make, and cli; 40 new tests added in this release on top of the
  pre-v0.5 baseline of 187).

**Docs synced in this release:**

- New `docs/v0.5-local-image-generation-plan.md` — the design
  doc for v0.5. Two human-edit files (`article.md`,
  `audio-config.yaml`) remain the only files a user must hand-edit.
  Derived files stay re-derivable and idempotent.
- `README.md` — new "Local Image Generation" section, the
  minimal-API table regenerated via `pnpm run docs:commands`.
- `packages/media-generators/python/README.md` — setup, usage,
  LoRA, env-knob table, protocol.
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5 surface.

## v0.5.3 — flux is the default; pre-flight health check

Two product calls in one release:

1. **`flux` is now the default image provider** for `video make`.
   `packages/make/src/index.ts:181` — `provider: opts.imageProvider ??
(opts.fake ? "none" : "flux")` (was `minimax`). The `mock` provider
   was the only other default-flip change this would conflict with;
   `--fake` keeps its existing "none" path. `video thumbnail` is
   intentionally untouched — its `mock` default is the right answer
   for a one-shot operation, and a user who wants flux on
   thumbnails passes `--provider flux` explicitly. No code change
   to the `--image-provider` flag — only the default when the
   flag is omitted.

2. **Pre-flight health check** before the first scene image
   generation. `FluxKleinImageProvider` runs `uv run python
flux_worker.py --check` once per provider instance; on
   failure, throws `ImageGenerationError` with the actionable
   fix hint: "Fix: cd packages/media-generators/python && uv sync
   && uv run python flux_worker.py --check". This catches the
   three real first-time-user failure modes (uv missing, python
   env not synced, weights not downloaded) with a clear message
   instead of a confusing traceback. Bypass with
   `FLUX2_SKIP_HEALTH_CHECK=1` (for CI / known-good envs).
   Doc §T7.

Side-effect fix from the same session: `spawnWorker` now
listens for the `error` event on the spawned `ChildProcess`.
Without this, an async spawn that fails with ENOENT (e.g. bad
`pythonBin` with bypass) would hang the ready handshake until
timeout. The bypass test exercises this path; the fix is two
lines + a comment.

**User-facing CLI surface:**

- `video make <p>` — now generates images via the local
  FLUX.2 Klein 4B by default (no flag required). If the local
  flux service is not ready, the render fails loud with the fix
  hint before any other work begins.
- `FLUX2_SKIP_HEALTH_CHECK=1` env — bypass the pre-flight check
  (e.g. for CI / a known-good env where uv + python + weights
  are already verified).

**Source-of-truth updates:**

- `packages/make/src/index.ts:181` — default image provider
  flipped from `minimax` to `flux` (gated on `!fake`).
- `packages/media-generators/src/flux-image.ts`:
  `FluxKleinImageProvider` now has `runHealthCheck()` called
  from `preflightAndSpawn()` (replaces the old direct
  `spawnWorker` call). The check runs once per provider
  instance (memoized via `healthChecked`); result is a
  synchronous throw with a clear error message. Bypass via
  `FLUX2_SKIP_HEALTH_CHECK=1`. Also adds a `proc.once("error",
...)` handler to the async `spawn` so ENOENT doesn't hang
  the ready handshake.
- `packages/cli/src/index.ts` — `VERSION = "0.5.3"` (BANNER
  displays "v0.5").

**Tests:**

- 3 new vitest cases in `flux-image.test.ts`:
  - health check exits non-zero → `ImageGenerationError` with
    the fix hint + "exited with code 1" + the `uv sync` command
    and `--check` flag
  - health check fails because `uv` itself is missing (ENOENT)
    → `ImageGenerationError` with "failed to spawn"
  - `FLUX2_SKIP_HEALTH_CHECK=1` honored → failure message does
    NOT contain "flux service not ready" (proves the bypass
    is engaged, even when the env is otherwise broken)
- 236 / 236 tests green.

**Docs synced in this release:**

- `docs/v0.5-local-image-generation-plan.md` §T7 marked
  shipped.
- `README.md` — `video make` snippet now implies flux as the
  default; "Local Image Generation" section notes the default
  change.
- `docs/INSTALLATION_AND_USAGE.md` — `video make` snippets
  updated to flag the flux default + the pre-flight check.
- `~/.agents/skills/video/SKILL.md` — synced to the v0.5.3
  surface.

## v0.4.3 — default `style.theme` flipped to `paper-light`

The default theme for any storyboard that doesn't declare one (and for
any `video draft` that doesn't pass `--style`) is now **`paper-light`**
instead of `dark-tech`. Unknown / misspelled theme names also fall back
to `paper-light`. The `dark-tech` palette and every other theme name
are unchanged — set `theme: dark-tech` explicitly in `article.md`
frontmatter or `storyboard.yaml` `style:` block to keep the old look.

**Rationale.** `paper-light` pairs naturally with the existing
`DoodleScene` (canvas hand-drawn) component, which forces its own
`paper` background regardless of theme; matching defaults reduce
disagreement. Tech-focused users who prefer `dark-tech` add one line
to their article frontmatter.

**Source-of-truth defaults updated:**

- `packages/video-components/src/theme.ts` — `resolveTheme()` returns
  `paperLightTheme` for both undefined input and unknown names.
- `packages/video-components/src/components/Background.tsx` — default
  prop switches to `paperLightTheme`.
- `packages/vdsl/src/schema.ts` — `styleSchema.theme` zod default →
  `"paper-light"`.
- `packages/vdsl/src/compile.ts` — fallback for missing theme →
  `"paper-light"`.
- `packages/draft/src/schemas.ts` — `articleToStoryboardYaml` reads
  `f.theme ?? "paper-light"`.
- `packages/cli/src/storyboard-command.ts` — `opts.style ?? "paper-light"`.
- `packages/cli/src/index.ts` — `--help` text for both `video draft` and
  `video storyboard` reflects the new default.

**Tests:**

- `theme-registry.test.ts` — `resolveTheme(undefined)`, `null`, `""`,
  and a typo all now resolve to `paperLightTheme`. Explicit
  `resolveTheme("dark-tech")` still returns `darkTechTheme`. Renamed
  the case "falls back to dark-tech for unknown/missing names" →
  "defaults to paper-light for unknown/missing names (v0.4.3)".
- `packages/draft/src/schemas.test.ts` — header assertion
  `style.theme: "dark-tech"` → `"paper-light"`. Other tests that
  supply an explicit theme name (the bulk of the suite) are unchanged.

**Docs:**

- `docs/INSTALLATION_AND_USAGE.md` §"Available themes (v0.4.3)" —
  intro + 8-row table now lead with `paper-light` as the new default.
- `docs/INSTALLATION_AND_USAGE.zh-CN.md` §"可用主题（v0.4.3）" —
  zh-CN mirror.
- `docs/schema.md` — `style.theme` example + table show
  `paper-light (v0.4.3 default)` first; pre-v0.4.3 storyboards still
  valid (back-compat preserved).

## v0.3.11 — remove the "old version" traces

**Branch:** `chore/v0.3.11-drop-legacy-traces`
**Tags:** `v0.3.11`

- **Doc cleanup**: deleted every user-facing "Legacy / 旧版 / 遗留" section. The minimal-API workflow is now the only path the docs lead with.
  - README: dropped the 14-row "Legacy commands (still working)" table and the (v0.4) header label; replaced with a single one-liner noting that the fine-grained per-stage verbs are wired for back-compat with older projects.
  - INSTALLATION_AND_USAGE (EN + zh-CN): removed §6.5 "Legacy core workflow", §7.1 "Legacy workflow commands", §9.5 "Legacy `video audio`", §12.8 "Legacy multi-command pipeline", the "Legacy AI agents" subsection, the "Legacy `final` says review is not approved" troubleshooting entry, and the introductory "Legacy multi-stage commands" mention. Also de-"legacy"-ified the remaining project-tree annotations and the `video youtube` fallback comment.
- **Code cleanup**: dropped the vestigial `slugifyForProject` identity passthrough from `packages/cli/src/project-path.ts` (a leftover from before `resolveProjectDir` became the single resolution entry point) and the unused import in `research-command.ts`.
- What was kept: RELEASES.md history, ARCHITECTURE.md, the design doc, and the legacy verb implementations themselves (`video audio`, `video audio-asset`, `video mix`, `video preview`, `video final`, `video approve`/`reject`/`rollback`, `video research`, `video script`, `video storyboard`, `video review`, `video youtube`, `video thumbnail`, `video shorts`, `video status`/`video resume`, `video validate`) still ship — they power existing projects and back-compat. The change is to remove the references from the user-facing surface, not the implementations.

## v0.3.10 — `video draft --file <path>` seeds the article with your own idea

**Branch:** `feat/v0.3.10-draft-idea-file`
**Tags:** `v0.3.10`

- **New `video draft --file <path>` flag** — accept a text or markdown file as the user's raw idea. The LLM treats it as the **major idea / opinions seed**: it polishes wording, structure, and flow, but the prompt explicitly forbids changing, contradicting, softening, or replacing any opinion expressed in the seed.
- `--file` and `--from` are **mutually exclusive** — `--from` revises an existing draft (different semantics); passing both is rejected at the CLI with a clear message.
- Empty / missing `--file` produces a readable error before the project lookup runs (input validation now precedes resolution so the user sees the most useful error first).
- Prompt split: existing `fromContent` ("Existing content to revise, preserve intent, improve as needed") is now joined by a distinct `ideaSeed` ("The user's major idea — polish wording, do NOT change opinions") rendered as its own user-message section.
- Tests: 365/365 pass; new "includes ideaSeed as the user's major idea with preserve-opinions wording" case in `schemas.test.ts`. Verified live on a fresh project: a seed file containing 3 stated opinions + a "don't go off-topic" instruction produced an article where all opinion-bearing terms survived (漂移 ×17, FVD ×5, Harness ×4, 指标 ×7) and forbidden off-topic terms (安全/自动驾驶) appeared 0 times.
- Docs: README draft row + INSTALLATION §6.1 + §12.0 + §13 walkthrough (EN + zh-CN).

## v0.3.9 — `video draft` merges the audio-plan step

**Branch:** `feat/v0.3.9-draft-merges-audio-plan`
**Tags:** `v0.3.9`

- **`video draft <topic>` now writes `article.md` AND `audio-config.yaml` in one invocation** (the audio-plan agent runs on the freshly drafted article, reusing the same provider + fallback routing). The minimal workflow drops from three commands to two: `video new` → `video draft` → `video make`.
- **Human-checkpoint guardrails**: an existing `audio-config.yaml` is never overwritten (hand edits win — the command prints a note pointing at `video audio-plan` to regenerate); `--no-audio-plan` skips the step for article-only drafts. If the audio-plan LLM call fails, the draft still succeeds with a hint to run `video audio-plan` separately.
- `video audio-plan` remains a first-class verb for regenerating the config after hand-editing article.md (incl. `--strict`).
- New exported helper `writeAudioConfigIfAbsent` in `draft-command.ts` (unit-tested merge policy: written / kept / failed / skipped).
- Tests: 364/364 pass; new `packages/cli/src/draft-merge.test.ts` (4 cases with a fake provider). Verified live end-to-end on a fresh project: one `video draft` produced article.md + storyboard.yaml + audio-config.yaml (voice/bgm/2 SFX cues); re-run kept the existing audio-config.yaml.

## v0.3.8 — every `<project>` argument accepts the topic, not just the folder name

**Branch:** `feat/v0.3.8-project-arg-resolution`
**Tags:** `v0.3.8`

- **New `resolveProjectDir` in `packages/cli/src/project-path.ts`** — one forgiving resolution ladder for every verb that looks up an existing project: (1) direct path to a project root, (2) exact folder name under `projects/`, (3) human topic slugified + case/separator-insensitive (`"Harness Engineering"` / `harness_engineering` / `harness-engineering` all match), (4) unique folder-name prefix. Ambiguous prefixes error listing candidates; zero matches list every available project.
- **Wired into all 14 lookup call sites**: `audio`, `audio-asset`, `mix`, `review`, `youtube`, `thumbnail`, `shorts` (previously raw `path.join` — exact folder name only), plus `make`, `audio-plan`, `draft` existence check, `preview`, `status`, and the five workflow verbs (`approve`/`reject`/`rollback`/`resume` + checkpoint). Generators (`new`/`research`/`script`/`storyboard`) keep slugifying, since they create directories.
- CLI `--help` argument descriptions updated to say "topic, folder name, path, or unique prefix".
- Tests: 360/360 pass; new `packages/cli/src/project-path.test.ts` (11 cases: exact / slug / underscore / CJK / unique prefix / ambiguous / zero-match listing / direct path / empty / non-project dir / missing projects dir).

## v0.3.7 — real BGM/SFX in `video make` via `--bgm-dir` / `--sfx-dir`

**Branch:** `feat/v0.3.7-make-audio-dirs`
**Tags:** `v0.3.7`

- **`video make <project> --bgm-dir <dir> --sfx-dir <dir>`** wires the existing `FileBasedAudioAssetProvider` into the make pipeline. The tags in `audio-config.yaml` (`bgm: calm`, `sfx: {scene_1: whoosh}`) resolve to `{tag}.wav` inside your library (exact filename first, then any `.wav` containing the tag). Without the flags the audio-assets step keeps writing 1-second silent mock placeholders — meaning the BGM ducking/fades in `video mix` were technically running over silence.
- Per-kind selection: `--bgm-dir` alone upgrades only BGM (SFX stays mock), and vice versa. A sibling `{tag}.license.txt` in your library is surfaced on the make report; a missing tag fails the `audio-assets` step readably (add the file or drop the cue).
- **`runMake` no longer crashes the CLI on a failed step.** `runStep` failures are recorded as `✗` steps and later steps are skipped (they depend on the failed step's outputs), so `video make` exits 1 with the per-step summary instead of a stack trace.
- `runAudioAssets` is exported from `@video/make` for direct testing.
- Docs: corrected earlier `--imageProvider` mentions to the real kebab-case flag `--image-provider`; new `--bgm-dir`/`--sfx-dir` guidance in §6.2 and §9.1 (EN + zh-CN).
- Tests: 349/349 pass; new `packages/make/src/audio-asset-dirs.test.ts` covers real-bytes copy + license surfacing, per-kind fallback to mock, mock default, and the missing-tag failure. Verified end-to-end on `projects/harness-engineering`: 290 s real BGM (25.5 MB) + 2 SFX cues land in `assets/audio-assets/` and `final-mixed.mp4` carries audible audio.

## v0.3.6 — `--fake` keeps scenes visible + malformed-draft narration recovery

**Branch:** `fix/v0.3.6-fake-image-default`
**Tags:** `v0.3.6`

- **`video make --fake` default imageProvider changed from `"mock"` to `"none"`.** The mock provider produced 64×36 solid-colour PNGs, and `updateStoryboardForImages` rewrote every scene from `AnimatedIllustration` (caption + animated SVG) to `ImageBackground` (image-only). For long videos this left ~9 minutes of blank frames after the title card. Defaulting to `"none"` skips image generation in offline mode and scenes keep `AnimatedIllustration`. Pass `--image-provider mock` explicitly if you want to exercise the ImageBackground path with placeholders.
- **`updateStoryboardForImages` carries the scene caption into the new ImageBackground props**, and `ImageBackground` now renders an optional bottom-overlay caption. So if image generation partially fails or mock images are in use, scenes still show their caption text.
- **`articleToStoryboardYaml` truncates long `Title.subtext`** at the first natural punctuation near 50 characters, so old drafts with very long LLM visual descriptions no longer overflow the 36 px subtext `<p>`.
- **LLM prompt tightened**: the `VISUAL DIRECTION` section now tells the drafter the renderer keyword-matches to a small shape vocabulary, so extra description beyond the matching keyword is dead weight that bloats on-screen captions.
- **Empty-narration draft recovery.** Real failure mode (seen on the `harness-engineering` project): the LLM puts all prose in `## N. ...` section bodies and ships every scene's `narration:` blank — the strict zod schema then rejected `video audio-plan` (and would have rejected `video make`) with an opaque 19-issue JSON dump. New `parseArticleWithRecovery` in `@video/draft`: strict parse first, and on the empty-narration failure back-fill narrations from section bodies (sentence-aware distribution across scenes; only `## N. ...` headings count, so the H1 title and hook block are never treated as a section). All four article.md consumers route through it — `video make` (surfaces a `recover-narrations` step in the report), `video audio-plan` (prints a warning + `video draft --from` hint), `video draft` storyboard-sync, and `video youtube`. `video audio-plan --strict` keeps the old fail-loudly behaviour for CI.
- **LLM prompt (narration)**: §7 SCENE NARRATION now states the narration field must contain the actual spoken content and that section bodies do not replace it.
- Tests: 345/345 pass; added `packages/make/src/fake-image-default.test.ts`, plus `schemas.test.ts` cases for lenient parse, recovery distribution, kept-verbatim scenes, `parseArticleWithRecovery` passthrough/rethrow, and subtext truncation.

## v0.3.5 — SFX cues + BGM fades + `video final --mix`

**Branch:** `feat/v0.3-sfx-cues-and-fade`
**Tags:** `v0.3.5`

- `audio-assets/mix.yaml` convention: `bgm`, `sfx: {scene_N: tag}`, `bgm_fade_in_sec`, `bgm_fade_out_sec`. CLI flags override the spec.
- New engine `mixTracksWithSpec` places SFX cues via `adelay` + applies `afade=in/out` to the BGM track.
- `video mix` reads `mix.yaml` (or `--mix-yaml <path>`) + supports `--bgm-fade-in/--bgm-fade-out` flags.
- `video final --mix` chains `runMix` after the final render so the published artifact is `output/final-mixed.mp4`.
- Docs: refreshed stale "What's NOT here yet" sections; consolidated ARCHITECTURE roadmap duplication.

## v0.3.4 — Audio mixing engine + `video mix` CLI

**Branch:** `feat/v0.3-audio-mix`
**Tags:** `v0.3.4`

- `@video/audio-mix` package with `mixTracks(opts)` using ffmpeg `concat` demuxer (list-file driven) + `amix` + `sidechaincompress` (BGM ducks ~-18 dB under narration).
- `video mix <project> --bgm <path> --bgm-attenuation <db>` verb.
- Pure mechanical ffmpeg pipeline — no AI, no network.

## v0.3.3 — Audio assets (BGM + SFX provider layer)

**Branch:** `feat/v0.3-audio-assets`
**Tags:** `v0.3.3`

- `@video/audio-assets` package with `AudioAssetProvider` interface.
- Two implementations: `MockAudioAssetProvider` (deterministic silent WAV placeholder, offline default) + `FileBasedAudioAssetProvider` (looks up `{tag}.wav` from `--bgm-dir`/`--sfx-dir`, reads optional `{tag}.license.txt`).
- `video audio-asset <project> --bgm <tag> --sfx <tag>` verb writes to `assets/audio-assets/{bgm,sfx}/{tag}.wav` + run record.

## v0.3 — Real AI providers (MiniMax image + video)

**Branch:** `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video`
**Tags:** `v0.3`

- `MiniMaxImageProvider` (`image-01`): powers `video thumbnail --provider minimax` for real AI thumbnails. Surfaces MiniMax envelope errors readably (e.g. 2056 quota, 1004 auth).
- `MiniMaxVideoProvider` (`MiniMax-Hailuo-2.3`, image-to-video): powers `video shorts --provider minimax`. Implements the full async flow: create task → poll until Success → download. Honest envelope-error handling.
- Both providers use `MINIMAX_API_KEY` env var (no API key for the MiniMax Coding Plan path — already set in this dev env).
- `ImageResult.contentType` widened to `"image/png" | "image/jpeg"`; `VideoRequest` extended with `firstFrameImageUrl`.

## v0.2 — Full v0.2 pipeline (8 phases)

**Branch:** `feat/video-agent-v01`
**Tags:** `v0.2`

- VDSL → Remotion → MP4 pipeline
- 10 motion components (Title, Paragraph, CodeBlock, Terminal, Image, FlowChart, Comparison, Timeline, Callout, EndCard)
- Checkpoint state machine + 10 CLI workflow verbs (`new`, `validate`, `status`, `approve`, `reject`, `rollback`, `resume`, `preview`, `final`, etc.)
- 5 LLM-driven agents (Storyboard, Research, Script, Review, YouTube) — all reuse `@video/llm` (MiniMax + GLM providers)
- Edge TTS voiceover (`@video/tts`)
- Benchmark video (`projects/benchmark-v01/`): 6 scenes, 39 seconds, zh-CN explainer about AI chain-of-thought
- §62.4 acceptance automation: 11/11 checks passing
- `bin/video` + `.opencode/command/video.md` for Pi Extension / OpenCode harness integration

## How the tags map to branches

| Tag       | Branch(es)                                                      | Merged in commit(s)                        |
| --------- | --------------------------------------------------------------- | ------------------------------------------ |
| `v0.2`    | `feat/video-agent-v01`                                          | merge commit on main                       |
| `v0.3`    | `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video`          | merge commit on main                       |
| `v0.3.3`  | `feat/v0.3-audio-assets`                                        | merge commit on main                       |
| `v0.3.4`  | `feat/v0.3-audio-mix`                                           | merge commit on main                       |
| `v0.3.5`  | `feat/v0.3-sfx-cues-and-fade`                                   | merge commit on main                       |
| `v0.3.6`  | `fix/v0.3.6-fake-image-default`                                 | merge commit on main                       |
| `v0.3.7`  | `feat/v0.3.7-make-audio-dirs`                                   | merge commit on main                       |
| `v0.3.8`  | `feat/v0.3.8-project-arg-resolution`                            | combined commit tagged `v0.3.9`            |
| `v0.3.9`  | `feat/v0.3.9-draft-merges-audio-plan`                           | merge commit on main                       |
| `v0.3.10` | `feat/v0.3.10-draft-idea-file`                                  | merge commit on main                       |
| `v0.3.11` | `chore/v0.3.11-drop-legacy-traces`                              | merge commit on main                       |
| `v0.4`    | (no separate branch — v0.4 landed on main)                      | **no tag** |
| `v0.4.1`  | (no separate branch — pi / oh-my-pi adapter landed on main)     | **no tag** |
| `v0.4.2`  | (no separate branch — four new `style.theme` palettes)          | **no tag** |
| `v0.4.3`  | (no separate branch — default theme flipped to paper-light)     | **no tag** |
| `v0.4.4`  | (no separate branch — cosmetic UX redesign landed on main)      | **no tag** |
| `v0.5`    | (no separate branch — v0.5 landed on main)                      | `a674437` (+ `d438666` lint config) — **no tag** |
| `v0.5.1`  | (no separate branch — T5+T6.1 landed on main)                   | `a674437` … (cumulative) — **no tag** |
| `v0.5.2`  | (no separate branch — T6.2 + T6.3 + fix landed on main)         | `3da7ff2`, `7d97608`, `638ac88`, `2170a4c` — **no tag** |
| `v0.5.3`  | (no separate branch — flux default + pre-flight landed on main) | TBD in commit message — **no tag** |
| `v0.6.0`  | (no separate branch — the advisory decision layer landed on main) | `c3d6691` — **no tag** |
| `v0.7`    | `v0.7-agent-ask`                                                | merge commit on main — tagged `v0.7` |
| `v0.7.1`  | (no separate branch — live progress landed on main)             | `ca178c3` — tagged `v0.7.1` |
| `v0.8`    | (no separate branch — visual guardrails landed on main)         | **no tag** |
| `v0.8.1`  | (no separate branch — minimax default landed on main)           | **no tag** |
| `v0.9`    | (no separate branch — visual cache + prompt evals landed)       | `7dadf48` — **no tag** |
| `v0.9.1`  | (no separate branch — TTS providers + draft quality bar)        | `0c9b11f` — **no tag** |

### Tagging gap (open)

`origin` carries 15 tags: `v0.2`, `v0.3`, `v0.3.3`–`v0.3.14`, `v0.7`, `v0.7.1`.
Every shipped release from `v0.4` onward except `v0.7` / `v0.7.1` is missing
its tag — and **no GitHub Release exists at all** (`gh release list` is
empty). A version bump with no tag is a half-shipped release: `git describe`
and `gh release` both under-report what `main` contains. Backfill before the
next minor ships:

```bash
git tag -a v<X>.<Y> -m "<summary>" <release-commit>   # one per missing release
git push origin v<X>.<Y>
gh release create v<X>.<Y> --title "v<X>.<Y> — <summary>" --notes-file <RELEASES.md section>
```

## Versioning convention

- **v0.x.y** — development tags, may be incremented without a strict semver contract.
- **Major bumps (v1.0)** reserved for the first production-ready milestone after GLM image + cloud rendering land.
- **Minor bump ⇒ git tag + GitHub Release (required).** When the minor
  component changes (`v0.9` → `v0.10`, `v0.9.1` → `v0.10`), the release is
  **not finished** until all three exist:
  1. An annotated tag on the `main` commit that carries the new version —
     `git tag -a v<X>.<Y> -m "<summary>" <release-commit>`.
  2. The tag pushed — `git push origin v<X>.<Y>`.
  3. A GitHub Release — `gh release create v<X>.<Y> --title "v<X>.<Y> — <summary>" --notes-file <RELEASES.md section>`.

  The GitHub Release body is the matching `## v<X>.<Y>` section of this file.
  A minor bump shipped without a pushed tag **and** a GitHub Release is a
  bug, not a style choice.
- **Patch tags (`v0.9.1`) are optional** — tag them when the change is
  user-visible, skip them for internal churn.
- **Three version sources, one commit** — `package.json`,
  `packages/cli/package.json`, and `packages/cli/src/version.ts` (`VERSION`)
  must carry the same number in the release commit; the tag names that number.
- Tags are immutable; new work creates a new tag rather than moving an old one.
- **Package manager**: this project uses **pnpm 12.5+** (enforced via the `packageManager` field in `package.json`). The lockfile is `pnpm-lock.yaml`; do not commit `package-lock.json`.
