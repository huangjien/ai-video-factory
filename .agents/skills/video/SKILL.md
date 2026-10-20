---
name: video
description: Operate the AI Video Factory monorepo — a pnpm TypeScript pipeline that turns a topic into a 1080p Chinese MP4 via `video draft` and `video make`. Use when the user works in this repo, asks about `video` subcommands, needs to set up the environment, or wants to generate/research/script/storyboard/render/audit/publish a video.
metadata:
  author: local
  source: internal://~/workspace/ai-video-factory
  version: "0.9.1"  # mirrors packages/cli/src/version.ts — the doc reflects the BINARY version, the git/release tag is in docs/RELEASES.md
  last_reviewed: 2026-10-17
  local_only: true
  shipped_versions: [v0.4, v0.5, v0.5.1, v0.5.2, v0.5.3, v0.6, v0.6.0, v0.7, v0.7.1, v0.8, v0.8.1, v0.9, v0.9.1]  # mirrors docs/RELEASES.md tag table
---

# AI Video Factory

A pnpm TypeScript monorepo. Two human-edit files (`article.md`, `audio-config.yaml`) drive the pipeline; everything else is derived. Final output is a 1920×1080@30fps MP4 with narration + BGM + SFX.

**Trigger**: load this skill when the user is inside `~/workspace/ai-video-factory` (or any descendant), or mentions `video`, VDSL, storyboard, draft, make, shorts, or YouTube packaging.

## 1. Setup (run first if anything fails)

The repo provides a checker. Run it and act on each line:

```bash
bash ~/.agents/skills/video/scripts/check_setup.sh
```

It checks: Node ≥22, pnpm 12.5+, FFmpeg + ffprobe on PATH, the `video` binary resolvable, and `MINIMAX_API_KEY` set if not using `--fake`. Offer to install what's missing:

| Missing | Fix |
|---|---|
| Node | `brew install node` (mac) or `nvm install 22` |
| pnpm | `corepack enable && corepack prepare pnpm@12.5.1 --activate` |
| FFmpeg | `brew install ffmpeg` (mac) / `apt-get install ffmpeg` (linux) |
| `video` binary | Symlink `bin/video` into a PATH dir: `ln -sf ~/workspace/ai-video-factory/bin/video ~/.local/bin/video`. `bin/video` resolves the symlink via `realpath $0` so it works from any PATH location. |
| API key | export `MINIMAX_API_KEY=…` (or `GLM_API_KEY=…` for the LLM) |

### How `video` resolves

```
video                 ← from PATH (e.g. ~/.local/bin/video)
  └→ symlink to    ~/workspace/ai-video-factory/bin/video
      └→ exec      node ~/workspace/ai-video-factory/packages/cli/dist/index.js "$@"
```

The CLI source lives at `packages/cli/src/index.ts`. After `pnpm build`, the entrypoint is `node packages/cli/dist/index.js`. `bin/video` is a thin bash wrapper that resolves the real script path with `realpath $0` before computing the project root — **without that, calling `video` via a symlink breaks** (the wrapper used to use `dirname $0`, which is the symlink path, not the target).

## 2. Major commands

Minimal API (v0.3.9+ recommended) — two commands do the whole pipeline:

```bash
video draft "<topic>"   # LLM writes article.md + audio-config.yaml + derived storyboard.yaml
                        # quality gate: an LLM judge scores 8 dimensions × 24 indicators on a
                        # 0-100 weighted scale (bar: 90 = grade A; Critical risk flags fail
                        # regardless of score); below-bar drafts are regenerated with the
                        # judge's feedback (default 8 attempts, top-scoring candidate wins
                        # even if nothing passed; a judge failure degrades to accepting the
                        # draft unreviewed) → article-review.yaml sidecar. Implementation:
                        # packages/draft/src/article-review.ts (runScoredDraft).
                        # Flags: --no-review, --min-score <n>, --max-attempts <n>;
                        #         --ask/--no-ask (agent questions, §2.6), --bgm <tag|none>
video make <project>    # TTS → audio assets → render scenes → mix → final-mixed.mp4
```

Full command set:

