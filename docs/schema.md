# VDSL Schema Reference (0.1 / 0.2)

Authoritative implementation: `packages/vdsl/src/schema.ts` (zod, strict —
unknown keys are rejected everywhere). Validation errors carry YAML line
numbers. All durations are SECONDS; the compiler converts to frames with
`Math.round(duration × fps)`.

## Storyboard

```yaml
schema_version: "0.2"   # defaults to 0.2 when omitted; 0.1 still validates
project:
  id: my-video
  language: zh-CN       # zh-CN | en-US
  fps: 30
  width: 1920
  height: 1080
style:
  theme: paper-light    # paper-light (default) | dark-tech | ocean-deep | dusk-warm | forest-moss | sunset-pop | terminal-vintage | paper-cream
  #                      (unknown names fall back to paper-light; see
  #                       packages/video-components/src/theme.ts)
defaults:               # 0.2, optional project-level defaults
  renderer: svg         # scenes that omit visual.renderer inherit this
assets:                 # 0.2, optional project-level manifest
  - id: asset-logo
    type: svg           # svg|png|jpg|webp|excalidraw|canvas|audio|video|font
    source: generated   # generated|user|external
    path: assets/svg/logo.svg
scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "……"
      audio: assets/audio/scene-01.wav   # optional; mounted by vf audio flows
    visual:
      component: SvgScene
      renderer: svg     # remotion (default) | svg | canvas | excalidraw
      props: { … }      # validated against the REGISTRY props schema
    animation:          # legacy v0.1 entrance model (still honored)
      entrance: fade    # none|fade|slide|scale|draw|typewriter (+synonyms)
      emphasis: none
      exit: none
    animations:         # 0.2 timeline model (plan §10), scene-relative
      - id: draw-arrow
        target: arrow-1
        type: draw      # draw|write|fade|move|scale|rotate|highlight|morph|camera
        start: 1.2
        duration: 0.8
        easing: easeInOut   # linear|easeIn|easeOut|easeInOut (+synonyms)
    captions:
      source: narration   # narration|none (+synonyms); text overrides
    transition:
      in: fade            # fade|cut (+synonyms); default fade
      out: fade
```

## Themes (`style.theme`)

The palette is chosen per storyboard and resolved by the renderer
(`resolveTheme` in `packages/video-components/src/theme.ts`); unknown or
missing names fall back to `paper-light` (the v0.4.3 default), so a
typo never crashes a render. Pre-v0.4.3 storyboards defaulted to
`dark-tech`; existing 0.1/0.2/0.4.2 storyboards stay valid — set
`theme: dark-tech` explicitly to keep the old look.

| name | background | ink/text | accent | mood |
|---|---|---|---|---|
| `paper-light` (v0.4.3 default) | `#F5F1E8` warm paper | `#1F1D1A` ink | `#C2410C` amber-red | bright board; pairs with canvas hand-drawn scenes and tutorial content |
| `dark-tech` (default prior to v0.4.3) | `#0B1220` deep navy | `#E6EDF3` | `#4C8DFF` blue | the original technical look; best for dev/protocol topics |
| `ocean-deep` | `#071A1E` deep teal | `#D9F2EF` | `#2DD4BF` teal | calm, softer contrast; monitoring/infra topics |
| `dusk-warm` | `#1E1420` plum | `#F5E9E0` cream | `#F97362` coral | warm, story-led and brand pieces |

Notes: `DoodleScene`'s `background: paper` always uses its own light
paper regardless of theme (ink-on-paper is the look), so light themes are
safe alongside canvas scenes. The burned-in captions, camera
highlight rings, node fills and arrows all follow the resolved theme.
Adding a theme = one new entry in the `THEMES` registry (full token set
validated by `isValidTheme` — see `theme.ts` for the contrast rules).

## The `visual` block — what the audience sees

`visual` pairs two choices: `component` (the registered implementation,
validated against `REGISTRY`) and `renderer` (the scene family that draws
it). Current pairings:

| renderer | component(s) | look |
|---|---|---|
| `remotion` | Title, Paragraph, CodeBlock, Terminal, FlowChart, Comparison, Timeline, Callout, EndCard, Character, Image, ImageBackground, AnimatedIllustration | classic motion graphics on the theme background |
| `svg` | `SvgScene` | whiteboard/diagram: `nodes` + labeled `edges` that DRAW ON (stroke draw-on), a target-driven camera, automatic stagger |
| `canvas` | `DoodleScene` | hand-drawn ink: procedural strokes (circle / star / zigzag / spiral) with seeded wobble, sequential pen-draw, optional `bpm` beat-sync, `background: paper \| dark` |
| `excalidraw` | — | asset generation only (`vf excalidraw` → `.excalidraw` + animated `.svg`); not a render path |

`props` are validated against the component's own registry schema, so each
component documents its own shape — `SvgScene` wants `nodes[]` (id, kind
rect/circle/label, x/y/w/h in 1920×1080 canvas space, text) and `edges[]`
(id, from, to, label); `Title` wants `text` + optional `subtext`. Synonyms
are coerced for `renderer` before validation (`hand-drawn`/`doodle` →
`canvas`, `diagram`/`whiteboard` → `svg`); unknown values fail loudly at
render time rather than silently substituting a different look.

