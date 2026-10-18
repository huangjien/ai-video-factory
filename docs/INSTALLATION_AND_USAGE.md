# AI Video Factory

Installation and usage manual for the current repository.

## TL;DR — generate something in ~3 minutes

One-time setup: Node 22+, pnpm, ffmpeg → `pnpm install && pnpm run build`,
then `alias video='node packages/cli/dist/index.js'` (all examples assume it).

### Path A — no API keys, fully offline (~60 s)

Render the committed MCP Explainer demo — SVG diagram draw-on + hand-drawn
canvas, with a real QA report:

```bash
video new mcp-explainer
cp examples/mcp-explainer/storyboard.yaml projects/mcp-explainer/storyboard/
cp examples/mcp-explainer/captions/zh-CN.srt projects/mcp-explainer/captions/
for i in 01 02 03 04 05; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 9 projects/mcp-explainer/assets/audio/scene-$i.wav
done
video approve storyboard --cwd projects/mcp-explainer   # 🚪 the one human gate
video preview --cwd projects/mcp-explainer              # add --draft for a faster 960×540 pass
# → projects/mcp-explainer/output/preview.mp4
```

### Path B — your own topic, with an LLM key

```bash
export GLM_API_KEY="..."      # or MINIMAX_API_KEY
video new my-first-video
video draft "why local-first tools win"          # LLM writes article.md + audio-config.yaml
$EDITOR projects/my-first-video/article.md    # optional: edit the draft
video approve storyboard --cwd projects/my-first-video   # 🚪 read it, then approve
video make my-first-video                        # TTS → images → render → mix
# → projects/my-first-video/output/final-mixed.mp4  (--fake = offline TTS + no AI images)
```

That's the whole product: **2 AI commands + 1 human approval + 2 editable
files** (`article.md`, `audio-config.yaml`). Deeper: walkthrough §12,
examples §14, troubleshooting §11, gates §7.1.

## Overview

AI Video Factory's core interface is **two AI commands + one human
approval** — one LLM call writes both human-edit files in one go, a human
reads and approves the storyboard, and one command renders the video:

```mermaid
flowchart LR
    topic[topic] --> videoDraft["video draft (LLM)"]
    videoDraft --> articleMD["article.md ⭐ human-edit"]
    videoDraft --> audioConfig["audio-config.yaml ⭐ human-edit"]
    articleMD --> videoApprove["video approve storyboard 🚪 human gate"]
    audioConfig --> videoApprove
    videoApprove --> videoMake["video make"]
    videoMake --> previewMp4[preview.mp4]
    videoMake --> finalMixedMp4["final-mixed.mp4"]
```

The two human-edit files are **`article.md`** (narrative + a Scenes YAML
block) and **`audio-config.yaml`** (voice / bgm / sfx / fades). Everything
else is derived; `video make` is idempotent — it skips a step when its
output is newer than its inputs (`--dry-run` shows what it would do).

Rendering sits behind a **mandatory human gate**: until the storyboard is
approved, `video make` fails at the render step and prints the exact approve
command (calling `video preview --force` directly bypasses it, recorded in
the audit trail). The three gates and invariants live in
`docs/workflow.md`; the VDSL format in `docs/schema.md`; the system
architecture in `docs/architecture.md`.

## Harness adapters (v0.4.1)

The `video` CLI is the **stable harness-agnostic surface**. The repo ships
adapter files for the harnesses we officially support; every adapter
forwards to `video` (or to `bin/video`, a thin shell wrapper).

### Shell wrapper — `bin/video`

```bash
bin/video new "demo"
bin/video research "AI 思维链"
bin/video storyboard "AI 思维链" --from-research projects/.../research
bin/video preview --cwd projects/demo
```

Forwards every verb to `video` so any shell, Makefile, or CI script can
drive the pipeline with one binary. No harness required.

### OpenCode — `.opencode/command/video.md`

OpenCode / Cursor / Claude Code / similar agentic harnesses that look up
`.opencode/command/*.md` will pick up `/video` as a slash command. The
file uses OpenCode's frontmatter (`description`, `tools`) and a markdown
body listing every verb, the canonical pipeline order, and the
critical invariants (never auto-approve, credentials stay in env, fail
loudly).

### pi / oh-my-pi — `.omp/commands/video.md`

The `oh-my-pi` coding agent (`@oh-my-pi/pi-coding-agent`, `omp.sh`)
discovers native slash commands under `<cwd>/.omp/commands/*.md`. The
repo ships `.omp/commands/video.md` with the OMP-native frontmatter
(`name`, `description`) and the same canonical pipeline / invariants
body. Inside an `omp` interactive session the user types:

```bash
/video draft "AI 思维链"
/video approve storyboard --cwd projects/ai-思维链
/video make ai-思维链
/video retrospect ai-思维链
```

The command body uses `$ARGUMENTS` so the slash input maps verbatim to
the `video` CLI args. Permissions default to `read: allow, write/edit/bash:
ask` (in `.omp/settings.json`) to preserve the human-gate principle —
the agent can read freely but must ask before mutating anything.

#### Skills in OMP

`.agents/skills/<name>/SKILL.md` is the canonical skill source (per
`skills-lock.json`). For OMP, `.omp/skills/<name>/SKILL.md` are
symlinks that resolve to the canonical files — `readlink -f
.omp/skills/<name>/SKILL.md` shows the canonical path. `.omp/settings.json`
points `skills.customDirectories` at `.omp/skills` so OMP's native
provider picks them up alongside any others. To install new skills:

```bash
npx skills add <pack> --yes                       # updates canonical .agents/skills
ls -l .omp/skills/<new-skill-name>/SKILL.md        # verify the symlink is there
# (add it manually if not — single symlink per skill)
```

### Why no auto-approval

Per `docs/workflow.md`, the workflow enforces a human gate between every
generator step and the next. Whether the caller is OpenCode, OMP, or a
human at a terminal, the agent invokes the drafting verbs and surfaces
the artifacts; the human reads and `video approve`s before `video preview`
ever touches the render path.

### Adding a new harness

1. Create the harness-specific command file under the directory it
   expects (`.opencode/commands/`, `.omp/commands/`, `.claude/commands/`,
   `.gemini/commands/`, `.codex/commands/`).
2. Use that harness's native frontmatter shape.
3. Document the expansion pattern (`$ARGUMENTS` for OMP, positional for
   OpenCode/Claude) in the body.
4. The CLI stays the source of truth — never duplicate verb logic in
   the adapter file.

## 1. Requirements

Required:

- Node.js 22 or newer
- npm
- FFmpeg, including `ffprobe`
- macOS, Linux, or Windows with a POSIX-compatible shell for `bin/video`

Check the versions:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

For macOS:

```bash
brew install node ffmpeg
```

For Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

On Windows, install Node.js from nodejs.org and FFmpeg from an approved
package manager or ffmpeg.org. Ensure both `node` and `ffmpeg` are on `PATH`.

## 2. Installation

From the repository root:

```bash
pnpm install
pnpm run build
```

The build compiles all workspace packages into `packages/*/dist`.

The CLI is currently invoked through the compiled entry point:

```bash
node packages/cli/dist/index.js --help
```

For a shorter command in the current shell, define:

```bash
alias video='node packages/cli/dist/index.js'
```

The repository also provides a wrapper for agentic shells and automation:

```bash
bin/video --help
```

### Global installation

After the `@video/*` packages have been published, install the CLI globally:

```bash
npm install --global @video/cli
video --help
```

The global package contains the CLI and runtime dependencies. It does not
create files in its installation directory. Projects are created in the
current working directory, or below the directory passed with `--cwd`:

```bash
mkdir my-video-projects
cd my-video-projects
video new demo
```

For local development, link the workspace CLI instead of publishing it:

```bash
npm run build
npm link --workspace @video/cli
video --help
```

Maintainers publish the workspace packages together:

```bash
npm run publish:packages:dry-run
npm run publish:packages
```

After source changes, rebuild before using the CLI:

```bash
npm run build
```

## 3. Verify the installation

Run the type check and tests:

```bash
npm run build
pnpm test
```

Other project checks:

```bash
pnpm run lint
pnpm run format:check
npm run benchmark:verify
pnpm run acceptance
```

`benchmark:verify` and `acceptance` render video and therefore require FFmpeg,
ffprobe, and a working local Remotion renderer. Some provider integration tests
require local loopback sockets and are not a substitute for live API testing.

## 4. Create a project

Create a project scaffold under `projects/<project-id>`:

```bash
node packages/cli/dist/index.js new demo
```

This creates:

```text
projects/demo/
├── project.yaml
├── storyboard/storyboard.yaml
├── vdsl/vdsl.yaml
├── assets/audio/
├── assets/images/
├── assets/fonts/
├── captions/
├── checkpoints/
├── runs/
├── output/
└── state.yaml
```

The generated storyboard is the main input. Edit:

