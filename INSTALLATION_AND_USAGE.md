# AI Video Factory

Installation and usage manual for the current repository.

AI Video Factory turns a structured storyboard into a 1920×1080 MP4. The
workflow is:

```text
Storyboard YAML
    ↓
Validate
    ↓
Compile to VDSL / RenderPlan
    ↓
Remotion + FFmpeg
    ↓
Preview MP4
    ↓
Human review
    ↓
Final MP4
```

The repository also contains optional AI agents for research, script writing,
storyboard generation, review, and YouTube metadata.

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

## 6. Core local workflow

### 6.1 Validate

Validate the storyboard and its assets:

```bash
node packages/cli/dist/index.js validate \
  projects/demo/storyboard/storyboard.yaml \
  --root projects/demo
```

On success, the command exits with code `0`. On failure it reports the file,
line, field, and validation error.

### 6.2 Check status

```bash
node packages/cli/dist/index.js status --cwd projects/demo
```

The status command shows the current stage, checkpoint, and workflow state.

### 6.3 Review the source

Review and edit `storyboard/storyboard.yaml` after validation. The initial
scaffold is in `DRAFT`; the CLI's first approval gate is created after a
successful preview render. Agents and renderers do not publish or make the
final decision automatically.

### 6.4 Render a preview

```bash
node packages/cli/dist/index.js preview --cwd projects/demo
```

This performs validation, compilation, Remotion rendering, and FFmpeg
faststart processing. Outputs:

```text
projects/demo/output/preview.mp4
projects/demo/output/preview-faststart.mp4
```

The preview command moves the project to the `review` stage with status
`WAITING_REVIEW`.

### 6.5 Approve review and render final

```bash
node packages/cli/dist/index.js approve review --cwd projects/demo
node packages/cli/dist/index.js final --cwd projects/demo
```

Final outputs:

```text
projects/demo/output/final.mp4
projects/demo/output/final-faststart.mp4
```

`final` requires the `review` checkpoint to be `APPROVED`. A successful final
render sets the project state to `FINAL_APPROVED`.

## 7. Editing, rejection, rollback, and resume

Edit the storyboard directly with any text editor, then validate and preview
again:

```bash
node packages/cli/dist/index.js validate \
  projects/demo/storyboard/storyboard.yaml --root projects/demo
node packages/cli/dist/index.js preview --cwd projects/demo
```

Reject the current checkpoint with a reason:

```bash
node packages/cli/dist/index.js reject wrong-pacing --cwd projects/demo
```

Typical reason values are `wrong-content`, `wrong-pacing`, `wrong-style`,
`missing-information`, or another short descriptive value.

Rollback requires interactive confirmation:

```bash
node packages/cli/dist/index.js rollback storyboard-v2 --cwd projects/demo
```

Rollback changes the active workflow state and does not delete Git history or
existing output files. Re-run validation and preview after inspecting the
selected checkpoint.

Resume reports the current stage and Git commit so you can continue the
appropriate command after an interruption:

```bash
node packages/cli/dist/index.js resume --cwd projects/demo
```

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

### Research

```bash
node packages/cli/dist/index.js research "AI Agent Memory"
```

Outputs:

```text
projects/ai-agent-memory/research/research.md
projects/ai-agent-memory/research/sources.yaml
projects/ai-agent-memory/research/claims.yaml
```

Useful options:

```bash
vf research "AI Agent Memory" --no-web
vf research "AI Agent Memory" --model glm --lang zh-CN --duration 60 --audience developers
```

Review the generated sources and claims before using them downstream.

### Script

```bash
vf script "AI Agent Memory" \
  --from-research projects/ai-agent-memory/research \
  --duration 60 \
  --lang zh-CN
```

Output:

```text
projects/ai-agent-memory/script/script.zh-CN.md
```

The default script structure is Hook → Problem → Explanation → Example →
Comparison → Implication → Conclusion. The Markdown file can be edited before
it is passed to the storyboard agent.

### Storyboard agent

```bash
vf storyboard "AI Agent Memory" \
  --from-research projects/ai-agent-memory/research \
  --from-script projects/ai-agent-memory/script/script.zh-CN.md \
  --duration 60 \
  --style dark-tech
```

The agent writes `storyboard/storyboard.yaml`. Validate and manually approve
the result before rendering.

### Review agent

```bash
vf review ai-agent-memory
```

This writes:

```text
review/content-review.yaml
review/visual-review.yaml
review/technical-review.yaml
```

The review agent is advisory and read-only. It does not approve, reject, or
modify the project automatically.