| Command | Purpose |
|---|---|
| `video new <id>` | Scaffold `projects/<id>/` |
| `video draft <topic>` | Generate `article.md` + `audio-config.yaml` + derived `storyboard.yaml` (LLM) |
| `video script <topic>` | Narration script only |
| `video storyboard <topic>` | VDSL storyboard only |
| `video audio-plan <project>` | Voice / BGM / SFX plan |
| `video audio <project>` | TTS narration |
| `video audio-asset <project>` | BGM + SFX |
| `video make <project>` | Full render: TTS → assets → scenes → mix → `final-mixed.mp4` |
| `video preview <project>` | Fast preview render |
| `video review <project>` | LLM review (content / visual / technical) |
| `video approve [stage] <project>` | Approve a stage |
| `video reject <project> <reason>` | Reject current stage |
| `video final <project>` | Final mixed MP4 with narration + BGM + SFX |
| `video validate <storyboard.yaml>` | VDSL schema check |
| `video status [project]` | Pipeline state |
| `video thumbnail <project>` | YouTube thumbnail (MiniMax image) |
| `video shorts <project>` | 60s Shorts clip (MiniMax video) |
| `video youtube <project>` | Title / description / chapters / shorts hook; `--upload` publishes final-mixed.mp4 + thumbnail directly (OAuth: `video youtube --auth` once, then `--privacy private\|unlisted\|public`, default private) |
| `video bilibili <project>` | Bilibili submission metadata: title / 简介 / ≤10 tags / suggested 分区 / cover prompt → `bilibili/CHECKLIST.md`. **Packaging only — Bilibili has no public upload API**, so the last step is manual. Never hard-fails: a bad model response degrades to a deterministic package with a warning. |
| `video visuals <project>` | v0.8: generate scene images + contact sheet for review (gate off by default) |
| `video research <topic>` | Facts + sources + claims package (feeds draft) |
| `video motion <project>` | Per-scene animation timelines (agent + heuristics) |
| `video mix <project>` | ffmpeg mix only (BGM + narration + SFX) |
| `video qa <project>` | Render report + contact sheet |
| `video scene <project> list/restore/approve` | Per-scene version store |
| `video excalidraw <project>` | `.excalidraw` asset → animated SVG |
| `video studio <project>` | Remotion Studio live-preview workspace |
| `video theme [name]` | Palette inspector (list / one / resolve project) |
| `video character [list \| approve <id> <style> <version> --by <name>]` | Character bible: list the characters and their per-style reference sheets, or promote a candidate to the official sheet (stamps the reviewer, supersedes the previous one) |
| `video laya health/ask/eval` | Laya decision-sidecar diagnostics (advisory) |
| `video learn <project>` | Human-review learning loop (`--ask`/`--answer`/`--status`/`--propose`) |
| `video prompts [show <name>]` | Inspect the central prompt registry (`packages/prompts/prompts/`) |

Every command accepts `--cwd <dir>` (default `projects/`). Every step writes `runs/<id>.yaml` and updates `state.yaml`.

### Visual components (registry — 24 components)

`video make` re-derives `storyboard.yaml` from article.md on every run: each scene's `visual:` field is keyword-matched by a deterministic classifier (`packages/draft/src/visual-classifier.ts`), which picks a component and a prop builder fills structured props from caption/narration/prose. First scene is always Title. When editing article.md, steer visuals by putting trigger keywords in `visual:`:

| Trigger keywords in `visual:` (en / zh) | Component | Look |
|---|---|---|
| quote, 引用/名言/金句 | `QuoteBlock` | quote card + `——author` attribution |
| %, percent, 增长/百分比/统计 | `StatGrid` | big numbers with count-up |
| chart, distribution, 柱状图/分布 | `BarChart` | animated horizontal bars from `label: 40%` pairs |
| ranking, top-5, 排名/榜单/冠军 | `Leaderboard` | ranked rows, #1 lands last |
| checklist, 注意事项/避坑 | `Checklist` | check marks stroke on per item |
| key insight, takeaway, 核心观点/一句话 | `BigIdea` | full-screen statement, token reveal |
| pyramid, hierarchy, 金字塔/层级 | `PyramidDiagram` | layers drawn bottom-up |
| venn, overlap, 交集/重叠 | `VennDiagram` | 2-3 translucent circles |
| cycle, loop, 循环/闭环/飞轮 | `CycleDiagram` | stages on rotating ring |
| network, pipeline, flow, node, 流程/步骤/节点 | `FlowChart` | boxes and arrows |
| code, terminal, 代码/命令行 | `Terminal` | typewriter listing |
| timeline, history, 历史/年表 | `Timeline` | events on a line |
| formula, 公式 / database, 数据库 | `Callout` | info/warning/success card |
| list, bullet, 列表/要点 | `Checklist` | item rows with stroke-on check marks (DoodleScene never auto-selected) |
| (no match) | `AnimatedIllustration` | generic shapes, or the generated image once one exists |

Only the last row reaches the image model. Every row above it is a
self-rendered component, and `selfRenderedSceneNumbers()`
(`packages/make/src/visual-cache.ts:47`) **skips image generation for those
scenes entirely** — so a trigger keyword silently costs that scene its
picture. There is no `Comparison` or `SvgScene` component any more; `对比`
and `流程` route to nothing and `FlowChart` respectively.

