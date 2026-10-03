# Skills Inventory — T0.2 (plan §3, AD-5)

> Installed 2026-10-02 via `npx skills add <pack> --yes` into `.agents/skills/`
> (universal location; `.claude/skills/` holds symlinks). Reproducible from
> `skills-lock.json` via `npx skills experimental_install`.
> Result: **all four packs exist and installed** — the iart-ai availability
> question from the v0.2 review is resolved; AD-5's built-in-heuristics
> fallback stays as a code-level default, not an availability workaround.

## Packs (28 skills)

| Pack | Count | Role in the pipeline (plan §12–13) |
|---|---|---|
| `remotion-dev/skills` | 12 | Render Agent + Scene Builder runtime knowledge |
| `iart-ai/motion-design-skills` | 9 | Motion Agent (timing/easing/composition/art direction) |
| `iart-ai/explainer-video-skills` | 5 | Storyboard/Scene planning for explainer forms |
| `iart-ai/javascript-animation-skills` | 2 | Canvas hand-drawn renderer (T4.4) + procedural audio |

## Skill → pipeline mapping

**Remotion runtime (Render Agent, `@video/video-renderer`):**
- `remotion-best-practices` — router for all Remotion skills; start here
- `remotion-create`, `remotion-markup` (content/animation/effects), `remotion-multimedia` (Mediabunny media I/O)
- `remotion-render` — export path knowledge (we use `@remotion/renderer` directly; use for tuning)
- `remotion-studio` — feeds T0.3 (`video studio` verb)
- `remotion-captions` — T1.4 follow-ups (per-word timing, animated captions)
- `remotion-docs`, `remotion-interactivity`, `remotion-maps`, `remotion-saas`, `remotion-upgrade` — reference; not on the MVP critical path

**Motion intelligence (Motion Agent, `packages/motion` — T4.1/T4.2):**
- `animation-principles` — timing/easing/natural-motion rules → MotionSpec defaults
- `motion-art-direction`, `shot-composition`, `color-motion` — per-scene visual direction
- `beat-sync-editing` — §18/§35 "beat-sync" demo requirement
- `remotion-video`, `motion-background`, `logo-animation`, `after-effects` — adjacent; consult as needed (after-effects is AE-specific, lowest priority)

**Explainer forms (Storyboard Agent + specialized renderers):**
- `explainer-video` — script→storyboard→scene workflow validation (plan §3.3)
- `diagram-animation` — T4.3/T7.1 diagram scenes (SVG renderer, Excalidraw demo)
- `whiteboard-animation` — T4.3 draw/write animation reference (VideoScribe-style)
- `isometric-animation`, `wrapped-video` — bonus forms, off critical path

**Canvas hand-drawn (T4.4):**
- `javascript-animation` — frame-by-frame JS/Canvas drawing
- `soundtrack` — procedural music in code (potential `@video/audio` extension)

## House rules (from the installer + plan §29)

1. Skills run with full agent permissions — review any skill's scripts before invoking them (installer's own warning).
2. Third-party skill formats must never leak into core schemas (plan Principle 2 / AD-5): the Motion Agent translates skill guidance into `MotionSpec` (VDSL 0.2 `animations[]`), nothing else consumes skill internals.
3. Upgrades: `npx skills update -p -y` then re-check `skills-lock.json` diff into git.