```text
projects/demo/storyboard/storyboard.yaml
```

The project starts in `DRAFT` state. The workflow state is stored in
`state.yaml`; run records are stored in `runs/`.

## 5. Storyboard / VDSL format

The schema accepts `0.1` and `0.2` (all 0.2 fields are optional; both
validate). The authoritative reference is `docs/schema.md` (implemented
in `packages/vdsl/src/schema.ts`, zod strict mode — unknown keys are
rejected everywhere; validation errors carry YAML line numbers).
Durations are SECONDS; the compiler converts to frames with
`Math.round(duration × fps)`.

```yaml
schema_version: "0.2" # defaults to "0.2" when omitted; "0.1" still validates

project:
  id: demo
  language: zh-CN # zh-CN | en-US
  fps: 30
  width: 1920
  height: 1080

style:
  theme: dark-tech

assets: # 0.2: optional project-level manifest
  - id: asset-logo
    type: svg # svg|png|jpg|webp|excalidraw|canvas|audio|video|font
    source: generated # generated|user|external
    path: assets/svg/logo.svg

scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
      audio: assets/audio/scene-01.wav # optional; mounted by video audio flows
    visual:
      component: SvgScene
      renderer: svg # remotion (default) | svg | canvas | excalidraw
      props: { … } # validated against the component's REGISTRY props schema
    animation: # v0.1 entrance model (still honored)
      entrance: fade
      emphasis: none
      exit: none
    animations: # 0.2 timeline model (scene-relative)
      - id: draw-arrow
        target: arrow-1
        type: draw # draw|write|fade|move|scale|rotate|highlight|morph|camera
        start: 1.2
        duration: 0.8
        easing: easeInOut # linear|easeIn|easeOut|easeInOut (+synonyms)
    captions:
      source: narration
    transition:
      in: fade # fade|cut (+synonyms); default fade
      out: fade
```

Important rules:

- `schema_version` must be `"0.1"` or `"0.2"` (defaults to `"0.2"` when omitted).
- Scene IDs must be unique; each scene needs a positive `duration` and a
  registered visual component.
- Components must be registered in `REGISTRY`; props must pass the
  component's schema.
- The narration audio file must exist and not exceed the scene duration
  (0.05 s tolerance) — run `video preview` / `video make` first: they sync
  durations to the measured audio before validating.
- Captions must wrap to ≤ 3 lines of 24 CJK units (bottom safe area).
- Timeline animations must fit inside the scene (`start + duration ≤
duration`).
- LLM synonyms are coerced BEFORE validation (`wipe` → `draw`,
  `hand-drawn` → `canvas`, `dissolve` → `fade`); truly unknown values
  fail loudly.

### Renderer families (visual.renderer)

| renderer     | Component                      | Notes                                                        |
| ------------ | ------------------------------ | ------------------------------------------------------------ |
| `remotion`   | any classic REGISTRY component | default                                                      |
| `svg`        | `SvgScene`                     | whiteboard/diagram, draw-on + target-driven camera           |
| `canvas`     | `DoodleScene`                  | hand-drawn ink, seeded wobble, `bpm` beat-sync               |
| `excalidraw` | —                              | asset generator only (`video excalidraw`); not a render path |

Unwired renderer/component combinations fail loudly at render time.

### Available themes (v0.4.3)

`style.theme` selects one of nine built-in colour palettes. Default is
**`paper-light`** (v0.4.3 — flipped from `dark-tech` in v0.4.2 and
earlier). Unknown or missing values also fall back to `paper-light`
(a render never crashes on a typo, and `video validate` surfaces a hint
when an unknown name appears). Pass `--style <name>` on `video draft`
or write it directly into `article.md` frontmatter /
`storyboard.yaml` `style:` block. Run `video theme` to see the palette
index with swatches; `video theme <name>` for one palette; `video theme
--cwd <root>` to resolve a project's current theme.

<!-- BEGIN: theme-table (generated by `pnpm run docs:commands` — do not edit) -->

| `style.theme`      | Background   | Accent         | Mood / best for                                                              |
| ------------------ | ------------ | -------------- | ---------------------------------------------------------------------------- |
| `paper-light`      | warm paper   | orange         | **default (v0.4.3)** — hand-drawn / bright office / pairs with `DoodleScene` |
| `dark-tech`        | deep navy    | blue           | tech explainers (default prior to v0.4.3)                                    |
| `ocean-deep`       | calm teal    | teal           | calm/technical, monitoring topics                                            |
| `dusk-warm`        | plum         | coral          | story-led, soft brand                                                        |
| `forest-moss`      | emerald      | lime           | sustainability / outdoor / botanical                                         |
| `sunset-pop`       | near-black   | yellow         | energetic consumer / entertainment                                           |
| `terminal-vintage` | CRT phosphor | phosphor green | dev tutorials, retro/hacker nostalgia (JetBrains Mono throughout)            |
| `paper-cream`      | beige        | burnt orange   | product / food / family-friendly                                             |
| `ai-red`           | player dark  | red `#FF0000`  | creator/playback feel — pairs with the `channel-banner` intro gradient       |

<!-- END: theme-table -->

The full token set (7 colours + 4 typography roles + spacing + easing

- fonts) is locked in `packages/video-components/src/theme.ts`; adding
  adding a custom palette requires editing that file and exporting the new theme
  from `THEMES`.

**No skills required to render.** Every renderer family is plain code —
workspace dependencies plus FFmpeg. The installed skill packs
(`.agents/skills/`, inventoried in `skills/INVENTORY.md`) only feed LLM
agents (chiefly `video motion`); they are never read on the render path.

The 24 scene components in `REGISTRY`: `Title`, `Paragraph`,
`AnimatedIllustration`, `CodeBlock`, `Terminal`, `Image`,
`ImageBackground`, `Character`, `FlowChart`, `Comparison`, `Timeline`,
`Callout`, `EndCard`, `QuoteBlock`, `StatGrid`, `BarChart`, `Leaderboard`,
`Checklist`, `BigIdea`, `PyramidDiagram`, `VennDiagram`, `CycleDiagram`,
`SvgScene`, `DoodleScene`. Plus the chrome overlays `CaptionsOverlay`,
`BrandWatermark`, `BrandIntro` — registered separately because they
overlay the timeline rather than own a scene.

**Project-level renderer default:** scenes that omit `visual.renderer`
inherit from the optional `defaults.renderer` block (precedence:
scene > defaults > `remotion`). In the make flow, put
`default_renderer: canvas` in `article.md` frontmatter and `video draft`
emits the `defaults:` block into the storyboard. Inherited renderers are
still subject to the strict wiring check — `canvas` + `Title` fails
loudly instead of silently substituting. See `docs/schema.md` §
"Renderer inheritance".

## 6. Core local workflow (recommended)

The new local flow is collapsed to a single `video make` command.

### 6.1 One-time prep: `article.md` + `audio-config.yaml`

```bash
video new my-topic
video draft "my-topic"           # → projects/<slug>/article.md + audio-config.yaml
                            #   also refreshes storyboard.yaml (VDSL, derived from article.md)
# (video audio-plan my-topic is only needed to REGENERATE audio-config.yaml
#  after hand-editing article.md — the draft command already ran it)

# Then human edits:
$EDITOR projects/<slug>/article.md
$EDITOR projects/<slug>/audio-config.yaml

**`article.md` frontmatter that changes rendering.** Beyond `project` /
`language` / `duration_target_sec` / `voice`:

| Key | Effect |
|---|---|
| `image_style` | preset used for scene-image briefs (`editorial`, `flat-vector`, …) |
| `image_provider` | which image API `video make` uses; stamped by `--image-provider` |
| `theme` | storyboard theme, written by `--style` |
| `require_visual_approval: true` | `video make` refuses to render until `video approve visuals` freezes the image set |
| `captions_source` | what the caption overlay burns in: `narration` (default) or `caption` |
| `no_captions: true` | no caption overlay at all (set by `--no-captions`) |

**Use `captions_source: caption` for English articles.** The overlay is
validated against the bottom safe area — 3 lines × 24 CJK units, ASCII
counting 0.5 — which caps an English scene near 144 characters. English
narration runs 150-220 per scene, so `source: narration` fails validation
on nearly every scene and the render is refused. `caption` burns the
scene's short `caption:` label instead, which passes at any language and
stops a designed card's own text from being printed twice beneath itself.

# 🚪 Human gate: read article.md (mirrored into storyboard.yaml), then approve
video approve storyboard --cwd projects/<slug>
```

**Running `video make` without the approval fails at the render step** and
prints the exact instruction:

```bash
preview: storyboard is not approved yet — read .../storyboard/storyboard.yaml (make flow: article.md), then run:
  video approve storyboard --cwd <project parent dir>
```