Renderers: `remotion` covers every registered component; `canvas` → DoodleScene. New scenes need no YAML hand-editing — the storyboard regenerates, but hand edits to `storyboard.yaml` are overwritten by the next `video make` (article.md is the source of truth). One-off visual check of all components: `node scripts/render-visual-smoke.mjs` → stills in `.omo/tmp/visual-smoke/`. Branding smoke: `node scripts/render-brand-smoke.mjs` → `.omo/tmp/brand-smoke/`.

### How a `visual:` line becomes an image prompt

Only `AnimatedIllustration` / `ImageBackground` scenes reach the image model.
Everything else is a deterministic Remotion component. For those image
scenes, a cheap LLM call expands the `visual:` line into one paragraph
following a fixed six-part structure — **subject → scene → composition →
lighting → style → constraints** — which is the whole prompt contract:

| Part | What it must carry | Weak | Strong |
|---|---|---|---|
| Subject | one concrete thing a camera could film | "token counter" | "a hand tipping a jar of paper slips past the rim" |
| Scene | real setting, one action in progress | "about context" | "a blank sheet on a dark desk beside an open ring binder" |
| Composition | named shot + where the subject sits + three depth layers | "person in a kitchen" | "close-up three-quarter view from above, sheet in the left third, blurred keyboard in the near foreground" |
| Lighting | **one** concept: source, direction, quality | "dramatic lighting" | "warm desk lamp from the upper right, cool fill from the left" |
| Style | medium + linework/texture + palette | "beautiful illustration" | "flat vector, solid fills, navy / slate blue / amber, no gradients" |
| Constraints | the quiet overlay zone + exclusions | (omitted) | "keep the lower third quiet; no text, no letters, no labels" |

Two things decide image quality, in this order:

1. **Specificity, not adjectives.** Concrete nouns and directions are
   control; "epic, highly detailed, 8K" is noise the model ignores.
2. **A locked palette, reused in every scene.** Cross-scene consistency
   comes from the preset's palette and lighting philosophy, not from any
   single prompt. Each preset in `image-styles.yaml` names its exact colors
   and the expander is told to reuse them.

The `visual:` line is only a **category hint** — often two Chinese words, and
sometimes a raw narration sentence that was never hand-edited. The expander
is instructed to invent the concrete subject, setting and action from the
narration. If a scene's art keeps coming out generic, the fix is usually a
richer `visual:` line in `article.md`, not a prompt edit.

Edit the contract in `packages/prompts/prompts/draft-image-prompt.md` and
`image-styles.yaml`; `video prompts show draft-image-prompt` prints it.

**Gotcha — reasoning models.** The expansion LLM is reasoning-enabled, so
its raw response starts with a `<think>` block. `expandScenePrompt` strips
that before slicing to the character budget. If you ever see `<think>` in a
`scene_N.prompt.txt`, or in `.prompt-cache/*.json`, the strip regressed —
before that fix the thinking consumed the whole budget and the image model
received meta-commentary instead of the scene.

### Captions carry no background, and only one set of them per scene

Two hard rules, both from watching real output rather than from the spec.

**No plate.** Captions sit on a generated image, so whatever is behind them
changes every re-render. A background colour is only ever legible against
one particular picture, so legibility comes from the glyphs instead: a
four-way `text-shadow` outline plus a soft spread, in whichever direction
the theme's text colour needs (Rec. 601 luma; 7 of 9 themes are light-ink,
2 are dark-ink). Outline with `text-shadow`, **not** `-webkit-text-stroke` —
a stroke is painted centred on the glyph edge, so it thins the letterform,
and CJK horizontals are barely 2px wide at 35px. Type is
`CAPTION_FONT_RATIO` (0.032) of frame height ≈ 35px at 1080p, down from 0.042
(45px), which covered the image it was captioning. Shared by
`captionStyle.ts`, so `CaptionsOverlay` and `ImageBackground` cannot drift.

**What the overlay burns in: `captions_source`.** `article.md` frontmatter takes
`narration` (default) or `caption`. The overlay is validated against the
bottom safe area — 3 lines × 24 CJK units, ASCII counting 0.5 — so an
English scene caps near 144 characters while English narration runs 150-220
per scene. `source: narration` therefore fails validation on nearly every
scene of an en-US article and `video make` refuses to render. Use
`captions_source: caption` for English: it burns the scene's short `caption:`
label, passes at any language, and stops a designed card printing its own
text twice. `no_captions: true` turns the overlay off entirely.

**One caption per scene, and the short label wins.** Two layers can draw a
caption: the `CaptionsOverlay` track, and `ImageBackground`'s own `caption`
prop, which `video make` fills from the scene's `caption:` field. Both draw
at the bottom of the frame, so when both fired the frame showed two
different lines printed on top of each other — unreadable, on every image
scene. `captionWiring()` in `Root.tsx` decides, and returns BOTH halves in
one call (`componentPropOverride` + `renderTrack`) so they cannot disagree.

