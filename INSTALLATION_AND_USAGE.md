# AI Video Factory

Installation and usage manual for the current repository.

## Overview

As of v0.4, AI Video Factory exposes only **three commands** — two LLM
drafts of files humans edit, and one command that does the rest:

```text
topic  ──►  vf draft  ──►  article.md  ──┐
                                         │  human edits
                              ◄── vf audio-plan
                                         │
                                         ▼
                                       vf make  ──►  preview.mp4
                                                  ►  final-mixed.mp4
```

The two human-edit files are **`article.md`** (narrative + a Scenes YAML
block) and **`audio-config.yaml`** (voice / bgm / sfx / fades). Everything
else is derived; `vf make` is idempotent — it skips a step when its
output is newer than its inputs (`--dry-run` shows what it would do).

Legacy multi-stage commands (`vf research` / `vf script` / `vf storyboard`
/ `vf audio` / `vf approve` / `vf reject` / `vf rollback` etc.) remain
working but are **not recommended for new projects**; see §8 and §12.8.

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
ppnpm run build
```

The build compiles all workspace packages into `packages/*/dist`.

The CLI is currently invoked through the compiled entry point:

```bash
node packages/cli/dist/index.js --help
```

For a shorter command in the current shell, define:

```bash
alias vf='node packages/cli/dist/index.js'
```

The repository also provides a wrapper for agentic shells and automation:

```bash
bin/video --help
```

### Global installation

After the `@vf/*` packages have been published, install the CLI globally:

```bash
npm install --global @vf/cli
vf --help
```

The global package contains the CLI and runtime dependencies. It does not
create files in its installation directory. Projects are created in the
current working directory, or below the directory passed with `--cwd`:

```bash
mkdir my-video-projects
cd my-video-projects
vf new demo
```

For local development, link the workspace CLI instead of publishing it:

```bash
npm run build
npm link --workspace @vf/cli
vf --help
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
ppnpm run format:check
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

## 5. Minimal storyboard format

The current VDSL schema is `0.1`. Durations are seconds; the renderer converts
them to frames using the project FPS.

```yaml
schema_version: "0.1"

project:
  id: demo
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

style:
  theme: dark-tech

scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
    visual:
      component: Title
      props:
        text: "AI Agent 为什么需要 Memory？"
    animation:
      entrance: fade
      emphasis: none
      exit: none
    captions:
      source: narration
    transition:
      in: fade
      out: cut
```

Important rules:

- `schema_version` must be `"0.1"`.
- Scene IDs must be unique.
- Each scene needs a positive `duration` and a registered visual component.
- Unknown fields are rejected.
- Referenced assets must exist under the project root.
- Supported languages are `zh-CN` and `en-US`.

The current component registry includes `Title`, `Paragraph`, `Image`,
`CodeBlock`, `Terminal`, `Callout`, `FlowChart`, `Timeline`, `Comparison`,
and `EndCard`.

## 6. Core local workflow (v0.4 recommended)

The new local flow is collapsed to a single `vf make` command.

### 6.1 One-time prep: `article.md` + `audio-config.yaml`

```bash
vf new my-topic
vf draft "my-topic"           # → projects/<slug>/article.md
                            #   also refreshes storyboard.yaml (VDSL, derived from article.md)
vf audio-plan my-topic        # → projects/<slug>/audio-config.yaml

# Then human edits:
$EDITOR projects/<slug>/article.md
$EDITOR projects/<slug>/audio-config.yaml
```

### 6.2 Render with one command: `vf make`

```bash
vf make my-topic              # TTS → audio assets → render → mix
vf make my-topic --fake       # offline: write silent placeholder WAVs (no Edge TTS)
vf make my-topic --dry-run    # print what would run, do not execute
```

Outputs:

```text
projects/<slug>/output/preview.mp4           # visual preview
projects/<slug>/output/preview-faststart.mp4 # same, faststart metadata
projects/<slug>/output/final-mixed.mp4       # narration + BGM + SFX — the publishable artifact
projects/<slug>/assets/audio/scene_*.wav
projects/<slug>/assets/audio-assets/{bgm,sfx}/*.wav
projects/<slug>/captions/<lang>.srt
```

### 6.3 Re-run after editing

`vf make` is **idempotent** — outputs newer than inputs are skipped. So
when you edit either human-edit file and re-run, only the affected step
re-executes:

```bash
# You changed only audio-config.yaml's BGM tag
vf make my-topic
# → skips already-fresh TTS + preview; re-runs audio-assets + mix
```

### 6.4 Validate the lower-level format (optional)

```bash
node packages/cli/dist/index.js validate \
  projects/<slug>/storyboard/storyboard.yaml \
  --root projects/<slug>
```

Reports file / line / field / reason on errors.

### 6.5 Legacy core workflow (preserved as back-compat path)

For old projects still using the multi-stage pipeline:

```bash
vf preview --cwd projects/<slug>   # render preview.mp4
vf final   --cwd projects/<slug>   # render final.mp4 (requires review APPROVED)
```

See §12.8 for the full legacy flow. New projects should not need §6.5.

## 7. Editing, iteration, and recovery

The new flow no longer needs `approve` / `reject` / `rollback` — **edit
the file, re-run `vf make`**:

```bash
# Tweaked a narrative section in article.md
$EDITOR projects/<slug>/article.md
vf make <slug>          # only TTS + render + mix re-execute (rest is skipped)

# Tweaked audio-config.yaml
$EDITOR projects/<slug>/audio-config.yaml
vf make <slug>          # only audio-assets + mix re-execute

# Want a specific scene to use a different component (e.g. Image instead of Paragraph)
$EDITOR projects/<slug>/storyboard.yaml
vf make <slug>          # only render + mix re-execute
```

`vf make` does not produce a review checkpoint — its output,
`final-mixed.mp4`, is the publishable artifact.

### About hand-editing `storyboard.yaml`

`storyboard.yaml` is derived from `article.md` and gets refreshed on
every `vf draft` run. Additionally, `vf make` rewrites each scene's
`duration:` field after TTS to match the actual measured audio length —
without this, the renderer would use the article's planned duration and
freeze on a still frame when audio plays past it.

If you hand-edit `storyboard.yaml` (e.g. swap to the `Image` component
or tweak `props`):

- Per-scene `duration:` and other `vf draft`-derived fields get
  overwritten on the next `vf draft`.
- The per-scene `duration:` also gets overwritten on the next `vf make`
  (since it re-measures audio).
- Everything else (component choice, props, subtext, etc.) survives
  the next `vf make` because `syncStoryboardDurations` only touches the
  `duration:` line.

The supported flows are:

- Editorial tweaks → edit `article.md`, then `vf draft` regenerates
  storyboard.yaml cleanly.
- Pixel-level art direction → hand-edit `storyboard.yaml`, then run
  `vf make` directly. **Don't** re-run `vf draft` until you're ready
  to lose those tweaks.

### 7.1 Legacy workflow commands (still available, back-compat only)

```bash
vf status   --cwd projects/<slug>             # stage + checkpoint summary
vf reject   wrong-pacing --cwd projects/<slug>
vf rollback storyboard-v2 --cwd projects/<slug>   # interactive confirmation
vf resume   --cwd projects/<slug>             # stage + git commit
```

`vf rollback` does not delete Git history or existing outputs. After a
rollback, re-run `vf validate` + `vf preview` (or simply `vf make`).

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
review:
  primary: glm
  fallback: minimax
```

To use a custom routing file:

```bash
export LL_CONFIG="$PWD/llm.config.yaml"
```

### v0.4 recommended: `vf draft` + `vf audio-plan`

The new AI workflow collapses to two commands producing the two human-edit
files:

```bash
# 1. Write article.md (consolidated narrative + Scenes YAML block)
vf draft "AI Agent Memory"
vf draft "AI Agent Memory" --no-web
vf draft "AI Agent Memory" --model glm --lang zh-CN --duration 60 --audience developers
vf draft "AI Agent Memory" --from outline.md   # revise an existing outline

# 2. Write audio-config.yaml from the parsed article
vf audio-plan ai-agent-memory
```

Outputs:

```text
projects/<slug>/article.md           # human edits: narrative + Scenes YAML
projects/<slug>/audio-config.yaml    # human edits: voice / bgm / sfx / fades
```

After human edits to these two files, `vf make <slug>` produces the
publishable mp4 in a single command.

### Legacy AI agents (still available, for old projects only)

If your project is already using the old multi-stage format, the commands
below still work — but **new projects should use `vf draft` +
`vf audio-plan`** instead.

| Old command                 | Output                                                   | Replaced by           |
| --------------------------- | -------------------------------------------------------- | --------------------- |
| `vf research`               | `research/{research.md,sources.yaml,claims.yaml}`        | `vf draft`            |
| `vf script`                 | `script/script.<lang>.md`                                | `vf draft`            |
| `vf storyboard`             | `storyboard/storyboard.yaml`                             | `vf draft` (in scope) |
| `vf review`                 | `review/{content,visual,technical}-review.yaml`          | removed — humans ARE the reviewer |

Reference flags for the legacy commands:

```bash
# Research — web search optional; model optional; duration up to 60s
vf research "AI Agent Memory" --no-web --model glm --duration 60 --lang zh-CN --audience developers

# Script — default spine Hook → Problem → Explanation → Example → Comparison → Implication → Conclusion
vf script "AI Agent Memory" \
  --from-research projects/<slug>/research \
  --duration 60 --lang zh-CN

# Storyboard — human must review the YAML before rendering
vf storyboard "AI Agent Memory" \
  --from-research projects/<slug>/research \
  --from-script    projects/<slug>/script/script.zh-CN.md \
  --duration 60 --style dark-tech

# Review — read-only, does not modify the project
vf review <slug>
```

### YouTube package

Not part of `vf make`; invoke separately when needed:

```bash
vf youtube <slug>
```

Writes title, description, WebVTT chapters, package YAML, thumbnail
prompt, and Shorts hook under `youtube/`. Does **not** upload to YouTube
nor generate the thumbnail / Shorts MP4 (those come from `vf thumbnail`
and `vf shorts` — see §12.5).

## 9. Voice, subtitles, and audio (v0.4)

### 9.1 Recommended: subsumed into `vf make`

As of v0.4, TTS, BGM/SFX assets, mixing, and SRT subtitles are all
produced by `vf make` in one invocation — no need for separate `vf audio`,
`vf audio-asset`, or `vf mix` calls:

```bash
vf make <slug>           # real Edge TTS (requires network)
vf make <slug> --fake    # silent placeholder WAVs (offline / CI-friendly)
```

Default provider is Edge TTS (free, no API key). It depends on the
online Microsoft Edge TTS endpoint — rate limits and network failures
apply.

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
pause_between_sentences_sec: 1     # 1-second pause after every sentence
sfx: {}
```

- Range `0–5` seconds; `0` disables.
- Implementation: `vf make` wraps the text in `<speak>...</speak>`
  SSML with `<break time="Nms"/>` after each `.`, `!`, `?`, `。`, `！`,
  `？`. Edge TTS treats each `break` as literal silence in the audio.
- Typical values: `0.5–1.0` sec. `vf audio-plan` defaults to `0`;
  if a scene has 2+ sentences and you want clearer pacing, bump it up.
- Editing only this field and re-running `vf make` re-executes just the
  TTS step; mix/preview outputs are skipped because nothing they
  depend on changed.

### 9.3 Edge TTS caveats

Edge TTS has no direct API charge, but commercial redistribution and
long-term production use should be checked against the service terms. To
replace with a formally licensed provider (MiniMax TTS, ElevenLabs,
etc.), implement the `TTSProvider` interface in `@vf/tts` and pass it to
`vf make` (CLI integration in a follow-up).

### 9.4 Legacy `vf audio` command (still available)

The old `vf audio <slug>` reads `storyboard/storyboard.yaml`'s
`narration.text` and writes WAVs + a captions SRT. `vf make` runs the
same logic internally against `article.md` instead. Use the legacy
command only if you have a pre-existing storyboard without an article.

## 10. Project artifacts and provenance

### v0.4 recommended layout

```text
projects/<slug>/
├── project.yaml                     project metadata
├── article.md                       ⭐ human edits: narrative + Scenes YAML (vf draft writes)
├── audio-config.yaml                ⭐ human edits: voice / bgm / sfx / fades (vf audio-plan writes)
├── storyboard/storyboard.yaml       derived by vf draft from article.md; per-scene duration is re-measured after TTS by vf make (hand edits to other fields survive; durations get overwritten on the next make)
├── vdsl/vdsl.yaml                   normalized compiled VDSL
├── state.yaml                       state (legacy workflow; new flow can ignore)
├── checkpoints/                     audit trail from the legacy workflow
├── runs/<run-id>.yaml               per-LLM/tool-call run records
├── assets/
│   ├── audio/scene_*.wav           per-scene TTS (vf make writes)
│   └── audio-assets/{bgm,sfx}/     BGM/SFX assets (vf make writes)
├── captions/<lang>.srt              subtitles (vf make writes)
└── output/
    ├── preview.mp4                  vf make writes
    ├── preview-faststart.mp4        vf make writes
    └── final-mixed.mp4              ⭐ publishable artifact (vf make writes)
```

`⭐` marks the two human-edit files; everything else is derived.

`storyboard.yaml` is **derived from `article.md`** (every `vf draft`
run refreshes it from the parsed article). The first scene maps to
the `Title` component; the rest map to `Paragraph`; `caption` becomes
on-screen text. If you want pixel-level visual control (swap to
`Image`, tweak props), hand-edit `storyboard.yaml` and run `vf make`
— but the next `vf draft` **overwrites** your edits. If hand-edits
matter, run `vf make` directly without re-drafting.

### Run record fields

`runs/<run-id>.yaml` entries carry `provider`, `model`, `tokens`
(`{input, output}`), `prompt_hash`, `estimated_cost_usd`,
`input_files`, `output_files` references, and an ISO timestamp.

**Never** commit API keys, `.env`, private source material, tokens, or
cookies.

### Validation reports a missing asset

Paths such as `assets/audio/scene_01.wav` are relative to the project
root, not the directory containing the YAML file. Check the path and run:

```bash
vf validate projects/demo/storyboard/storyboard.yaml --root projects/demo
```

### `vf make` complains about missing files

`vf make` needs both `article.md` and `audio-config.yaml` at
`projects/<slug>/`. The error surfaces a hint for each missing file:

```text
article.md not found at .../article.md
# hint: run `vf draft <topic>` first

audio-config.yaml not found at .../audio-config.yaml
# hint: run `vf draft <topic>` first   # (yes, both files come out of vf draft + vf audio-plan together)
```

Run `vf draft <topic>` and `vf audio-plan <topic>` first, then re-run
`vf make`.

### Edge TTS fails

Check network access, retry later, or fall back to offline mode:

```bash
vf make <project> --fake
```

### Legacy `final` says review is not approved

If you still have old code paths hitting `vf final` directly:

```bash
vf status --cwd projects/demo
vf approve review --cwd projects/demo
```

Then retry `vf final --cwd projects/demo`. New code should not hit this
— `vf make` does not require an approve step.

### Remotion cannot find a port

Another process or the execution environment may prevent local port binding.
Stop stale render processes, retry with a clean shell, and verify that local
loopback sockets are permitted.

## 12. Step-by-step: create a video from a topic

### 12.0 Recommended: 3-command minimal API (v0.4+)

The entire pipeline is **3 commands + 2 human-edit files + 1 rendered
output**:

1. `vf draft <topic>` → writes `article.md` (LLM consolidates research + script + storyboard)
2. `vf audio-plan <project>` → writes `audio-config.yaml` (LLM produces voice / BGM / SFX suggestion based on the article)
3. `vf make <project>` → everything else: TTS → audio assets → render → mix → mp4

```
┌────────────────────────────────────────────────────────────────┐
│  topic  ──►  vf draft  ──►  article.md  ──┐                   │
│                                          │  human edits      │
│                                          ▼                   │
│                                 audio-config.yaml ◄─ vf audio-plan
│                                          │                   │
│                                          ▼                   │
│                                        vf make  ──►  preview.mp4
│                                                 ►  final-mixed.mp4
└────────────────────────────────────────────────────────────────┘
```

`vf make` is **idempotent** — outputs newer than inputs are skipped. Use
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
vf new "$TOPIC"
# Creates projects/<slug>/ with:
#   project.yaml
#   storyboard/storyboard.yaml    (template — 2 scenes, used by vf make rendering)
#   state.yaml
#   runs/, checkpoints/, output/, assets/, etc.
```

### 12.3 Two LLM commands (the recommended path)

Requires `GLM_API_KEY` (default) or `MINIMAX_API_KEY` in the environment.

```bash
# 1. Draft — writes article.md (combines research + script + storyboard in one)
#    Output: projects/<slug>/article.md
#      - YAML frontmatter (project / language / duration_target_sec / voice)
#      - # <title> + > **Hook**
#      - ## <n>. <Section> + <body> paragraphs (human-editable)
#      - ## Scenes  fenced YAML block (drives downstream tools)
#    Also derives storyboard.yaml (VDSL): first scene → Title, rest → Paragraph,
#    `caption` becomes on-screen text. `vf make` renders this file, so the
#    video length stays in sync with the audio automatically.
vf draft "$TOPIC"                  # default: enable MiniMax web search
vf draft "$TOPIC" --no-web          # disable web, model knowledge only
vf draft "$TOPIC" --model glm --duration 40 --lang zh-CN --audience developers
vf draft "$TOPIC" --from outline.md  # revise an existing outline
```

```bash
# 2. Audio-plan — reads article.md's scenes, writes audio-config.yaml
#    One file holds all audio knobs (voice / bgm tag / sfx cues / fades)
vf audio-plan "$TOPIC"
```

Then human edits the two files:

```bash
$EDITOR "projects/$TOPIC/article.md"          # narrative, scene tweaks, durations
$EDITOR "projects/$TOPIC/audio-config.yaml"   # BGM tag, SFX cues, fades
```

### 12.4 Render with one command

```bash
vf make "$TOPIC"                       # TTS → audio assets → render → mix (real Edge TTS)
vf make "$TOPIC" --fake                # FakeTTSProvider (no network; silent placeholder WAVs)
vf make "$TOPIC" --dry-run             # print which steps would run; do not execute
```

Outputs:

```text
projects/$TOPIC/output/preview.mp4           # visual preview
projects/$TOPIC/output/preview-faststart.mp4 # same, faststart metadata
projects/$TOPIC/output/final-mixed.mp4       # narration + BGM + SFX — publishable artifact
projects/$TOPIC/assets/audio/scene_*.wav
projects/$TOPIC/assets/audio-assets/bgm/*.wav
projects/$TOPIC/assets/audio-assets/sfx/*.wav
projects/$TOPIC/captions/<lang>.srt
```

Not happy? Edit either human-edit file and re-run `vf make` — only the
affected steps re-execute.

### 12.5 Optional: YouTube package + thumbnail + Shorts

Publishing metadata is not part of `vf make`; invoke separately:

```bash
# YouTube text package — title, description, chapters.vtt, thumbnail prompt, Shorts hook
vf youtube "$TOPIC"
# Prefers article.md (the new minimal artifact); falls back to legacy
# research.md + script.md + storyboard.yaml for old projects.
# → projects/$TOPIC/youtube/{title.txt,description.md,chapters.vtt,thumbnail-prompt.txt,shorts-hook.txt}

# Thumbnail — uses mock by default; pass --provider minimax for real AI
vf thumbnail "$TOPIC"
# → projects/$TOPIC/youtube/thumbnail.png (1280x720)

# Shorts clip — extracts a vertical 9:16 segment from final-mixed.mp4
vf shorts "$TOPIC"
# → projects/$TOPIC/youtube/shorts.mp4
```

`vf youtube` no longer requires the legacy `research/`, `script/`, and
`storyboard/storyboard.yaml` triple to exist — if `article.md` is present,
it derives the title, hook, sections, and chapter timings from there.

Add `--provider minimax` to both for real AI (needs `MINIMAX_API_KEY` + quota):

```bash
vf thumbnail "$TOPIC" --provider minimax
vf shorts "$TOPIC"     --provider minimax
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

A copy-paste-runnable summary (assumes `vf` is on PATH and `GLM_API_KEY`
is set; replace with `--fake` if offline):

```bash
TOPIC="ai-thinking"
vf new "$TOPIC"
vf draft "$TOPIC"                     # writes article.md + derives storyboard.yaml
vf audio-plan "$TOPIC"

# Human edits (any editor)
$EDITOR "projects/$TOPIC/article.md"
$EDITOR "projects/$TOPIC/audio-config.yaml"
# Want a 1-second pause between every sentence? Add it to audio-config.yaml:
#   echo 'pause_between_sentences_sec: 1' >> "projects/$TOPIC/audio-config.yaml"

vf make "$TOPIC"                  # → preview.mp4 + final-mixed.mp4

# Optional
vf youtube "$TOPIC"               # works directly off article.md
vf thumbnail "$TOPIC"
vf shorts "$TOPIC"
```

The publishable artifact is `projects/$TOPIC/output/final-mixed.mp4`
plus the YouTube package under `projects/$TOPIC/youtube/`.

### 12.8 Legacy multi-command pipeline (preserved as back-compat)

The old per-stage commands (`vf research` / `vf script` / `vf storyboard`
/ `vf audio` / `vf audio-asset` / `vf mix` / `vf review` / `vf approve`
/ `vf reject` / `vf rollback` / `vf preview` / `vf final`) still work —
new projects **should not use them**. The new `vf draft` + `vf
audio-plan` + `vf make` subsume them:

| Old command                                       | New replacement                                                 |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `vf research` / `vf script` / `vf storyboard`      | `vf draft` (one output = `article.md`)                          |
| `vf audio`                                         | subsumed by `vf make`                                           |
| `vf audio-asset`                                   | subsumed by `vf make`                                           |
| `vf mix`                                           | subsumed by `vf make`                                           |
| `vf preview` + `vf final`                          | unified into `vf make`                                          |
| `vf approve` / `vf reject` / `vf rollback`         | not needed — edit `article.md` / `audio-config.yaml` and re-run `vf make` |

If your project is already on the old format (`research/`, `script/`,
`storyboard.yaml`), it continues to work; an optional `vf migrate <project>`
helper to consolidate them into `article.md` can ship in a follow-up.

## 13. Verifying with the acceptance audit

After running the above, `npm run acceptance` performs the §62.4 audit on
the `projects/benchmark-v01/` benchmark (39 s Chinese explainer about AI
chain-of-thought). The audit checks file format, runtime, and provenance
without an AI in the loop.

```bash
npm run acceptance
# Expect: "ALL 11 §62.4 acceptance checks passed"
```