`video draft` runs the audio-plan step on the fresh article automatically.
Two guardrails: `--no-audio-plan` skips the step (article only), and an
existing `audio-config.yaml` is never overwritten — hand edits win, and
the command prints a note pointing at `video audio-plan` when it kept one.
If the audio-plan LLM call fails, the draft still succeeds (article.md
is the primary artifact) with a hint to run `video audio-plan` separately.

To start from your own idea instead of a blank topic, pass
`--file <path>` with a text or markdown file. The LLM uses it as the
**major idea / opinions seed** — it polishes wording, structure, and
flow, but must not change any opinion you expressed. (Mutually exclusive
with `--from`, which revises an existing draft.)

### 6.2 Render with one command: `video make`

Every verb that takes a `<project>` argument resolves it the same
forgiving way, in order:

1. a direct path to a project root (e.g. `./projects/my-video`)
2. the exact folder name under `projects/`
3. the human topic — slugified, case- and separator-insensitive
   (`"Harness Engineering"`, `harness_engineering`, and
   `harness-engineering` all find the same project)
4. a unique folder-name prefix (`video make 长视频` finds `长视频测试`)

An ambiguous prefix errors listing the candidates; a zero-match error
lists every available project.

```bash
video make my-topic                                  # TTS → audio assets → render → mix (default image provider: minimax, v0.8.1+)
video make my-topic --fake                           # offline: silent placeholder WAVs + no AI images
video make my-topic --image-provider mock            # force mock images (64×36 placeholders) for offline testing
video make my-topic --image-provider minimax         # real AI image generation via MiniMax image-01 (default; needs MINIMAX_API_KEY)
video make my-topic --image-provider openai           # real AI image generation via OpenAI (needs OPENAI_API_KEY)
video make my-topic --image-provider gemini           # real AI image generation via Gemini (needs GEMINI_API_KEY)
video make my-topic --image-provider none              # skip image generation entirely
video make my-topic --bgm-dir ~/audio/bgm --sfx-dir ~/audio/sfx  # real BGM/SFX from your library
video make my-topic --dry-run                        # print what would run, do not execute
```

`--fake` is the canonical offline mode: it skips both Edge TTS (writing
silent placeholder WAVs) and real image generation. Scenes stay as
`AnimatedIllustration` (caption + animated SVG) so the rendered video is
visible end-to-end without any network access. Pass `--image-provider
mock` explicitly only when you want to exercise the `ImageBackground`
path with placeholder images.

### Narrating with a cloned voice (Voicebox)

Add `tts_provider: voicebox` to `article.md` frontmatter and set `voice:`
to a Voicebox voice profile (name or id). The provider talks to a local
voicebox-server on `VOICEBOX_URL` (default `http://127.0.0.1:17493`),
polls the async job, and writes the returned WAV; `syncSceneDurations`
then rewrites scene lengths to the measured audio. Qwen3-TTS 1.7B on
Apple Silicon synthesizes ~7× slower than realtime — budget ~20 min of
machine time per 180 s of narration, paid once per narration edit thanks
to the provider-namespaced TTS cache. See `docs/schema.md`
(`tts_provider:`) for details and re-draft semantics.

`--bgm-dir` / `--sfx-dir` point at your own audio library. The tag in
`audio-config.yaml` (`bgm: calm`, `sfx: {scene_1: whoosh}`) resolves to
`{tag}.wav` inside the directory (exact name first, then any `.wav`
containing the tag). Without the flags the audio-assets step writes a
1-second **silent mock placeholder** — the mix machinery runs, but you
are ducking silence. With the flags, real audio lands in
`assets/audio-assets/` and `video mix` layers it under the narration
(ducked ~-18 dB). A sibling `{tag}.license.txt` is recorded on the make
report so provenance is visible. A missing tag fails the
`audio-assets` step readably — add the file or drop the cue.

Outputs:

```text
projects/<slug>/output/preview.mp4           # visual preview
projects/<slug>/output/preview-faststart.mp4 # same, faststart metadata
projects/<slug>/output/final-mixed.mp4       # narration + BGM + SFX — the publishable artifact
projects/<slug>/assets/audio/scene_*.wav
projects/<slug>/assets/audio-assets/{bgm,sfx}/*.wav
projects/<slug>/captions/<lang>.srt
projects/<slug>/qa/render-report.json        # QA report, written on every render
projects/<slug>/qa/contact-sheet.png         # per-scene contact sheet for quick human review
projects/<slug>/scenes/                      # per-scene MP4 cache (content-hash keyed)
```

Rendering is **scene-isolated**: each scene renders to its own MP4
fragment first (`scenes/`, keyed by fragment content hash + narration
audio state), then the fragments are concatenated. Editing scene-007
re-renders only scene-007. `video preview --draft` renders the low-quality
tier (960×540@15) into `scenes-draft/`; the final output stays 1080p30.
Every render concludes with a QA report summary (duration / fps /
resolution / audio / black frames / assets / scene audio-sync / captions
/ boundaries); error-level findings fail the step.

### 6.3 Re-run after editing

`video make` is **idempotent** — outputs newer than inputs are skipped. So
when you edit either human-edit file and re-run, only the affected step
re-executes:

```bash
# You changed only audio-config.yaml's BGM tag
video make my-topic
# → skips already-fresh TTS + preview; re-runs audio-assets + mix
```

### 6.4 Validate the lower-level format (optional)

```bash
node packages/cli/dist/index.js validate \
  projects/<slug>/storyboard/storyboard.yaml \
  --root projects/<slug>
```

Reports file / line / field / reason on errors.

## 7. Editing, iteration, and recovery

### 7.1 The three human gates (workflow state, not a chat "please confirm")

| Gate       | Command                    | Blocks                                                                                         |
| ---------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Storyboard | `video approve storyboard` | `video preview` / `video make`'s render step refuses without it (`--force` bypasses, recorded) |
| Review     | `video approve review`     | `video final` refuses without it                                                               |
| Final      | `video final` (QA gate)    | error-level QA findings block the export (`--force` bypasses, recorded)                        |

Before re-running after edits, note the **stage guard**: generator verbs
(`research` / `script` / `storyboard` / `audio` / `motion`) refuse to
overwrite a human-approved stage or a FINAL_APPROVED project without
`--force` (printed as a warning). The typical loop:

```bash
# Tweaked a narrative section in article.md
$EDITOR projects/<slug>/article.md
video approve storyboard --cwd projects/<slug>   # re-read, re-approve
video make <slug>          # only TTS + render + mix re-execute (rest is skipped)

# Tweaked audio-config.yaml
$EDITOR projects/<slug>/audio-config.yaml
video make <slug>          # only audio-assets + mix re-execute

# Want a specific scene to use a different component (e.g. Image instead of Paragraph)
$EDITOR projects/<slug>/storyboard.yaml
video make <slug>          # only render + mix re-execute (scene-isolated cache: other scenes are reused)
```

`video make`'s publishable artifact is `final-mixed.mp4`; projects on the
full agent pipeline end with `video final` behind the QA + review gates.

### 7.2 The scene-level loop (the point of the whole system)

The scene is the minimal editable unit, and every scene carries version
history:

```bash
video scene list <slug>              # versions per scene (+ approved marker)
# … edit storyboard.yaml (or let an agent regenerate a scene) …
video preview <slug>                 # re-renders ONLY the changed scenes
video scene approve <slug> scene-05  # persist which version you approved
video scene restore <slug> scene-05 1
```

### 7.3 Remotion Studio live preview

```bash
video studio <slug> [--port 3000]    # open the project in Remotion Studio
```

The Studio workspace is regenerated from the storyboard on each launch —
use it to iterate on visuals before rendering any mp4.

### 7.4 Recovery

- `video resume` — make-flow projects re-run the idempotent pipeline;
  CLI-flow projects print state + the exact next command.
- `video rollback <checkpoint-id>` — validates the id, marks downstream
  checkpoints invalidated, lands at DRAFT/<target stage>; never
  overwrites artifacts (content restores go through `video scene restore`).
- `video reset [stage] [--force]` — rewind; marks the target checkpoint
  invalidated instead of faking an approval.

### 7.5 About hand-editing `storyboard.yaml`

`storyboard.yaml` is derived from `article.md` and gets refreshed on
every `video draft` run. Additionally, `video make` rewrites each scene's
`duration:` field after TTS to match the actual measured audio length —
without this, the renderer would use the article's planned duration and
freeze on a still frame when audio plays past it.

If you hand-edit `storyboard.yaml` (e.g. swap to the `Image` component
or tweak `props`):

- Per-scene `duration:` and other `video draft`-derived fields get
  overwritten on the next `video draft`.
- The per-scene `duration:` also gets overwritten on the next `video make`
  (since it re-measures audio).
- Everything else (component choice, props, subtext, etc.) survives
  the next `video make` because `syncStoryboardDurations` only touches the
  `duration:` line.

The supported flows are:

- Editorial tweaks → edit `article.md`, then `video draft` regenerates
  storyboard.yaml cleanly.