### YouTube package

```bash
vf youtube ai-agent-memory
```

This writes title, description, chapters in WebVTT format, a package YAML,
thumbnail prompt, and Shorts hook under `youtube/`. It does not upload to
YouTube or generate the thumbnail/Shorts MP4.

## 9. Voice and subtitles

The audio command requires a storyboard and a generated script:

```bash
vf script "AI Agent Memory"
vf audio ai-agent-memory
```

The default provider is Edge TTS and does not require an API key. It uses an
online Microsoft Edge TTS endpoint, so it requires network access and may be
rate-limited or unavailable offline. It is not an offline engine.

For offline tests:

```bash
vf audio ai-agent-memory --fake
```

Outputs:

```text
projects/ai-agent-memory/assets/audio/scene-01.wav
projects/ai-agent-memory/captions/zh-CN.srt
```

The command maps script sections to scenes and generates one WAV per scene.
To include the generated audio in the preview, ensure the corresponding scene
has an audio path:

```yaml
narration:
  text: "Scene narration"
  audio: assets/audio/scene-01.wav
```

The audio path is resolved relative to the project root.

Although Edge TTS has no direct API charge, commercial redistribution and
long-term production use should be checked against the service terms. Use the
TTS provider interface to replace it when a formally licensed production
provider is required.

## 10. Project artifacts and provenance

Important files:

```text
project.yaml                 project metadata
storyboard/storyboard.yaml   human-editable source
vdsl/vdsl.yaml               normalized compiled VDSL
state.yaml                   active workflow state
checkpoints/                 approval and invalidation records
runs/<run-id>.yaml           execution and provenance records
assets/                      audio, images, screenshots, and fonts
output/                      preview and final MP4 files
```

Run records include the stage, tool, input/output files, Git commit when
available, timestamp, status, and—in AI runs—provider, model, token usage,
prompt hash, and estimated cost.

Keep API keys outside the project tree. Do not commit `.env` files, raw
credentials, or private source material.

## 11. Troubleshooting

### `ffmpeg: command not found` or `ffprobe: command not found`

Install FFmpeg and confirm it is on `PATH`:

```bash
which ffmpeg
which ffprobe
```

### `Cannot find module .../dist/index.js`

Build the workspace:

```bash
npm run build
```

### `MINIMAX_API_KEY not set` or `GLM_API_KEY not set`

Export the required key in the same shell that runs the command. The AI
commands cannot run without a provider key.

### Validation reports a missing asset

Paths such as `assets/audio/scene-01.wav` are relative to the project root,
not the directory containing the YAML file. Check the path and run:

```bash
vf validate projects/demo/storyboard/storyboard.yaml --root projects/demo
```

### `final` says review is not approved

Run:

```bash
vf status --cwd projects/demo
vf approve review --cwd projects/demo
```

Then retry `vf final --cwd projects/demo`.

### Edge TTS fails

Check network access, retry later, or use a prepared/local audio file. For
offline CI use:

```bash
vf audio <project> --fake
```

### Remotion cannot find a port

Another process or the execution environment may prevent local port binding.
Stop stale render processes, retry with a clean shell, and verify that local
loopback sockets are permitted.

## 12. Step-by-step: create a video from a topic

This is the canonical end-to-end walkthrough. Every command runs locally;
no cloud account is required unless you opt into the AI provider flags.

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
# Pick a topic slug (the project directory will be projects/<slug>/).
TOPIC="ai-thinking"
bin/video new "$TOPIC"
# Creates:
#   projects/<slug>/project.yaml
#   projects/<slug>/storyboard/storyboard.yaml    (template — 2 scenes)
#   projects/<slug>/script/script.zh-CN.md        (template)
#   projects/<slug>/state.yaml
#   projects/<slug>/runs/, checkpoints/, output/, assets/, etc.
```

### 12.3 AI-driven path (recommended): research → script → storyboard

Requires `MINIMAX_API_KEY` and/or `GLM_API_KEY` in your environment.

```bash
# 1. Research — produces research/{research.md, sources.yaml, claims.yaml}
bin/video research "$TOPIC"

# 2. Script — produces script/script.zh-CN.md (7-section spine)
bin/video script "$TOPIC" --from-research "projects/$TOPIC/research"

# 3. Storyboard — produces storyboard/storyboard.yaml (VDSL format)
bin/video storyboard "$TOPIC" \
  --from-research "projects/$TOPIC/research" \
  --from-script    "projects/$TOPIC/script/script.zh-CN.md"
