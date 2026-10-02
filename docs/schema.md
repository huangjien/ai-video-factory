# VDSL Schema Reference (0.1 / 0.2)

Authoritative implementation: `packages/vdsl/src/schema.ts` (zod, strict —
unknown keys are rejected everywhere). Validation errors carry YAML line
numbers. All durations are SECONDS; the compiler converts to frames with
`Math.round(duration × fps)`.

## Storyboard

```yaml
schema_version: "0.1"   # or "0.2" — both validate; 0.2 fields are optional
project:
  id: my-video
  language: zh-CN       # zh-CN | en-US
  fps: 30
  width: 1920
  height: 1080
style:
  theme: dark-tech      # single theme today (§25)
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