- Pixel-level art direction → hand-edit `storyboard.yaml`, then run
  `video make` directly. **Don't** re-run `video draft` until you're ready
  to lose those tweaks.

## 8. Optional AI workflow

The AI commands use MiniMax and GLM-compatible APIs. They are optional for the
local render path.

Set credentials in the shell environment; never commit them to the repository:

```bash
export MINIMAX_API_KEY="..."
export GLM_API_KEY="..."
```

Default provider routing is defined in `packages/llm/src/config.ts`:

```yaml
research:
  primary: glm
  fallback: minimax
script:
  primary: minimax
  fallback: glm
storyboard:
  primary: minimax
  fallback: glm
visual:
  primary: minimax
  fallback: glm
motion:
  primary: minimax
  fallback: glm
review:
  primary: glm
  fallback: minimax
```

To use a custom routing file:

```bash
export LL_CONFIG="$PWD/llm.config.yaml"
```

### Provider fallback on quota / rate-limit errors

When the primary provider returns a quota or rate-limit error (HTTP 429
/ 402 / 403, or response bodies containing `insufficient_balance`,
`quota_exceeded`, `rate_limit`), each AI command automatically retries
once with the configured fallback before failing the run. The
provider that actually served the request is recorded in
`runs/<id>.yaml` under `provider:` — so users can audit whether
fallback kicked in.

Override the routing per-command:

```bash
video draft "topic" --model minimax   # force minimax (no fallback to glm)
video storyboard "topic" --model glm --lang en-US
```

A non-quota error from the primary (e.g. HTTP 400 invalid payload) is
**not** retried with the fallback — it surfaces immediately, because
the fallback provider would return the same error on the same input.

### Local decision layer (v0.6, optional): Laya

