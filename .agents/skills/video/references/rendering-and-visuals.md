# Rendering And Visuals

### Visual components (registry — 24 components)

`video make` re-derives `storyboard.yaml` from article.md on every run: each scene's `visual:` field is keyword-matched by a deterministic classifier (`packages/draft/src/visual-classifier.ts`), which picks a component and a prop builder fills structured props from caption/narration/prose. First scene is always Title — the opening card: it draws the scene's generated picture full-bleed and writes the title over it in an artistic face (`kai` = horizontal brush 楷, `brush` = vertical running-brush column; both vendored in `assets/fonts/`, SIL OFL), with the ink picked against the picture's brightness. Pick the treatment per film with `video draft --title-style kai|brush` (stamped into article.md frontmatter as `title_style:`). When editing article.md, steer visuals by putting trigger keywords in `visual:`:

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

**The drafter writes these trigger words on purpose — and they eat the
picture.** The article prompt asks the drafter to name the intended
component, so it emits lines like `…; stat keyword, close overhead view.`
or `…; takeaway keyword, centered close-up.` The classifier matches the
bare word anywhere in the line, so EVERY scene routes to a component and
the whole film renders as geometry — the requested `image_style` never
appears once. Always verify before you spend on images:

```bash
node -e 'const {pickVisualComponent}=require("./packages/draft/dist/visual-classifier.js");
const YAML=require("yaml"),fs=require("fs");
const md=fs.readFileSync(process.argv[1],"utf8");
YAML.parse(md.match(/```yaml\n([\s\S]*?)\n```/)[1]).scenes.forEach((s,i)=>
  console.log(`scene_${i+1}`, pickVisualComponent(s.visual,i===0).component));' \
  projects/<id>/article.md
```

Every scene except the first must report `AnimatedIllustration` for the
image model to be reached. Two traps when you clean the lines up: the
`Callout` rules have **no trailing word boundary**, so ordinary words
match — `tableau` hits `table`, `climbs` hits `cli`; and `Terminal`'s
`cli` is unanchored at the end too. Rewrite the word, don't just delete
the keyword — "a wide panorama" for "a wide tableau", "the bar rises
toward" for "the bar climbs toward".

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

### The opening beat: `lead_in_sec` on a scene

A scene may ask for silence **before** its narration — the opening beat that
keeps a video from slamming out on an empty frame with the voice already
talking. Set it per scene in `article.md`:

```yaml
  - id: scene_1
    duration: 10
    lead_in_sec: 1.2      # 0–10 s; the title card settles before the voice
```

What the pipeline does with it, end to end:

| Stage | Effect |
|---|---|
| TTS | 1.2 s of silence is padded into the FRONT of the narration WAV → the scene's measured length is lead-in + speech (+ hold). It is part of the TTS cache key, so changing it re-synthesizes that scene. |
| sync-durations | Writes `captions.speech_sec` = measured − lead-in − hold, i.e. the true SPOKEN length. |
| compiler | The burned caption cues are offset by the lead-in, so the text appears WITH the voice. |
| SRT writer | The external `captions/*.srt` is offset by the same amount — the SRT and the burned track cannot drift (CS-07). |

Gotchas: `lead_in_sec` reaches the storyboard only when it is **derived from
the article** — patching an existing storyboard does nothing, and patching
the article does nothing until `storyboard/storyboard.yaml` is removed and
re-derived (same rule as any frontmatter edit). The caption overlay draws
nothing before the first cue starts, so the lead-in is a genuine silence,
not a caption waiting on the voice.

### The film's head and tail fade through black

Every render fades in from black over 0.8 s and out to black over 0.8 s
(`edgeFadeOpacity` in `packages/video-renderer/src/Root.tsx`). The fade
belongs to the FILM, not to each scene — a per-scene render is a slice of
the plan, so the slice carries the film's frame count (`filmTotalFrames`)
and the renderer decides from absolute positions. Without that, every
scene flashed black at its own edges.

### Every render cache needs the thing that made it as an input

Three caches decide "can I reuse this?" — and each one was blind to a class
of change. The rule: **if an input can change the output, it belongs in the
cache key.** Bump the matching revision when you edit the thing it names.

| Cache | Key | Revision to bump | Set when |
|---|---|---|---|
| Scene mp4 (`scenes/*.mp4.json`) | fragment hash + `projectHash` + audio + `rendererRevision` | `RENDERER_REVISION` in `packages/video-renderer/src/scene-cache.ts` | any change under `video-renderer/src` or `video-components/src` that alters a frame |
| Scene image (`assets/images/scene_N.jpg`) | scene content + style + provider + `learnedDigest` + `promptRevision` | `IMAGE_PROMPT_REVISION` in `packages/draft/src/image-prompt.ts` | the brief expander prompt, its stripping rules, or its instruction text changes |
| Image brief (`assets/images/.prompt-cache/*.json`) | scene content + style + learned + `IMAGE_PROMPT_REVISION` | same | same |

✅ Blind spot FIXED (P1, 2026-10-24): the scene-mp4 key now includes the scene image's content digest (`imageHash`, hashed from the data-URI the compiled plan carries — decode-identical to the file bytes, so `video make --dry-run` parity holds via the shared `sceneImageDigest`). Legacy sidecars without `imageHash` invalidate exactly once on the next make. The `video qa` `stale-render` check remains as a backstop.

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

