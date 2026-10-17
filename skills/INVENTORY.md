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

**FLUX.2 Klein visual assets (project-authored, v0.8):**
- `flux2-klein-local-gen` — worker ops: setup, model variants, env knobs, memory, lock
- `flux-image-prompting` — `visual:` lines, `image_style` presets, never-text-in-prompt
- `flux-visual-consistency` — style anchor vs Visual Bible refs
- `flux-asset-review` — image cache, dry-run impact table, contact sheet, approval gate

Referenced from the `video` skill, both harness command files
(`.opencode/command/video.md`, `.omp/commands/video.md`), and the craft
skills that meet generated stills (`explainer-video`,
`motion-background`, `shot-composition`, `color-motion`,
`motion-art-direction`).

## Project-authored skills (v0.8, 2026-10-16)

Not packs — four skills written in-repo from the FLUX.2 Klein pipeline we
own. They live in `.agents/skills/<name>/SKILL.md` (symlinked into
`.omp/skills/` for OMP discovery, same convention as the packs) and are
repo-coupled: they document *this* repo's worker, cache, and gate, so they
are not candidates for the hub `~/.agents/skills/`.

| Skill | Owns | Replaces re-deriving |
|---|---|---|
| `flux2-klein-local-gen` | worker ops: weight download, `--check` preflight, model variants (distilled 8-step vs base 50-step), `FLUX2_*` knobs, MPS memory (int8 encoder, offload), one-pipeline lock, throughput | README env tables read per session |
| `flux-image-prompting` | writing `visual:` lines; subject/environment/lighting/composition; `image_style` presets (flat-vector / editorial / whiteboard); never-ask-for-text (Pillow `textOverlay`); diagram keywords route to native components, not images | per-image prompt debugging |
| `flux-visual-consistency` | style anchor vs `visual_bible:` refs, precedence (scene ref > anchor), explicit-list-wins-over-`*`, first-ref-only limitation, ref sha256 in the cache key, what seeds do NOT promise | misuse (refs everywhere = slow; anchor conflicts) |
| `flux-asset-review` | content-keyed image cache (sidecar, adoption, invalidation), `make --dry-run` impact table, `video visuals` contact sheet, `--reject`/`approve visuals`, `require_visual_approval` gate | guessing whether an image will regenerate |

House rules for these (same as below): agent permissions apply; keep them
in sync with the code they describe — each cites file paths so drift is
visible in review.

## House rules (from the installer + plan §29)

1. Skills run with full agent permissions — review any skill's scripts before invoking them (installer's own warning).
2. Third-party skill formats must never leak into core schemas (plan Principle 2 / AD-5): the Motion Agent translates skill guidance into `MotionSpec` (VDSL 0.2 `animations[]`), nothing else consumes skill internals.
3. Upgrades: `npx skills update -p -y` then re-check `skills-lock.json` diff into git.