If the [Laya](https://huggingface.co/convaiinnovations/laya)
decision-model service is running locally (default
`http://127.0.0.1:8019`), the pipeline can consult it for BOUNDED
decisions — never for generated text. Laya is advisory only: it never
replaces a human gate, and every failure degrades to the normal code
path.

```bash
export LAYA_MODE=shadow   # off (default) | shadow (log only) | on (act)
export LAYA_URL=http://127.0.0.1:8019          # optional
export LAYA_MIN_CONFIDENCE=0.6                 # acting threshold (on mode)
```

What each surface does (design + promotion gates:
`docs/v0.6-laya-decision-integration-plan.md`):

| Surface           | Command                          | Laya's question                                           | In `on` mode                                                                          |
| ----------------- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| motion pre-screen | `video motion`                   | "is the deterministic baseline good enough?"              | baseline-ok scenes skip the cloud motion agent                                        |
| visual assist     | `video draft` / `video make`     | component choice for scenes where no keyword rule matched | overrides the fall-through default                                                    |
| QA triage         | `video qa` / `preview` / `final` | pass / review / block on the render report                | verdict appears as `advisory.laya` in `qa/render-report.json` + contact-sheet caption |

Every consult is appended to `laya-decisions.jsonl` in the project
directory (audit trail + shadow-evaluation corpus). Diagnostics:

```bash
video laya health                  # probe the service + resolved config
video laya ask < json-file         # one raw consult (shows probabilities)
video laya eval <project>          # shadow-agreement vs §7 promotion gates
```

### Recommended: `video draft` (merged audio-plan) + approve + `video make`

The AI workflow collapses to a few steps producing the two human-edit
files:

```bash
# 1. One command writes both files: article.md (an editable long-form
#    markdown + Scenes YAML block) and audio-config.yaml (voice / bgm /
#    sfx / fades). --no-audio-plan skips the audio step; an existing
#    audio-config.yaml is never overwritten.
video draft "AI Agent Memory"
video draft "AI Agent Memory" --no-web
video draft "AI Agent Memory" --model glm --lang zh-CN --duration 60 --audience developers
video draft "AI Agent Memory" --from outline.md   # revise an existing outline
video draft "AI Agent Memory" --file my-idea.md   # polish YOUR idea; opinions preserved
video draft "AI Agent Memory" --no-audio-plan     # article.md only
video draft "AI Agent Memory" --bgm guofeng       # stamp bgm: guofeng into the FRESH audio-config.yaml
video draft "AI Agent Memory" --no-ask            # never ask questions — accept the defaults (see below)

# Quality gate (on by default): after drafting, an LLM judge scores the
# article across 8 dimensions × 24 indicators on a 0-100 weighted scale.
# Below the bar (default 90 = grade A; Critical risk flags fail regardless
# of score) the draft is regenerated with the judge's feedback, up to 8
# attempts; the top-scoring candidate is kept even if nothing passed, and
# the per-attempt scores land in <project>/article-review.yaml.
video draft "AI Agent Memory" --min-score 80 --max-attempts 8
video draft "AI Agent Memory" --no-review         # single draft, no judging

# 2. 🚪 Human gate: read article.md, then approve the storyboard
video approve storyboard --cwd projects/ai-agent-memory

# 3. Render — TTS → audio assets → render → mix (QA report on every render)
video make ai-agent-memory
```

Outputs:

```text
projects/<slug>/article.md           # human edits: narrative + Scenes YAML
projects/<slug>/audio-config.yaml    # human edits: voice / bgm / sfx / fades
```

After human edits to these two files (and re-approval when article.md
changed), `video make <slug>` produces the publishable mp4 in a single
command.

### Agent question protocol (`video-ask/1`)

Inside an agent harness (zcode, Claude Code, …), `video draft` no
longer burns a full scored draft on silent defaults. When style knobs
were left unspecified, the CLI prints a machine-readable question set
to stdout and exits **2** — the run has not started and nothing has
been spent. The agent relays the questions through its own question
UI (recommended option highlighted) and re-runs with explicit flags.

New flags on `video draft`:

| Flag                | One-line help                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ask`             | force the agent question protocol, even with no agent harness detected                                                                                         |
| `--no-ask`          | never ask — accept the defaults (right choice for unattended sub-runs)                                                                                         |
| `--bgm <tag\|none>` | BGM tag from the library in `assets/bgm/` (e.g. `upbeat-your-love`, `light-gravity`, `classical-gymnopedie-no-3`), or `none` for silence. Default: the audio planner's pick — see `assets/bgm/README.md` |

**Live progress (v0.7.1)** — `video make` and `video draft` print
step/scene progress and heartbeats to **stderr** while running
(stdout stays clean for artifacts): `✓ [3/23] tts scene_03  4s`,
`⏳ generate-visuals … 95s`. Agents polling background output and
humans in a terminal see the same lines.

**When it fires** — auto mode asks only when an agent harness is
detected **and** at least one style knob was left unspecified.
Detectors: `ZCODE_APP_VERSION` → zcode, `CLAUDECODE` → Claude Code,
`OMO_CODING_AGENT_DIR` → oh-my-openagent, `OMP_CODING_AGENT_DIR` →
oh-my-pi, `PI_CODING_AGENT_DIR` → oh-my-pi/pi-fork sessions (plain pi
sets no marker — declare it via `VIDEO_ASK_ENV`). OpenCode exports no
stable child-process marker, so declare
it — or any other harness — with
`VIDEO_ASK_ENV=VAR,VAR=VALUE,…` (matches on presence, or exact value
with `VAR=VALUE`). Precedence, first match wins:

| Override                     | Effect                                               |
| ---------------------------- | ---------------------------------------------------- |
| `--no-ask` / `VIDEO_ASK=off` | never ask — normal run                               |
| `--ask` / `VIDEO_ASK=force`  | always ask (even with no harness detected)           |
| neither                      | auto: ask iff agent detected AND ≥1 knob unspecified |

An unknown `VIDEO_ASK` value warns on stderr and behaves as auto.

**Exit codes**: `0` ran · `1` failure (unchanged) · `2` questions
pending — the run did not start. On exit 2 stdout is pure JSON
(envelope `protocol: "video-ask/1"`, parseable with `jq`); all
human-readable hints go to stderr, e.g.
`agent-ask: 5 question(s) pending (exit 2 — run not started, nothing spent)`.

**The five questions** — only unspecified knobs are asked, in this
order. `audience`, `model`, and the review-gate knobs stay flag-only
power knobs:

| id            | flag            | type   | default       | recommended       | why                                                      |
| ------------- | --------------- | ------ | ------------- | ----------------- | -------------------------------------------------------- |
| `lang`        | `--lang`        | choice | `zh-CN`       | **`zh-CN`**       | wrong language burns a full scored draft (~4× one draft) |
| `duration`    | `--duration`    | number | `180`         | **`180`**         | scene count scales with it                               |
| `image_style` | `--image-style` | choice | `flat-vector` | **`flat-vector`** | taste call, unrecoverable post-render                    |
| `style`       | `--style`       | choice | `paper-light` | **`paper-light`** | theme changes every scene                                |
| `bgm`         | `--bgm`         | choice | `calm`        | **`calm`**        | wrong mood = paid re-render at make time                 |

The presenting agent may replace a recommendation with a topic-aware
pick when the topic clearly demands it (e.g. a Han-dynasty history
topic → `liubang-xiaodiao` + `editorial`) and states the reason in
the question text.

**Scene-image styles** — choose with `--image-style <name>` or
`image_style:` in `article.md`. `flat-vector` is the default. These presets
are tuned for MiniMax `image-01`; the Image-01 comparisons found photoreal
strongest when subject fidelity matters, while some painterly styles need
the figure called out as the focal subject.

| Style | Best for |
| --- | --- |
| `flat-vector` | Clean editorial diagrams and consistent explainer scenes. |
| `photoreal` | People, products, and real settings where the subject must read clearly. |
| `watercolor` | Painterly landscapes and nature; prompts keep a central person in the foreground. |
| `ink-wash` | Poetic historical or cultural atmosphere when a readable figure still matters. |
| `clay-3d` | Playful concepts and objects with a handmade stop-motion feel. Faces are explicitly shaped to avoid featureless figures. |
| `manga` | Dramatic character or action scenes with ink and screentone, without comic lettering or panels. |
| `genki-anime` | Bright, upbeat explainers led by a recognizable recurring character. |
| `medieval` | Period-history scenes with an illuminated-miniature look and no manuscript lettering. |
| `editorial` | Abstract ideas and history told through one visual metaphor. |
| `whiteboard` | Teaching scenes with sparse marker line art and space for draw-on overlays. |
| `isometric` | Systems, architecture, and processes shown from a consistent axonometric view. |
| `paper-cut` | Tactile narrative scenes built from layered paper shapes. |

Inspect the full prompt contracts with `video prompts show image-styles.yaml`.

**`--bgm` semantics** — the answered tag is stamped into a **fresh**
`audio-config.yaml` as `bgm: <tag>` (`none` → `bgm: null`),
overriding only the `bgm:` key the audio-plan LLM would otherwise
pick — voice and SFX stay LLM-chosen. An **existing**
`audio-config.yaml` wins (hand edits are never overwritten): the CLI
prints
`bgm answer not applied — audio-config.yaml kept; run 'video audio-plan' to regenerate`
instead. `--no-audio-plan` drops the `bgm` question entirely — the
CLI never asks what it cannot apply. Free-form tags stay legal
end-to-end (unknown tags degrade to mood text); the question offers
only the 5 known tags + `none`.

Unattended sub-runs (scripts an agent launches) should pass
`--no-ask`; headless cron/launchd shells should set `VIDEO_ASK=off`.

The full contract (JSON envelope, snapshot-tested field order,
agent-side presentation rules) lives in
[docs/v0.7-agent-ask-protocol-plan.md](./v0.7-agent-ask-protocol-plan.md).

### The full agent pipeline (fine-grained, incl. the v0.2 verbs)

For per-stage control — or to reach capabilities `video make` doesn't cover
(motion planning, diagram assets, QA re-checks) — the canonical order is:

```bash
video new "<slug>"
video research "<topic>"          # optional, feeds script/storyboard
video script "<topic>" --from-research …
video storyboard "<topic>" --from-research … --from-script …
video approve storyboard --cwd projects/<slug>     # 🚪 HUMAN GATE 1
video motion <slug> [--bpm 100]                    # Motion Agent (LLM + deterministic fallback)
video audio <slug>                                 # TTS → per-scene WAVs + captions
video excalidraw <slug>                            # diagram scenes → .excalidraw + animated SVG assets
video review <slug>                                # read-only Content/Visual/Technical review
video preview --cwd projects/<slug>                # QA report + contact sheet (WAITING_REVIEW)
video qa <slug>                                    # rebuild the report; exits 1 on errors
video approve review --cwd projects/<slug>         # 🚪 HUMAN GATE 2
video final --cwd projects/<slug> [--mix]          # 🚪 HUMAN GATE 3 (QA-gated) → FINAL_APPROVED
video youtube <slug>                               # publishing metadata
video bilibili <slug>                             # Bilibili submission metadata (no upload — see below)
```

### `video motion` — the Motion Agent

Plans per-scene timeline animations and transitions (written into the
storyboard's `animations:` / `transition:`):

```bash
video motion my-topic                  # LLM planning (provider routed per the motion role)
video motion my-topic --bpm 120        # quantize entrance/emphasis moments to a beat grid
video motion my-topic --scene scene-03 # plan one scene only
video motion my-topic --baseline       # skip the LLM — apply deterministic heuristics verbatim
```

Works with or without the installed skill packs: when `.agents/skills/`
is absent, `IartSkillAdapter` degrades to null and planning falls back
to the deterministic heuristics — the installed `iart-ai` packs simply
make the LLM's plans better.

### `video excalidraw` — diagram asset generator

Converts every `svg`/`SvgScene` scene in the storyboard into a
**hand-editable** `.excalidraw` file plus a standalone animated SVG
(under `assets/excalidraw/`): `video excalidraw my-topic [--duration 8]`.
Exits with a hint when the storyboard has no diagram scenes.

### `video qa` — QA re-check

Rebuilds the QA report for the current preview at any time
(`qa/render-report.json`); strict mode (default) exits 1 on error-level
findings, `--no-strict` reports without failing:

```bash
video qa my-topic
video qa my-topic --no-strict
```

### YouTube package

Not part of `video make`; invoke separately when needed:

```bash
video youtube <slug>
```

Writes title, description, WebVTT chapters, package YAML, thumbnail
prompt, and Shorts hook under `youtube/`. The thumbnail / Shorts MP4
come from `video thumbnail` and `video shorts` (see §12.5).

#### Direct upload (v0.9.1)

```bash
video youtube --auth                      # one-time OAuth consent
video youtube <slug> --upload             # package + upload final-mixed.mp4
video youtube <slug> --upload --privacy public   # private (default) | unlisted | public
```

Upload sends `output/final-mixed.mp4` with the packaged title and
description (chapters block prepended — YouTube activates chapter markers
only when the description leads with a `00:00 …` line), then sets
`youtube/thumbnail.png|jpg` as the thumbnail if present.

One-time setup (~15 min, needs a browser):

1. `console.cloud.google.com` → create a project.
2. APIs & Services → Library → enable **YouTube Data API v3**.
3. OAuth consent screen → External → add your Google account as a
   **Test user**; scope `youtube.upload`.
4. Credentials → Create OAuth client ID → type **Desktop app** →
   download `client_secret.json`.
5. Save it as `~/.config/secrets/client_secret_youtube.json` (or set
   `YOUTUBE_CLIENT_SECRET_FILE`, or pass `--client-secret <path>`).
6. `video youtube --auth` — opens the browser, prints
   `YOUTUBE_REFRESH_TOKEN=…`; append it to `~/.config/secrets/ai.env`
   and restart your shell.

Caveats while the OAuth app stays in **Testing** status: refresh tokens
expire after 7 days (re-run `--auth`), uploads land **locked private**
(flip to public in YouTube Studio), and the daily upload quota is ~6
videos (1,600 of the default 10,000 units each). Publishing the app
through Google verification lifts the first two.

## 9. Voice, subtitles, and audio


### `video bilibili` — Bilibili packaging (no upload)

Bilibili has **no public video-upload API for third-party tools**. The
`openhome.bilibili.com` platform covers games, live and content-partner
integrations, not generic submission, and the web form posts to
undocumented internal endpoints that are actively hardened against
automation. So this command does the half that can be automated:

```bash
video bilibili <slug> [--model minimax|glm]
# → projects/<slug>/bilibili/package.yaml     title / 简介 / tags / suggested 分区 / cover brief
# → projects/<slug>/bilibili/cover-prompt.txt  cover image brief
# → projects/<slug>/bilibili/CHECKLIST.md     the manual upload steps
```

Field limits are enforced before you reach the form, which silently
truncates past them: title ≤ 80 characters, 简介 ≤ 2000, at most 10 tags
of ≤ 20 characters each.

Three decisions worth knowing:

- **`suggested_category` is a 分区 *name*, not a numeric `tid`.** A wrong
  `tid` does not error — it files the video into an unrelated section and
  nobody notices until after publishing. A name you can check against the
  dropdown fails loudly instead. `null` means "no confident pick".
- **A failed model call degrades, it does not fail.** Provider outage,
  content filter, malformed YAML or a schema violation all fall back to a
  deterministic package derived from `article.md`, with the warning printed
  and recorded in the checklist. `video youtube` hard-fails on the same
  conditions.
- **The cover brief is reused** from `video youtube`'s thumbnail prompt when
  that package exists, so both platforms show the same video.

Add `video bilibili` to a project's checklist alongside `video youtube`; the
`.srt` captions are reusable but Bilibili wants them uploaded through the
submission form.

### 9.1 Recommended: subsumed into `video make`

Today, TTS, BGM/SFX assets, mixing, and SRT subtitles are all
produced by `video make` in one invocation — no need for separate `video audio`,
`video audio-asset`, or `video mix` calls:

```bash
video make <slug>           # real Edge TTS (requires network); image provider defaults to minimax (v0.8.1+) — needs MINIMAX_API_KEY
video make <slug> --fake    # silent placeholder WAVs + no AI images (offline / CI-friendly)
video make <slug> --image-provider openai    # image generation via OpenAI (needs OPENAI_API_KEY)
video make <slug> --image-provider gemini    # image generation via Gemini (needs GEMINI_API_KEY)
```

Default provider is Edge TTS (free, no API key). It depends on the
online Microsoft Edge TTS endpoint — rate limits and network failures
apply.

`--fake` also disables AI image generation (no `MINIMAX_API_KEY`
required). Scenes stay as `AnimatedIllustration` (caption + animated
SVG), so the rendered video is visible end-to-end without any network
access. Override with `--image-provider mock` (placeholders), or another hosted provider —
`openai` (`OPENAI_API_KEY`) / `gemini` (`GEMINI_API_KEY`). See the
README's "Image Providers" section for the full comparison.

By default the BGM/SFX tags in `audio-config.yaml` materialize as
1-second **silent mock placeholders** — the mixing machinery runs, but
there is no real music. Point `video make` at your own library to get real
audio (`--bgm-dir`, `--sfx-dir`; see §6.2), or pre-seed
`assets/audio-assets/{bgm,sfx}/{tag}.wav` yourself (idempotent make
keeps existing files).

Outputs:

```text
projects/<slug>/assets/audio/scene_*.wav
projects/<slug>/assets/audio-assets/bgm/<tag>.wav
projects/<slug>/assets/audio-assets/sfx/<tag>.wav
projects/<slug>/captions/<lang>.srt
```

The `.srt` file is SRT-formatted (despite the extension), drop-in
compatible with most subtitle workflows.

### 9.2 Inter-sentence pauses (`pause_between_sentences_sec`)

Insert silence between sentences in TTS output by setting a single
field in `audio-config.yaml`:

```yaml
voice: zh-CN-XiaoxiaoNeural
bgm: "calm"
bgm_fade_in_sec: 1.5
bgm_fade_out_sec: 2
pause_between_sentences_sec: 1 # 1-second pause after every sentence
sfx: {}
```

- Range `0–5` seconds; `0` disables.
- Implementation: `video make` wraps the text in `<speak>...</speak>`
  SSML with `<break time="Nms"/>` after each `.`, `!`, `?`, `。`, `！`,
  `？`. Edge TTS treats each `break` as literal silence in the audio.
- Typical values: `0.5–1.0` sec. `video audio-plan` defaults to `0`;
  if a scene has 2+ sentences and you want clearer pacing, bump it up.
- Editing only this field and re-running `video make` re-executes just the
  TTS step; mix/preview outputs are skipped because nothing they
  depend on changed.

### 9.3 Voice selection

The default voice depends on the article's `language` field. To override
per-project, edit `voice:` in `audio-config.yaml`. To change the global
default, edit `ZH_VOICE` / `EN_VOICE` in
`packages/make/src/tts-cache.ts` and re-build.

| Language | Default (male)                             | Female alt.            | Other male alts                                          |
| -------- | ------------------------------------------ | ---------------------- | -------------------------------------------------------- |
| `zh-CN`  | `zh-CN-YunjianNeural` (documentary-style)  | `zh-CN-XiaoxiaoNeural` | `zh-CN-YunxiNeural` (warm), `zh-CN-YunyangNeural` (news) |
| `en-US`  | `en-US-ChristopherNeural` (calm narration) | `en-US-AriaNeural`     | `en-US-GuyNeural`, `en-US-EricNeural`                    |

Any voice ID listed by Edge TTS works — pass it as `voice:` in
`audio-config.yaml`. The LLM-generated article always uses the male
default unless your `voice:` line overrides it.

### 9.4 Edge TTS caveats

Edge TTS has no direct API charge, but commercial redistribution and
long-term production use should be checked against the service terms. To
replace with a formally licensed provider (MiniMax TTS, ElevenLabs,
etc.), implement the `TTSProvider` interface in `@video/tts` and pass it to
`video make` (CLI integration in a follow-up).

## 9.5 Branding and marketing (`brand.yaml` + multi-BGM)

Branding lives at the WORKSPACE root — `<repo>/brand.yaml` plus shared
assets in `<repo>/assets/brand/` — and every project inherits it
automatically at render time (`preview` / `final` / `make`). To rebrand a
single project, drop `projects/<id>/brand.yaml`: it overrides the root
config per top-level key (a project `intro:` block replaces the root
`intro:` wholesale). Paths in a brand file resolve relative to that file's
own directory, and icons are stored absolute after the merge, so rendering
works from any working directory.

```yaml
# <repo>/brand.yaml  (shipped default: "AI 视频工厂" + placeholder icon)
brand:
  name: "我的频道" # shown in the intro band
  icon: assets/brand/icon.png # corner watermark on EVERY scene (png/jpg/svg)
  corner: bottom-right # top-left | top-right | bottom-left | bottom-right
  size_px: 72 # authored at 1080p; scales with composition width
  opacity: 0.85
  intro: # omit the whole intro block = no branded opening
    duration_sec: 15 # fixed-look opening window (10-20s is typical)
    background: aurora # aurora | sunset | ocean | citrus
    show_name: true
```

During the intro window the renderer adds a brand gradient band (with the
channel name) plus a subtle full-screen tint — the opening reads as one
branded block while scene content stays legible; after the window only the
corner watermark remains. Visual check: `node scripts/render-brand-smoke.mjs`.

Multi-BGM (different mood for opening vs body) lives in
`audio-config.yaml`; when present it overrides `bgm`:

```yaml
bgm_tracks:
  - { track: calm, until_sec: 18 } # absolute seconds; last entry → end
  - { track: epic }
```

`track` is a named tag (materialized to
`assets/audio-assets/bgm/<tag>.wav` by the audio-asset step, exactly like
`bgm`) or a file path — resolved against the project first, then the
workspace root, so shared brand audio can live in
`<repo>/assets/brand/`. The windows are crossfaded
(1 s) into `assets/audio-assets/bgm/_timeline.wav`, then mixed through the
normal ducker and master fades — `bgm_fade_in_sec` / `bgm_fade_out_sec`
still apply.

#### Where named BGM tracks come from

BGM is resolved from the local library in `assets/bgm/`, never generated.
`bgm: <tag>` in `audio-config.yaml` looks in the project's
`assets/audio-assets/bgm/` first, then `assets/bgm/`, then `assets/brand/`, and
passes the file to ffmpeg in place. A tag that resolves nowhere warns and mixes
silence — a bad tag never fails the render. `packages/prompts/prompts/music.json`
indexes the library with each track's duration, loudness, dynamic range and
suitability notes; see `assets/bgm/README.md` for provenance.

## 9.6 Visual guardrails (v0.8)

Three guardrails around scene-image generation. Plan:
`docs/v0.8-visual-guardrails-plan.md`. All default-off; a project with no
new frontmatter keys behaves exactly as v0.7.1.

### Content-keyed images + impact table

Every `assets/images/scene_N.jpg` carries a `scene_N.cache.json` sidecar
hashing its inputs (the scene's `visual:` line, `image_style`, image
provider, geometry). Change any of
them and the stale image is deleted and regenerated on the next
`video make` — before v0.8 an edited `visual:` line never reached the
picture because the cache keyed on file existence. Images that predate the
sidecar are _adopted_ (kept and keyed), so upgrading never re-spends.

Preview the blast radius before spending:

```bash
video make <project> --dry-run
```

```
impact (nothing executed):
  images: 1 regenerate (stale), 1 cached
    regenerate: scene_7
  tts: all 14 cached
  render: 1 scene(s) will render, 13 cached
    render: scene-07
```

The table also flags storyboard drift (article narration changed while
the id-keyed sync kept the old storyboard text).

### Keyframe review (opt-in gate)

Add to `article.md` frontmatter:

```yaml
---
require_visual_approval: true
---
```

Then the human review loop:

```bash
video visuals <project>                              # generate + contact sheet
video visuals <project> --reject 7 --reason "太暗"     # force-regenerate scene 7
video approve visuals <project>                      # freeze the set
video make <project>                                # renders only if the set matches
```

`video visuals` writes `assets/images/contact-sheet.png` — one labeled
grid of every scene image (numbered badges + captions, Pillow in the
existing python env). `video approve visuals` records per-scene hashes in
`checkpoints/visuals.yaml`. Once armed, `video make` refuses to render
while the checkpoint is missing or stale, naming the offending scenes.
The workflow stage machine is untouched; the gate is a checkpoint record.

## 10. Project artifacts and provenance

### Recommended layout

```text
projects/<slug>/
├── project.yaml                     project metadata
├── article.md                       ⭐ human edits: narrative + Scenes YAML (video draft writes)
├── audio-config.yaml                ⭐ human edits: voice / bgm / sfx / fades (video audio-plan writes)
├── storyboard/storyboard.yaml       derived by video draft from article.md; per-scene duration is re-measured after TTS by video make (hand edits to other fields survive; durations get overwritten on the next make)
├── vdsl/vdsl.yaml                   normalized compiled VDSL (deterministic; falls back to the storyboard loudly when corrupt)
├── state.yaml                       workflow state machine (10 states; drives the gates and guards)
├── checkpoints/<stage>.yaml         human-gate audit trail (approved/rejected/invalidated)
├── checkpoints/visuals.yaml         v0.8: approved image set (per-scene hashes) when require_visual_approval is on
├── runs/<run-id>.yaml               per-LLM/tool-call run records
├── scenes/                          per-scene MP4 cache (content-hash keyed; final 1080p30)
├── scenes-draft/                    low-quality draft cache (--draft: 960×540@15)
├── qa/
│   ├── render-report.json           QA report, written on every render (rebuild with video qa)
│   └── contact-sheet.png            per-scene contact sheet
├── assets/
│   ├── audio/scene_*.wav           per-scene TTS (video make writes)
│   ├── audio-assets/{bgm,sfx}/     BGM/SFX assets (video make writes)
│   ├── images/scene_N.jpg          scene image + scene_N.cache.json input-key sidecar (v0.8)
│   ├── images/contact-sheet.png    v0.8: `video visuals` review grid
│   └── excalidraw/                 video excalidraw writes: .excalidraw + animated SVG
├── captions/<lang>.srt              subtitles (video make writes)
├── youtube/                         publishing package from video youtube / thumbnail / shorts
├── bilibili/                        video bilibili: package.yaml + cover-prompt.txt + CHECKLIST.md (manual upload)
└── output/
    ├── preview.mp4                  video make writes
    ├── preview-faststart.mp4        video make writes
    └── final-mixed.mp4              ⭐ publishable artifact (video make writes)
```

`⭐` marks the two human-edit files; everything else is derived.

`storyboard.yaml` is **derived from `article.md`** (every `video draft`
run refreshes it from the parsed article). The first scene maps to
the `Title` component; the rest map to `Paragraph`; `caption` becomes
on-screen text. If you want pixel-level visual control (swap to
`Image`, tweak props), hand-edit `storyboard.yaml` and run `video make`
— but the next `video draft` **overwrites** your edits. If hand-edits
matter, run `video make` directly without re-drafting.

### Run record fields

`runs/<run-id>.yaml` entries carry `provider`, `model`, `tokens`
(`{input, output}`), `prompt_hash`, `estimated_cost_usd`,
`input_files`, `output_files` references, and an ISO timestamp.

**Never** commit API keys, `.env`, private source material, tokens, or
cookies.

## 11. Troubleshooting

### Validation reports a missing asset

Paths such as `assets/audio/scene_01.wav` are relative to the project
root, not the directory containing the YAML file. Check the path and run:

```bash
video validate projects/demo/storyboard/storyboard.yaml --root projects/demo
```

### `video make` complains about missing files

`video make` needs both `article.md` and `audio-config.yaml` at
`projects/<slug>/`. The error surfaces a hint for each missing file:

```text
article.md not found at .../article.md
# hint: run `video draft <topic>` first

audio-config.yaml not found at .../audio-config.yaml
# hint: run `video draft <topic>` first   # (yes, both files come out of video draft + video audio-plan together)
```

Run `video draft <topic>` and `video audio-plan <topic>` first, then re-run
`video make`.

### `preview: storyboard is not approved yet`

The pre-render human gate: the storyboard hasn't been approved. Read
`projects/<slug>/storyboard.yaml` (the make flow's mirror of
`article.md`), then run the command from the error message:

```bash
video approve storyboard --cwd <project parent dir>
```

To skip it deliberately, `video preview --force` (prints a `[FORCE]`
warning and records it in the audit trail). Note the stage guard also
stops generators from overwriting an approved stage — regenerate with
`--force`, or `video rollback` / `video reset` first.

### `video final` is blocked by the QA gate (`qa-gate: N error-level finding(s)`)

The pre-export QA re-check found error-level issues (duration / black
frames / audio-sync / missing assets, …). Open `qa/render-report.json`,
fix the findings (each carries a fix suggestion), re-run `video preview`,
then `video final` again. To export anyway, `video final --force` (the failed
gate stays in the run history).

### Edge TTS fails

Check network access, retry later, or fall back to offline mode:

```bash
video make <project> --fake
```

### `article.md has empty scene narrations`

Occasionally the LLM puts all prose in the `## N. ...` section bodies and
ships every scene's `narration:` field blank. All article-consuming verbs
(`video make`, `video audio-plan`, `video youtube`) now auto-recover by
distributing the section bodies across the empty scenes — you'll see a
`recover-narrations` step (in `video make`'s report) or a warning line
telling you how many scenes were back-filled.

To regenerate a clean draft instead:

```bash
video draft <topic> --from projects/<slug>/article.md
```

For CI, keep the old fail-loudly behaviour on `video audio-plan`:

```bash
video audio-plan <project> --strict
```

### Remotion cannot find a port

Another process or the execution environment may prevent local port binding.
Stop stale render processes, retry with a clean shell, and verify that local
loopback sockets are permitted.

### Disk usage grows fast (`node_modules` / `/tmp`)

Two temp directories accumulate during heavy use:

- **`node_modules/.cache/webpack`** — Remotion's persistent webpack cache.
  Grows incrementally on every unique render config. Delete to reclaim
  space; the next render rebuilds it.

  ```bash
  rm -rf node_modules/.cache/webpack
  ```

- **System `$TMPDIR` (e.g. `/tmp` on Linux, `$TMPDIR` on macOS)** —
  `remotion-webpack-bundle-*` and `remotion-v*-assets-*` dirs from each
  Remotion render. Each render leaks ~26MB; hundreds of test/make runs
  can leave tens of GB. `video make` sweeps these automatically every
  render (entries older than 1 hour), but other Remotion invocations
  (e.g. direct `video preview` calls during local dev) may not. To
  reclaim now:

  ```bash
  # macOS default:
  rm -rf "$TMPDIR"/remotion-webpack-bundle-* "$TMPDIR"/remotion-v*-assets*
  # Linux:
  rm -rf /tmp/remotion-webpack-bundle-* /tmp/remotion-v*-assets*
  ```

## 12. Step-by-step: create a video from a topic

### 12.0 Recommended: minimal API (2 AI commands + 1 human approval)

The entire pipeline is **2 commands + 1 human approval + 2 human-edit
files + 1 rendered output**:

1. `video draft <topic>` → writes `article.md` and `audio-config.yaml`
   (LLM consolidates research + script + storyboard + audio plan in one
   call; `--no-audio-plan` skips the audio step; `--file <path>` seeds
   the draft with your raw idea (opinions preserved); an existing
   `audio-config.yaml` is never overwritten — regenerate with
   `video audio-plan`)
2. `video approve storyboard` → 🚪 human gate: read article.md, then
   approve (without it `video make` fails at the render step with this
   exact instruction)
3. `video make <project>` → everything else: TTS → audio assets → render
   (scene-isolated, QA report) → mix → mp4

```mermaid
flowchart LR
    topic[topic] --> videoDraft["video draft (LLM)"]
    videoDraft --> articleMD["article.md ⭐ human-edit"]
    videoDraft --> audioConfig["audio-config.yaml ⭐ human-edit"]
    articleMD --> videoApprove["video approve storyboard 🚪"]
    audioConfig --> videoApprove
    videoApprove --> videoMake["video make"]
    videoMake --> previewMp4[preview.mp4]
    videoMake --> finalMixedMp4["final-mixed.mp4"]
```

`video make` is **idempotent** — outputs newer than inputs are skipped. Use
`--dry-run` to preview what would run without executing.

### 12.1 One-time setup

```bash
# ffmpeg (required for everything) + Node 22+
brew install ffmpeg                 # macOS; on Debian/Ubuntu: sudo apt install ffmpeg

git clone https://github.com/huangjien/ai-video-factory.git
cd ai-video-factory
npm install
npm run build
```

### 12.2 Scaffold a project

```bash
TOPIC="ai-thinking"
video new "$TOPIC"
# Creates projects/<slug>/ with:
#   project.yaml
#   storyboard/storyboard.yaml    (template — 2 scenes, used by video make rendering)
#   state.yaml
#   runs/, checkpoints/, output/, assets/, etc.
```

### 12.3 LLM drafting (the recommended path)

Requires `GLM_API_KEY` (default) or `MINIMAX_API_KEY` in the environment.

```bash
# 1. Draft — writes article.md (combines research + script + storyboard in one)
#    Output: projects/<slug>/article.md
#      - YAML frontmatter (project / language / duration_target_sec / voice)
#      - # <title> + > **Hook**
#      - ## <n>. <Section> + <body> paragraphs (human-editable)
#      - ## Scenes  fenced YAML block (drives downstream tools)
#    Also derives storyboard.yaml (VDSL): first scene → Title, rest → Paragraph,
#    `caption` becomes on-screen text. `video make` renders this file, so the
#    video length stays in sync with the audio automatically.
video draft "$TOPIC"                  # default: enable MiniMax web search
video draft "$TOPIC" --no-web          # disable web, model knowledge only
video draft "$TOPIC" --model glm --duration 40 --lang zh-CN --audience developers
video draft "$TOPIC" --from outline.md  # revise an existing outline
video draft "$TOPIC" --file my-idea.md  # polish YOUR idea into an article; opinions preserved
```

```bash
# 2. Audio-plan — OPTIONAL: `video draft` already ran this. Re-run it only to
#    REGENERATE audio-config.yaml after hand-editing article.md.
#    One file holds all audio knobs (voice / bgm tag / sfx cues / fades)
video audio-plan "$TOPIC"
```

Then human edits the two files:

```bash
$EDITOR "projects/$TOPIC/article.md"          # narrative, scene tweaks, durations
$EDITOR "projects/$TOPIC/audio-config.yaml"   # BGM tag, SFX cues, fades
```

### 12.4 Render (approve first, then one command)

```bash
# 🚪 Human gate: read projects/$TOPIC/article.md, then approve the storyboard
# (--cwd may point straight at the project dir; `--cwd projects` also works
#  when exactly one project exists under projects/)
video approve storyboard --cwd "projects/$TOPIC"

video make "$TOPIC"                       # TTS → audio assets → render → mix (real Edge TTS)
video make "$TOPIC" --fake                # FakeTTSProvider (no network; silent placeholder WAVs + no AI images)
video make "$TOPIC" --image-provider minimax  # real AI image generation (default; needs MINIMAX_API_KEY)
video make "$TOPIC" --image-provider openai   # via OpenAI (needs OPENAI_API_KEY)
video make "$TOPIC" --image-provider gemini   # via Gemini (needs GEMINI_API_KEY)
video make "$TOPIC" --dry-run             # print which steps would run; do not execute
```

`--fake` skips both Edge TTS and AI image generation, so the rendered
video is fully offline — scenes keep their `AnimatedIllustration`
component (caption + animated SVG). Use `--image-provider mock` to
exercise the `ImageBackground` path with placeholders. See the
"Image Providers" section in the README for the full provider
comparison.

Outputs:

```text
projects/$TOPIC/output/preview.mp4           # visual preview
projects/$TOPIC/output/preview-faststart.mp4 # same, faststart metadata
projects/$TOPIC/output/final-mixed.mp4       # narration + BGM + SFX — publishable artifact
projects/$TOPIC/assets/audio/scene_*.wav
projects/$TOPIC/assets/audio-assets/bgm/*.wav
projects/$TOPIC/assets/audio-assets/sfx/*.wav
projects/$TOPIC/captions/<lang>.srt
projects/$TOPIC/qa/render-report.json        # QA report (black frames / audio-sync / captions / …)
projects/$TOPIC/qa/contact-sheet.png         # per-scene contact sheet
```

Not happy? Edit either human-edit file and re-run `video make` — only the
affected steps re-execute.

### 12.5 Optional: YouTube package + thumbnail + Shorts

Publishing metadata is not part of `video make`; invoke separately:

```bash
# YouTube text package — title, description, chapters.vtt, thumbnail prompt, Shorts hook
video youtube "$TOPIC"
# Prefers article.md; falls back to research.md + script.md + storyboard.yaml
# when article.md is absent (back-compat with older projects).
# → projects/$TOPIC/youtube/{title.txt,description.md,chapters.vtt,thumbnail-prompt.txt,shorts-hook.txt}

# Thumbnail — uses mock by default; pass --provider minimax for real AI
video thumbnail "$TOPIC"
# → projects/$TOPIC/youtube/thumbnail.png (1280x720)

# Shorts clip — extracts a vertical 9:16 segment from final-mixed.mp4
video shorts "$TOPIC"
# → projects/$TOPIC/youtube/shorts.mp4
```

`video youtube` no longer requires `research/`, `script/`, and
`storyboard/storyboard.yaml` triple to exist — if `article.md` is present,
it derives the title, hook, sections, and chapter timings from there.

Add `--provider minimax` to both for real AI (needs `MINIMAX_API_KEY` + quota):

```bash
video thumbnail "$TOPIC" --provider minimax
video shorts "$TOPIC"     --provider minimax
```

### 12.6 Inspect what shipped

```bash
ls "projects/$TOPIC/output/"
ls "projects/$TOPIC/assets/audio/"
ls "projects/$TOPIC/assets/audio-assets/"
ls "projects/$TOPIC/captions/"
ls "projects/$TOPIC/runs/"            # one run record per LLM/tool call
```

### 12.7 The canonical end-to-end in one block

A copy-paste-runnable summary (assumes `video` is on PATH and `GLM_API_KEY`
is set; replace with `--fake` if offline):

```bash
TOPIC="ai-thinking"
video new "$TOPIC"
video draft "$TOPIC"                     # writes article.md + audio-config.yaml + derives storyboard.yaml
# (video audio-plan "$TOPIC" is only needed to regenerate audio-config.yaml after hand-editing article.md)

# Human edits (any editor)
$EDITOR "projects/$TOPIC/article.md"
$EDITOR "projects/$TOPIC/audio-config.yaml"
# Want a 1-second pause between every sentence? Add it to audio-config.yaml:
#   echo 'pause_between_sentences_sec: 1' >> "projects/$TOPIC/audio-config.yaml"

video approve storyboard --cwd "projects/$TOPIC" # 🚪 human gate: approve after reading article.md
video make "$TOPIC"                  # → preview.mp4 + final-mixed.mp4 (+ QA report & contact sheet)

# Optional
video scene list "$TOPIC"            # per-scene versions; video scene approve/restore for scene-level rollback
video studio "$TOPIC"                # iterate visuals in Remotion Studio
video youtube "$TOPIC"               # works directly off article.md
video thumbnail "$TOPIC"
video shorts "$TOPIC"
```

The publishable artifact is `projects/$TOPIC/output/final-mixed.mp4`
plus the YouTube package under `projects/$TOPIC/youtube/`.

## 13. Verifying with the acceptance audit

After running the above, `npm run acceptance` performs the §62.4 audit on
the `projects/benchmark-v01/` benchmark (39 s Chinese explainer about AI
chain-of-thought). The audit checks file format, runtime, and provenance
without an AI in the loop.

```bash
npm run acceptance
# Expect: "ALL 11 §62.4 acceptance checks passed"
```

## 14. End-to-end example projects (no LLM, deterministic)

Three complete examples live under `examples/`, exercising every v0.2
capability with no API keys required — copy them and render:

| Example                        | Length | Exercises                                                                                                                                                                      |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `examples/mcp-explainer`       | 45 s   | full pipeline: SvgScene diagram draw-on, explicit `animations[]`, DoodleScene hand-drawn ink, duration sync, scene versioning, the QA report/gate, Excalidraw asset generation |
| `examples/ai-concept`          | 60 s   | hand-drawn canvas + beat-sync (100 BPM grid)                                                                                                                                   |
| `examples/devops-architecture` | 90 s   | diagrams, target-driven camera, cut/fade transitions, timeline choreography, Excalidraw                                                                                        |

Running the MCP Explainer for real (full sequence in its `README.md`):

```bash
pnpm run build
node packages/cli/dist/index.js new mcp-explainer
cp examples/mcp-explainer/storyboard.yaml projects/mcp-explainer/storyboard/
cp examples/mcp-explainer/captions/zh-CN.srt projects/mcp-explainer/captions/
# 9 s silent narration placeholder per scene (or generate real TTS with `video audio`)
for i in 01 02 03 04 05; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 9 projects/mcp-explainer/assets/audio/scene-$i.wav
done
node packages/cli/dist/index.js approve storyboard --cwd projects/mcp-explainer   # 🚪 gate 1
node packages/cli/dist/index.js preview --cwd projects/mcp-explainer              # QA report + contact sheet
node packages/cli/dist/index.js excalidraw mcp-explainer
node packages/cli/dist/index.js qa mcp-explainer
node packages/cli/dist/index.js approve review --cwd projects/mcp-explainer       # 🚪 gate 2
node packages/cli/dist/index.js final --cwd projects/mcp-explainer                # 🚪 gate 3 (QA gate)
```

Each example's `README.md` documents the scenes (component family ×
pipeline feature), and the committed integration tests
(`packages/cli/src/demo-*.test.ts`) run this exact sequence against a
temp project. To see how the new components (`SvgScene` / `DoodleScene`),
timeline animations, and camera moves are written, start from these
three storyboards.