Precedence: **the component's own caption wins**, because it carries the
`caption:` field — the human's short on-screen label, a few words per the
article spec — while the track falls back to the narration when
`captions.source` is `narration`, which is a sentence or two and far too long
to burn in. The track still owns every non-image scene, and any image scene
whose caption is empty.

Two traps when touching that wiring:

- `scene.props` is spread into `baseProps` **first**, so the decision has to
  actively *unset* `caption`. Inverting the override does not fail any
  assertion on `sceneCaptionOwner` — the component just silently loses its
  caption while the track stays gated off, and the scene renders with no text
  at all. This happened, and was caught by rendering a still, not a test.
- Assert that override with `toStrictEqual`, **not** `toEqual`. Vitest's
  `toEqual` treats `{caption: undefined}` as equal to `{}`, which makes the
  assertion blind to precisely the inversion it exists to catch.

Changing caption type or the halo? `packages/video-components/src/captionStyle.ts`
is the single source; both renderers read it. To eyeball it against a real
image, render one still over a project's `assets/images/scene_N.jpg` rather
than trusting the markup assertions.

### Every render cache needs the thing that made it as an input

Three caches decide "can I reuse this?" — and each one was blind to a class
of change. The rule: **if an input can change the output, it belongs in the
cache key.** Bump the matching revision when you edit the thing it names.

| Cache | Key | Revision to bump | Set when |
|---|---|---|---|
| Scene mp4 (`scenes/*.mp4.json`) | fragment hash + `projectHash` + audio + `rendererRevision` | `RENDERER_REVISION` in `packages/video-renderer/src/pipeline.ts` | any change under `video-renderer/src` or `video-components/src` that alters a frame |
| Scene image (`assets/images/scene_N.jpg`) | scene content + style + provider + `learnedDigest` + `promptRevision` | `IMAGE_PROMPT_REVISION` in `packages/draft/src/image-prompt.ts` | the brief expander prompt, its stripping rules, or its instruction text changes |
| Image brief (`assets/images/.prompt-cache/*.json`) | scene content + style + learned + `IMAGE_PROMPT_REVISION` | same | same |

Why this bit us twice, on the same day:

- Changing the caption treatment left all **59** cached scene mp4s across the
  four shipped projects matching — no storyboard edit, no theme flip, no audio
  change, so every one would replay the old plate and 45px type. The change
  was invisible in any re-render.
- The `make --dry-run` impact table then reported **all 59 as "cached"**, so
  even the preview lied.

So `rendererRevision` is stored as an explicit sidecar field, not folded into
`projectHash`: the dry-run has no compiled renderPlan and must not rebuild one
to answer "will this re-render?" — it string-compares the same exported
constant the pipeline stamps. `projectHash` (theme/brand/geometry) still gates
freshness at make time and is deliberately not predicted by the table; it can
only force *more* work than the table shows, never less.

Do not bump a revision for a refactor with identical output — an unnecessary
bump re-renders every scene and re-synthesises every image. Hashing the source
tree instead would re-render on every comment edit, which is why these are
deliberately manual.

### MiniMax `image-01` request limits (verified 2026-10-17)

From the official `ImageGenerationReq` OpenAPI for `POST /v1/image_generation`
(`platform.minimax.io/docs/api-reference/image-generation-t2i`). Re-read
that page rather than trusting this table if you change the provider:

| Fact | Consequence here |
|---|---|
| `prompt_optimizer: boolean`, default `false` | Sent **explicitly** as `false`. The brief's palette lock and reserved overlay zone are the whole point; a server-side rewrite discards them. Opt in with `new MiniMaxImageProvider({ promptOptimizer: true })` to A/B the two modes on one scene. |
| `prompt` max **1500 characters** | Longest real prompt is brief (700) + longest suffix (333) = 1033, so this is headroom. `MiniMaxImageProvider` throws locally rather than spending a request on a 400. |
| 8 aspect ratios only: `1:1 16:9 4:3 3:2 2:3 3:4 9:16 21:9` | `aspect_ratio` wins over raw `width`/`height`, so the provider maps to the nearest supported ratio. 1920×1080 → `16:9`. Pinned by test, not memory. |
| **No `subject_reference` field** | MiniMax's text-to-image endpoint takes no reference image, despite the parameter appearing in MiniMax's own skills scripts. There is no conditioning path for scene backgrounds — cross-scene consistency is textual (locked palettes), not reference-based. |
| **No `aigc_watermark` field** | A provider watermark cannot be suppressed via the API. The prompt-level `no watermark` rule is the only lever. |