The scene family also decides the animation fallback: `svg`/`canvas`
scenes auto-draw sequentially (nodes then edges/strokes, ease-out, ~0.25 s
stagger) so a minimal storyboard still animates; `remotion` components
fall back to their `animation.entrance` model.

## The `animations[]` timeline — the scene's choreography

Scene-relative SECONDS. Each entry animates ONE named element (`target`)
with one verb (`type`) between `start` and `start + duration` (must fit
inside the scene), eased by `easing` (`linear` / `easeIn` / `easeOut` /
`easeInOut`, synonyms like `ease-in-out` accepted).

What each `type` does per scene family:

| type | svg (`SvgScene`) | canvas (`DoodleScene`) | remotion |
|---|---|---|---|
| `draw` | stroke draw-on of the node/edge | pen strokes draw progressively | wipe-style reveal |
| `write` | text appears as if written/typed | — | typewriter reveal |
| `fade` | opacity fade-in | opacity fade-in | opacity fade-in |
| `move` / `scale` / `rotate` | reserved (fall back to fade) | reserved | reserved |
| `highlight` | marker ring around the target while the window lasts | — | — |
| `camera` | pans/zooms the VIEW to focus `target` (a NODE id); does not affect that element's own draw timing | — | — |
| `morph` | reserved | reserved | reserved |

`target` refers to an element id inside the scene's props (SvgScene
node/edge id, DoodleScene stroke id); `type: camera` targets a NODE id.
Elements with no explicit entry use the family's sequential auto-draw
default, so choreography is additive: declare only the beats you care
about (e.g. one arrow draw + one highlight) and let the rest flow.

Timing guidance (from the `animation-principles` skill, encoded in
`@vf/motion/src/heuristics.ts`): entrances 0.3–0.8 s ease-out, group
stagger 40–80 ms capped at ~0.7 s total, entrances ≤ ⅓ of the scene, one
highlight beat for scenes ≥ 6 s, key moments on the beat grid when a BPM
is given.

## Rules the validator enforces

- Component must be registered (`REGISTRY`), props must pass its schema.
- Narration audio file must exist and not exceed scene duration
  (tolerance 0.05 s) — run `vf preview`/`vf make` first: they sync
  durations to measured audio before validating.
- Captions must wrap to ≤ 3 lines of 24 CJK units (bottom safe area).
- Timeline animations must fit inside the scene (`start + duration ≤
  duration`).
- LLM synonym coercion is applied BEFORE validation (e.g. `wipe` → `draw`,
  `hand-drawn` → `canvas`, `dissolve` → `fade`); truly unknown values fail
  loudly.

## Renderer inheritance (defaults.renderer)

A scene's `visual.renderer` is optional: an omitted value inherits from
the project-level `defaults.renderer`, falling back to `remotion`.
Precedence: **scene > defaults > remotion**. Inheritance resolves at
parse time — the compiled `vdsl/vdsl.yaml` and the RenderPlan always
carry explicit per-scene renderers (determinism preserved). Strict by
design: an inherited renderer that doesn't fit a scene's component
(e.g. `canvas` + `Title`) still fails loudly at render time
(`assertPlanRenderable`); there is no silent family-aware fallback.

In the article-driven (`vf make`) flow, the default is set from
`article.md` frontmatter:

```yaml
---
project: my-video
language: zh-CN
duration_target_sec: 60
voice: zh-CN-YunjianNeural
default_renderer: canvas   # → storyboard emits defaults: {renderer: canvas}
---
```

The derived storyboard then carries `schema_version: "0.2"` and the
`defaults:` block. Synonyms work here too (`hand-drawn` → `canvas`).

## Camera (T7.4)

A `type: camera` animation targets a NODE of an `SvgScene` scene; the node
rect is the parameter — the view pans/zooms to make that node ~60% of the
frame, eases over `duration`, holds until the next camera. Camera
animations do not affect element draw timing.

## Renderer families (plan §9)

| renderer | component | notes |
|---|---|---|
| `remotion` | any REGISTRY component | default |
| `svg` | `SvgScene` | draw-on diagrams; target-driven camera |
| `canvas` | `DoodleScene` | hand-drawn ink; `bpm` quantizes stroke onsets |
| `excalidraw` | — | generator only (`vf excalidraw`); renders are not wired |

## Compiler contract

`compileStoryboard(text, projectRoot, {fps?, width?, height?})` →
`{ renderPlan, yaml, write }`:
- deterministic (byte-identical re-compilation of emitted vdsl.yaml),
- `write()` persists `vdsl/vdsl.yaml` — preview/final compile FROM it when
  fresh and fall back to the storyboard loudly when it is corrupt,
- draft mode (`vf preview --draft`) overrides fps/width/height (960×540@15)
  without touching the storyboard.