> **Pillow caveat (v0.12):** the Pillow text-overlay pass is BACK, as a
> step separate from image generation. `video make` runs
> `scripts/pillow-text-overlay.py`, which writes a transparent banner to
> `assets/images/text/scene_N.png` and the renderer composites it ABOVE the
> background image (storyboard prop `textOverlaySrc`). The banner holds two
> lines: a key-info headline and — since 2026-11 — a BULLET line that only
> appears when the scene's narration really enumerates (three or more
> parallel segments, averaged ≤9 chars: "一次代码复盘 · 一个已合并的PR ·
> 一次故障演练"). The old first-sentence subline is gone (user note: it
> duplicated the bottom caption track — bullets or nothing). The same scan
> runs in `extractEnumeration` (packages/draft/src/visual-builders.ts) for
> the title card: the small line under the big caption is bullets or
> nothing, and the film's title no longer appears on the card at all.
> The headline is picked by priority — `visual.props.text_overlay` →
> `visual.props.caption` → `visual.props.text`/`title` → captions text —
> so with no `text_overlay` it shows the SAME short label the caption
> overlay burns at the bottom of the frame, and the frame prints that line
> twice. That duplication is the current house style (every shipped
> project shows it); set `visual.props.text_overlay` per scene to a
> distinct curated line to avoid it. `contact_sheet.py` is the only other
> Pillow pass and it draws review labels, not production text.

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


### Historical pictures for the scene art

A history film used to invent every face, every artifact and every battle
from a text prompt. `video make` now looks for a **real, freely-licensed
picture** of the thing each scene shows, and uses it in one of two ways.

| Mode | What happens | Cost |
|---|---|---|
| `direct` | the archive picture IS the frame — it becomes `assets/images/scene_N.jpg` | no image model at all |
| `reference` | the picture is attached to the request as a reference; the model draws the scene in the film's style | one image call (MiniMax-H3 edits) |

In practice `direct` is what reaches the screen: a reference needs a
provider with an edits endpoint, and the only one that had it could not
serve images. A `reference` plan therefore falls back to `direct` — the
picture becomes the frame — rather than being dropped.

**The flow.** One LLM call per video (`packages/prompts/prompts/image-source-plan.md`)
reads every scene and marks which ones are about a real historical subject,
what to search for, and which mode fits. Only the scenes it marks historical
spend a network round-trip — a modern or abstract film pays nothing. The
retrieval then queries **Wikimedia Commons** (the license comes with the
file record), **Wikipedia** article leads (license resolved through
Commons), the **Met / Smithsonian / Openverse** open-access collections, and
the **project's own pictures** (`assets/figures/`, the character bible's
reference sheets).

A second LLM call per video (`image-source-match.md`) then picks the
picture that really depicts the subject. An archive matches STRINGS, and a
query for 唐高宗 李治 comes back with `Gaozong of Song.jpg` — a Song
emperor with the same temple name. The matcher reads both the subject and
the returned titles, and may answer "none": a missing picture is better
than a wrong one.

**License rule (strict).** Only public-domain / CC0 / PDM pictures enter
the pipeline. CC-BY and CC-BY-SA are rejected — a credit line nobody
maintains is a rights problem waiting to happen. Every borrowed picture is
recorded in `assets/images/scene_N.source.json` (machine-readable) and in
`assets/images/ATTRIBUTION.md` (one row per picture, with its author,
license and source link).

**Turning it off.** `--image-sources off` on `video make` / `video
visuals`, or `historical_images: off` in `article.md` frontmatter. Default
is `auto` — on, for the scenes that are historical.

**Gotchas.**

- *A rich query finds nothing.* An archive ANDs its terms: `唐太宗` returns
  five portraits, `唐太宗入军图 尉迟乙僧 绢本设色` returns none. The
  retriever therefore widens the search — planned query, then the bare
  subject, then single terms — and stops at the first real archive hit.
  The project's own pictures answer every query, so they cannot be that
  signal.
- *A reference needs an edits endpoint.* Only MiniMax-H3 takes a reference
  image — and its image API answers `400 bad_request`, so in practice a
  reference could never reach a provider. **A reference plan now becomes a
  `direct` plan instead**: the picture becomes the frame (if it may be), and
  the run log says so. A cast sheet still cannot be the frame, so that one
  is dropped.
- *The plan and its outcome are written down.* `assets/images/HISTORICAL.md`
  records what was planned for every scene and what each scene got — the
  scenes that asked for a picture and got none included. The console lines
  are gone when the run ends; this file is the durable record.
- *The picture is part of the image cache key* — so a different picture
  invalidates that scene's image, and a scene with no picture keeps the
  key it had before the feature existed (no mass re-spend on upgrade).
- *A cast sheet is never the frame.* The character bible's reference sheets
  inform a generated frame; showing the drawing instead of the person is
  not what the scene needs.
- *Name the subject the way the archive catalogues it.* A Chinese video about
  a non-Chinese subject must search the archive's name: `毛奇` is a Qing
  naval officer in the archive, the Prussian field marshal is `Helmuth von
  Moltke`.