**Iterating on a bad image.** Change one instruction at a time, then
`video make <project> --dry-run` to see which scene images that change would
regenerate before anything is spent. To re-render one rejected scene:
`video visuals <project> --reject <scene> --reason "<why>"` records the
reason and force-regenerates that scene, and writes a Pillow contact sheet
to `assets/images/contact-sheet.png` for review. `video approve visuals
<project>` freezes the set; add `require_visual_approval: true` to
`article.md` frontmatter to make `video make` enforce it.

### Generated images carry NO readable text

**Hard rule. Image models cannot render writing — they emit
confident-looking gibberish, and CJK comes out worse than Latin.**

Observed failure (`projects/skill-vs-agent`, `image_style: editorial`): three
consecutive scenes returned full two-page spreads of fake paragraphs, and a
fourth came back as a doodle sheet captioned *"LAGH'S KEY OF OURAMMING
BEAGY…"*. A `no text` suffix on the prompt did not prevent it.

**The line is drawn at READABILITY, not at the presence of marks.** What
fails is a viewer-readable sign, title, UI or watermark. What passes is
marks the viewer cannot make out — the texture of a printed page at a
distance, blurred impressions, a page of dense illegible strokes, a small
seal whose characters cannot be read. Those read as a page or a signature,
which is what the scene wanted. Acceptance: **if the audience cannot tell
the marks are wrong or odd characters, it passes.** `projects/写好小说`
scene_14 (a manuscript covered in dense illegible strokes, three marker
notes, a reader's finger) is the reference case.

| Never put in a `visual:` line | Write this instead |
|---|---|
| "a poster reading '思考链'" | "a printed poster with indistinct marks" |
| "a screen showing the title 思维链" | "a screen with blurred unreadable content" |
| "a shopfront sign saying 杂货" | "a shopfront with an unreadable sign" |
| "a page of handwritten notes" | "a page covered in vague scribbled lines" |
| a readable title, sign, UI or watermark | omit entirely, or make it illegible |

The rule is enforced in `styleSystemBlock()`
(`packages/draft/src/image-style.ts`), which injects these constraints into
**every** prompt expansion on top of each preset's suffix.

Treat every exclusion as an instruction, not a guarantee — the model still
occasionally produces words. Anything that must be legible is drawn by the
renderer instead.

**Division of labor** — never let a model draw what a renderer can place:

| Owner | Content |
|---|---|
| Image model | subject, environment, lighting, palette — **never text** |
| Remotion components | geometry, layout, diagrams, counters, captions |
| Pillow, or YouTube Studio | any legible text that must exist |

`visual:` lines steer the deterministic component classifier too: any
trigger keyword in the table above turns the scene into a self-rendered
component and it loses its generated image. `对比` steers nothing. See the
trigger table above.

> **Pillow caveat (since v0.9):** the in-pipeline Pillow text-overlay that
> used to burn captions into generated images was removed with the local
> diffusion provider. On-screen text now comes from Remotion components and
> `CaptionsOverlay`; thumbnails must have their title typed in YouTube
> Studio. `contact_sheet.py` is the only remaining Pillow pass and it draws
> review labels, not production text.

### Visual asset guardrails (v0.8)

Three guardrails around the least-reviewed part of the pipeline. Plan: `docs/v0.8-visual-guardrails-plan.md`.

**Content-keyed image cache (G1).** Every generated `assets/images/scene_N.jpg` carries a `scene_N.cache.json` sidecar hashing its inputs (visual line, `image_style`, provider, geometry). Editing a scene's `visual:` line, flipping `image_style`, or changing a ref image **deletes the stale jpg and regenerates it on the next `video make`** — pre-v0.8 the cache keyed on file existence, so edits never propagated. Pre-existing images without a sidecar are *adopted* (kept + sidecar written), so upgrading never re-spends. Run `video make <project> --dry-run` to see exactly which images regenerate before spending.

**Keyframe review (G3/G4, opt-in).** Add `require_visual_approval: true` to `article.md` frontmatter, then:

```bash
video visuals <project>                              # generate + contact sheet (assets/images/contact-sheet.png)
video visuals <project> --reject 7 --reason "太暗"    # force-regenerate one scene this run
video approve visuals <project>                      # freeze the current set into checkpoints/visuals.yaml
```

`video make` then refuses to render until the on-disk image set matches the approved checkpoint, naming the stale scenes. Gate off (default) ⇒ `make` behaves exactly as before. Reject requires an existing approved checkpoint; rejections force-regenerate on the next `video visuals` run.

## 2.5 Branding & marketing (root `brand.yaml`)

Branding lives at the WORKSPACE root — `<repo>/brand.yaml` + `<repo>/assets/brand/*` — and EVERY project inherits it automatically at render time (preview / final / make). Override per project by dropping `projects/<id>/brand.yaml` (per top-level key; a project `intro:` replaces the root `intro:` wholesale). Paths resolve relative to the brand.yaml that declared them.

```yaml
# <repo>/brand.yaml  (shipped default: name "AI 视频工厂" + placeholder icon)
brand:
  name: "我的频道"              # shown in the intro band
  icon: assets/brand/icon.png   # corner watermark on EVERY scene (png/jpg/svg)
  corner: bottom-right          # top-left|top-right|bottom-left|bottom-right
  size_px: 72                   # at 1080p; scales with composition width
  opacity: 0.85
  intro:                        # fixed branded opening (omit = no intro chrome)
    duration_sec: 15            # 10-20s is the marketing norm
    background: aurora          # aurora|sunset|ocean|citrus
    show_name: true
```

Multi-BGM — different music for the opening vs the body, in `audio-config.yaml` (overrides `bgm`; `track` = named tag generated like `bgm`, or a file path resolved project-first then workspace-root — shared brand audio lives in `<repo>/assets/brand/`; `until_sec` = absolute window end, last entry runs to the end):

**BGM comes from a local library, never a service.** `assets/bgm/` holds the
curated tracks (`<mood>-<slug>.mp3` + a sibling `.license.txt`); `music.json` is
its index, carrying each track's real duration/LUFS/dynamic-range plus scenario
notes. `bgm: <tag>` in `audio-config.yaml` resolves against the project's own
`assets/audio-assets/bgm/` first, then `assets/bgm/`, then `assets/brand/`; an
unresolvable tag warns and mixes silence rather than failing the render. The
file is handed to ffmpeg in place — it is never copied per project. Track it
shorter than the runtime and it loops, so prefer `needs_loop_under_300s: false`
for long videos; the mixer applies one fixed bed level, so avoid
`quiet_master` tracks that would vanish under narration.

`bgm_tracks` still works for multi-window timelines; path-shaped `track` values
resolve project-first then workspace-root.

```yaml
bgm_tracks:
  - { track: calm, until_sec: 18 }   # branded opening mood
  - { track: epic }                  # rest of the video
```

Windows crossfade (1s) into one timeline wav (`assets/audio-assets/bgm/_timeline.wav`), then mix through the normal ducker/fades.

## 2.6 Agent question protocol (video-ask/1, v0.7)

Inside an agent harness (zcode, Claude Code, opencode, pi, OMP), `video draft` auto-detects the agent and — when any style knob was left unspecified — prints a question set to stdout and exits 2 instead of burning a full scored draft on silent defaults (`zh-CN`, 180 s, `flat-vector`, `paper-light`, `calm`). Exit 2 means the run did NOT start: zero spend, zero files written.

| Exit | Meaning |
|---|---|
| 0 | ran |
| 1 | failure (unchanged) |
| 2 | questions pending — run not started, nothing spent |

In the ask path stdout is pure JSON (parseable with `jq`); human-readable hints go to stderr. Questions are only ever asked for knobs the caller did not explicitly pass — a fully flagged replay never exits 2, even inside an agent session.

Rules:

1. On `video draft` exit 2: parse stdout as JSON; dispatch on `protocol === "video-ask/1"`.
2. Present the **recommended option first, labeled "(Recommended)"**; render each choice's `note` as its description. Never bury the recommendation.
3. The agent may replace the static recommendation with a topic-aware pick when the topic clearly demands it (e.g. 鸿门宴 → `liubang-xiaodiao` + `editorial`) and MUST state the reason in the question text. The CLI stays deterministic; the agent, which knows the topic, owns the final highlight.
4. **Render as a clickable UI whenever the harness has one — never as prose tables.**
   - **OpenCode ≥1.19**: relay ALL questions through the native `question` tool
     (one call, up to 6 questions — no batching needed). Map each video-ask
     question to `{header: <id>, question: <question>, options: choices.map(c =>
     ({label: c.value, description: c.note}))}`; put the recommended value
     FIRST with its description prefixed `(Recommended) — `. For `duration`
     (number type), offer the `suggestions` as options. Execution pauses
     until the user clicks; map answers → flags, re-run. Requires
     `permission.question: "allow"` in opencode.json (set 2026-10-15) and
     the TUI client.
   - **zcode-style UIs (4-question limit)**: present in two batches —
     narration (`lang`, `duration`, `bgm`), then look-and-feel
     (`image_style`, `style`).
   - Text-table fallback is a LAST resort when no question UI exists at all.
5. Map answers → flags, re-run with the same topic. All knobs explicit → no second ask (normal run).
6. Unattended sub-runs (scripts the agent launches that call draft internally) pass `--no-ask`; headless cron/launchd shells set `VIDEO_ASK=off`.

Overrides: `--ask` / `--no-ask` flags; `VIDEO_ASK=force|off` env (unknown value → auto with a stderr warning).

Exit-2 shape (abbreviated):

```json
{
  "protocol": "video-ask/1",
  "command": ["draft", "鸿门宴"],
  "detected": "zcode (ZCODE_APP_VERSION)",
  "questions": [
    {
      "id": "lang", "flag": "--lang", "type": "choice",
      "question": "Narration language?",
      "choices": [
        { "value": "zh-CN", "note": "Chinese narration (repo default)" },
        { "value": "en-US", "note": "English narration" }
      ],
      "default": "zh-CN", "recommended": "zh-CN",
      "why": "a wrong guess costs a full regen (~4× one draft)"
    }
  ],
  "resolved": { "lang": "zh-CN", "duration": 180, "audience": "developers",
                "image_style": "flat-vector", "style": "paper-light", "bgm": "calm" }
}
```

`questions[]` holds one entry per unspecified knob (stable order: `lang`, `duration`, `image_style`, `image_provider`, `style`, `bgm`), each with `recommended`, `{value, note}` choices, and a `why`. `resolved` echoes the full effective config (explicit + defaults) — use it to show "keeping X" or to pass a complete flag set back.

Re-run pattern (all knobs explicit → no second ask):

```bash
video draft "<topic>" --lang zh-CN --duration 120 \
  --image-style editorial --image-provider minimax \
  --style paper-light --bgm guofeng
```

### The six knobs, and what each one buys

Ask about all of them. Each is a silent default today, and each one
wrong costs a paid re-render.

| Knob | Flag | Silent default | Why it is worth asking |
|---|---|---|---|
| `lang` | `--lang` | `zh-CN` | narration language drives every downstream prompt |
| `duration` | `--duration` | `180` | scene count scales with it |
| `image_style` | `--image-style` | `flat-vector` | taste call, unrecoverable post-render |
| `image_provider` | `--image-provider` | `minimax` | decides **cost** and visual character; every scene image re-spends when it changes |
| `style` | `--style` | `paper-light` | theme repaints every scene |
| `bgm` | `--bgm` | `calm` | generated per tag at make time |

`--image-provider <minimax|openai|gemini|mock|none>` and `--image-style`
both stamp into **`article.md` frontmatter** (`image_provider:` /
`image_style:`) — `article.md` is the durable source of truth, so
`video make` honors them without the flag being passed again.
Precedence: explicit `--image-provider` flag > `--fake` (⇒ `none`) >
frontmatter > `minimax`. An unrecognized frontmatter value falls back to
`minimax` rather than failing — `article.md` is hand-edited.

`--bgm <tag|none>`: the answered tag is stamped into a **fresh** `audio-config.yaml` (`none` → `bgm: null`); an existing `audio-config.yaml` wins (warning printed, file untouched); `--no-audio-plan` drops the `bgm` question entirely.

## 3. Canonical end-to-end

```bash
# 1. Scaffold
video new "transformer architectures"

# 2. Two human-edit checkpoints via LLM
video draft "transformer architectures"
#   → edit projects/.../article.md and projects/.../audio-config.yaml
#   article.md narrations drive scene visuals; audio-config.yaml drives voice/BGM/SFX

# 3. Render
video make transformer-architectures
#   writes output/final-mixed.mp4

# 4. (Optional) Publish
video youtube transformer-architectures
video thumbnail transformer-architectures
video shorts transformer-architectures
```

Idempotent: `video make` skips a step when its output is newer than its inputs. Use `--fake` to render without network / API calls (silent placeholder WAVs, no AI images).

## 4. Provider flags

- LLM: `--model minimax|glm` (default `glm` for draft, review, youtube; `minimax` for storyboard)
- Image / video: `--image-provider minimax|openai|gemini|mock|none`, `--fake`
  - **v0.8.1+: `minimax` is the default for `video make` and
    `video visuals`** (gated on `!fake`; `mock` stays the default for
    `video thumbnail`). One resolver — `resolveImageProvider` in
    `packages/make/src/index.ts` — serves `video make`, `video
    visuals`, and the `--dry-run` impact table, so all three agree.
  - Three hosted HTTP providers, all returning seconds per scene, each
    needing its own key: `minimax` (`MINIMAX_API_KEY`, model
    `image-01`), `openai` (`OPENAI_API_KEY`), `gemini`
    (`GEMINI_API_KEY`). Each returns its own output size; scenes are
    fitted to the requested 1920×1080 frame at render time.
  - `mock` gives deterministic placeholder images, `none` skips image
    generation entirely.
  - `--fake` always resolves to `none` — scenes stay
    `AnimatedIllustration` (caption + animated SVG).
- TTS: `--fake` (offline placeholder). Real narration backends select per
  project via `article.md` frontmatter: `tts_provider: voicebox` + `voice:`
  = Voicebox profile name/id (local voicebox-server, `VOICEBOX_URL`,
  default `127.0.0.1:17493`; Qwen3-TTS ~7× slower than realtime on MLX);
  `tts_provider: minimax` + `voice:` = MiniMax voice_id — T2A v2
  `speech-2.8-turbo`, ~2.5× faster than realtime, needs
  `MINIMAX_API_KEY`, and **voice CLONING is not on Token Plan keys
  (error 2061; pay-as-you-go only; clones deleted after 7 days idle)**;
  omitted/`edge` → Edge TTS voice id. Unknown values warn + fall back to
  Edge. Pre-flight: `video make` probes voicebox (2 s) and degrades
  loudly (voicebox down → minimax system voice → edge); `video draft`
  offers the conditional `tts` question only when voicebox answers with
  cloned profiles (answer via `--tts voicebox:<profile>|minimax-system`;
  server down ⇒ no question, default minimax-system). Cache key is
  provider-namespaced; re-drafts reset `voice:` (drafter-owned) but
  preserve `tts_provider:`.
- Web search in research: `--no-web` (LLM knowledge only)

Provider fallback (minimax → glm) is automatic on quota / rate-limit errors.

## 5. Package layout (monorepo)

```
packages/
├── cli               # the `video` command (entry: packages/cli/src/index.ts)
├── draft             # article.md + audio-config.yaml generation
├── script            # narration script generator
├── agent-storyboard  # VDSL storyboard agent
├── audio-plan        # voice/BGM/SFX planning
├── audio-assets      # BGM/SFX generator
├── audio-mix         # mix narration + BGM + SFX
├── tts               # TTS provider abstraction
├── vdsl              # VDSL schema (Zod)
├── video-components  # React/Remotion components
├── video-renderer    # Remotion render pipeline
├── media-generators  # image / video provider abstractions
├── llm               # minimax / glm provider clients
├── make              # make-command orchestrator
├── review            # review agent
├── research          # research agent + MiniMax web search
├── youtube           # YouTube package + thumbnail prompt + shorts hook
└── workflow          # pipeline state machine
```

`pnpm build` at the root compiles every package via `tsc -b`.

## 6. Common pitfalls

- **Keyless smoke run (no API keys needed)**: write `article.md` (frontmatter: project/language/duration_target_sec/voice + `## Scenes` fenced YAML) and an `audio-config.yaml` (`voice: zh-CN-XiaoxiaoNeural`, `bgm: "calm"`, `sfx: {scene_1: whoosh}` — flat keys, not nested objects), then `video approve storyboard <project>` (gate) and `video make <project> --fake`. For deterministic placeholder images without any key, use `--image-provider mock`.
- **`no scene-N.wav files` in mix**: article scene ids must be `scene-1`, `scene-2`, … — TTS names narration WAVs after article ids and mix matches `/^scene[-_]\d+\.wav$/`. Ids like `s1` break the mix step.
- **`video` not found**: symlink `bin/video` into a PATH dir (see §1). Verify with `which video` and `realpath $(which video)`.
- **`Cannot find module '.../packages/cli/dist/index.js'`** — the `video` / `video` wrapper resolved the wrong project root. The bundled `bin/video` uses `realpath $0`, so this only happens with a custom wrapper that uses `dirname $0` or `$(pwd)`. Fix: either rebuild via `pnpm build`, or replace any custom wrapper with `bin/video`.
- **`MINIMAX_API_KEY` missing**: needed for real image / video generation; not needed for `--fake`.
- **`pnpm test` slow**: vitest runs across all packages with coverage. Use `pnpm vitest run packages/<name>` to scope.
- **Render stuck on port**: Remotion needs a free port; check `output/` for crash logs.
- **Storyboard schema mismatch**: `video validate projects/<id>/storyboard/storyboard.yaml --root projects/<id>`.
- **Edge TTS fails**: try `--fake` to confirm pipeline; fall back to a different voice via `audio-config.yaml`.
- **Disk usage**: `node_modules`, `output/`, and Remotion caches grow fast; `pnpm store prune` periodically.

## 7. More reading

- `README.md` — one-page overview
- `docs/INSTALLATION_AND_USAGE.md` — full reference (commands, flags, troubleshooting)
- `docs/architecture.md` — package boundaries and design decisions
- `docs/RELEASES.md` — version history
- `docs/AI_Video_Factory_Design_and_Plan_v1.1.md` — the canonical design doc