```

If you don't have API keys set, skip steps 1–3 and write `storyboard.yaml`
by hand using the format in section 5.

### 12.4 Voice and audio assets

```bash
# 4. TTS per scene — produces assets/audio/scene-NN.wav
bin/video audio "$TOPIC"           # uses Edge TTS (free, no key needed)
                                  # pass --fake to skip Edge TTS and write silent WAVs

# 5. Background music + sound effects — produces assets/audio-assets/
bin/video audio-asset "$TOPIC" --bgm calm --sfx whoosh
# Writes a deterministic silent WAV per tag (mock provider).
# For real music/SFX, drop files into projects/$TOPIC/assets/audio-assets/
# matching the tag name and re-run with --bgm-dir/--sfx-dir.

# 6. (optional) Tell the mixer what SFX cues trigger on which scene and
#    how long the BGM fades. Create projects/$TOPIC/audio-assets/mix.yaml:
cat > "projects/$TOPIC/audio-assets/mix.yaml" <<'YAML'
bgm: calm
sfx:
  scene_2: whoosh
bgm_fade_in_sec: 1.5
bgm_fade_out_sec: 2
YAML
```

### 12.5 Render and ship

```bash
# 7. Review — generates review/{content-review,visual-review,technical-review}.yaml
bin/video review "$TOPIC"

# 8. Preview — renders output/preview-faststart.mp4 (silent or TTS audio)
bin/video preview

# 9. Approve review (human gate — the AI never approves itself)
bin/video approve review

# 10. Final + audio mix — produces output/final-mixed.mp4 (narration + BGM + SFX)
bin/video final --mix
```

The published artifact at this point is `projects/$TOPIC/output/final-mixed.mp4`.

### 12.6 Publishing package + thumbnails + Shorts

```bash
# 11. YouTube package — title, description, chapters.vtt, thumbnail prompt,
#     shorts hook. Produces files under projects/$TOPIC/youtube/.
bin/video youtube "$TOPIC"

# 12. Thumbnail — uses mock by default; pass --provider minimax for real AI
bin/video thumbnail "$TOPIC"
# → projects/$TOPIC/youtube/thumbnail.png (1280x720)

# 13. Shorts clip — extracts a vertical 9:16 segment from final-faststart.mp4
bin/video shorts "$TOPIC"
# → projects/$TOPIC/youtube/shorts.mp4

# Add --provider minimax to both for real AI (needs MINIMAX_API_KEY + quota):
#   bin/video thumbnail "$TOPIC" --provider minimax
#   bin/video shorts "$TOPIC"     --provider minimax
```

### 12.7 Inspect what shipped

```bash
bin/video status                  # per-stage checklist + current checkpoint
ls "projects/$TOPIC/output/"
ls "projects/$TOPIC/youtube/"
ls "projects/$TOPIC/runs/"         # one run record per agent invocation
```

### 12.8 The canonical end-to-end in one block

A copy-paste-runnable summary (assumes `bin/video` is on PATH and you have
the API keys for steps 3–5; otherwise replace those with hand-written
content):

```bash
TOPIC="ai-thinking"
bin/video new "$TOPIC"
bin/video research "$TOPIC"
bin/video script "$TOPIC" --from-research "projects/$TOPIC/research"
bin/video storyboard "$TOPIC" \
  --from-research "projects/$TOPIC/research" \
  --from-script    "projects/$TOPIC/script/script.zh-CN.md"
bin/video audio "$TOPIC"
bin/video audio-asset "$TOPIC" --bgm calm --sfx whoosh
cat > "projects/$TOPIC/audio-assets/mix.yaml" <<'YAML'
bgm: calm
sfx:
  scene_2: whoosh
bgm_fade_in_sec: 1.5
bgm_fade_out_sec: 2
YAML
bin/video review "$TOPIC"
bin/video preview
bin/video approve review
bin/video final --mix
bin/video youtube "$TOPIC"
bin/video thumbnail "$TOPIC"
bin/video shorts "$TOPIC"
```

The output is `projects/$TOPIC/output/final-mixed.mp4` plus a YouTube
publishing package under `projects/$TOPIC/youtube/`.

## 13. Verifying with the acceptance audit

After running the above, `npm run acceptance` performs the §62.4 audit on
the `projects/benchmark-v01/` benchmark (39 s Chinese explainer about AI
chain-of-thought). The audit checks file format, runtime, and provenance
without an AI in the loop.

```bash
npm run acceptance
# Expect: "ALL 11 §62.4 acceptance checks passed"
```

