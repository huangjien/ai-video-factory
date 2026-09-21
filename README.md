# AI Video Factory (v0.1)

A small video factory that turns a hand-written outline file into a finished
1080p Chinese MP4 — with pause-points where you review, approve, reject,
or rewind to any earlier step, and a 39-second explainer video about AI
chain-of-thought built with it as proof it all works.

## Principles

> AI generates · Human decides · Code renders · Git remembers — `AI_Video_Factory_Design_and_Plan_v1.1.md` §65.

No AI writing/research agents, no text-to-speech in the pipeline, no English
variant, no YouTube publishing, no cloud or AI-generated imagery — those are
deliberately later phases (v0.2+).

## Stack

- npm-workspaces TypeScript monorepo (strict mode)
- Remotion 4 (bundler-flavored composition) + FFmpeg encode
- VDSL (Video Description Language) as the schema layer between storyboard and render
- Vitest for tests; Playwright-style render tests via ffprobe

## Quickstart

```bash
# One-time setup (Node 22+, pnpm 12.5+, macOS)
brew install ffmpeg          # required by §4
npm install -g pnpm@12.5.1   # or use corepack: corepack enable pnpm
pnpm install                  # workspace deps

# Scaffold a project
node packages/cli/dist/index.js new demo

# Edit the storyboard, then render
node packages/cli/dist/index.js validate projects/demo/storyboard/storyboard.yaml --root projects/demo
node packages/cli/dist/index.js preview --cwd projects/demo

# Approve review, render final
node packages/cli/dist/index.js approve review --cwd projects/demo
node packages/cli/dist/index.js final --cwd projects/demo
```

The `preview` output lands at `output/preview-faststart.mp4` and `final`
produces `output/final-faststart.mp4`, each 1920x1080@30fps. Every step
writes a YAML record to `runs/<run-id>.yaml` and updates `state.yaml`.

### Global CLI installation

Once the `@vf/*` workspace packages are published:

```bash
npm install --global @vf/cli
vf new demo
```

The global install keeps source and build files out of the user's project
folders. `vf new <id>` creates `projects/<id>` below the current directory;
use `--cwd <dir>` to choose another project root.

## Commands

| Command | Purpose |
| --- | --- |
| `vf new <id>` | scaffold a project under `projects/<id>/` |
| `vf research <topic>` | (v0.2.2) AI-gather facts + sources + claims via MiniMax/GLM (+ optional web search) |
| `vf script <topic>` | (v0.2.3) AI-draft a 7-section script (Hook→Conclusion) via MiniMax/GLM (optionally consumes `vf research` via `--from-research`) |
| `vf audio <project>` | (v0.2.4) Synthesize per-scene voiceover via Edge TTS + write `captions/<lang>.srt` (`--fake` for offline test) |
| `vf review <project>` | (v0.2.5) Generate Content/Visual/Technical review YAMLs via MiniMax/GLM (read-only — never auto-gates) |
| `vf youtube <project>` | (v0.2.7) Generate YouTube title/description/chapters.vtt/package.yaml + thumbnail-prompt + shorts-hook (text-only; thumbnail/shorts land in v0.2 phase 8) |
| `vf thumbnail <project>` | (v0.2.8) Generate YouTube thumbnail PNG from `thumbnail-prompt.txt` (MockImageProvider; real provider deferred to v0.3) |
| `vf shorts <project>` | (v0.2.8) Clip a 9:16 vertical Shorts MP4 from `final-faststart.mp4` via ffmpeg (60s default, configurable via `--start`/`--duration`) |
| `vf audio-asset <project>` | (v0.3.3) Add BGM + SFX to the project (`--bgm <tag>` + `--sfx <tag>`, optional `--bgm-dir`/`--sfx-dir` for file-based lookup) |
| `vf mix <project>` | (v0.3.4) Mix per-scene narration + BGM into `output/final-mixed.mp4` (ffmpeg amix + sidechaincompress; configurable `--bgm`/`--bgm-attenuation`) |
| `vf final <project> --mix` | (v0.3.5) Same as `vf final` but also runs `vf mix` to produce the audio-mixed published artifact |
| `vf storyboard <topic>` | (v0.2) AI-draft a storyboard from a topic via MiniMax/GLM (optionally consumes `vf research` via `--from-research`) |
| `vf validate <file>` | shape + asset + registry + audio/caption check |
| `vf status` | per-stage checklist + current checkpoint + status |
| `vf approve [stage]` | human approve; advances state machine |
| `vf reject <reason>` | record feedback, transition to regenerate |
| `vf rollback <checkpoint-id>` | confirm + invalidate downstream stages |
| `vf resume` | resume from last successful stage |
| `vf preview` | validate → compile → render → faststart preview.mp4 |
| `vf final` | render final.mp4 (requires review APPROVED) |

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm test` | unit + integration tests + coverage (vitest) |
| `pnpm run build` | `tsc -b` across all packages |
| `pnpm run lint` | ESLint flat config |
| `npm run format` | Prettier |
| `npm run benchmark:verify` | render the benchmark twice and assert structural identity (§62.4) |
| `pnpm run acceptance` | full §62.4 audit (functional + video + engineering) |

## Architecture map

See `ARCHITECTURE.md` — maps each design-doc section to the package and
file that implements it, plus the v0.2+ roadmap.









## Advanced Media (v0.2.8 — final phase)

`vf thumbnail` and `vf shorts` complete the YouTube publishing package by
generating the thumbnail image and a Shorts MP4 clip. Per doc §60 this is
the last phase of v0.2.

### Thumbnail — `vf thumbnail <project>`
```bash
node packages/cli/dist/index.js youtube "AI 思维链"   # produces thumbnail-prompt.txt
node packages/cli/dist/index.js thumbnail "AI 思维链"  # mock (default, offline)
node packages/cli/dist/index.js thumbnail "AI 思维链" --provider minimax  # REAL AI image
```
**v0.3 phase 1** adds the **MiniMaxImageProvider** (`image-01` model):
real AI-generated thumbnails via `POST /v1/image_generation`, base64
response, aspect-ratio mapping (1280x720 → `16:9`). Needs
`MINIMAX_API_KEY` and image quota on your MiniMax plan — quota/auth
failures are surfaced readably (envelope status 2056 etc.). Output is
`thumbnail.jpg` (JPEG) for the real provider, `thumbnail.png` for the mock.
The **MockImageProvider** stays the default — deterministic, offline,
hash-derived solid color.

### Shorts clip — `vf shorts <project>`
```bash
node packages/cli/dist/index.js final    # produces output/final-faststart.mp4
node packages/cli/dist/index.js shorts "AI 思维链"      # mock (default, mechanical ffmpeg)
node packages/cli/dist/index.js shorts "AI 思维链" --provider minimax  # REAL AI video
```
**v0.3 phase 2** adds the **MiniMaxVideoProvider** (`MiniMax-Hailuo-2.3`,
image-to-video). The minimax path:
- Reads `youtube/thumbnail.{png,jpg}` as the first-frame image (base64)
- Reads `youtube/shorts-hook.txt` as the prompt
- Calls `POST /v1/video_generation`, polls `GET /v1/query/video_generation`
  until `status=Success`, downloads from `/v1/files/{file_id}`
- Surfaces MiniMax envelope errors readably (e.g. `2013: model doesn't
  support duration 5s, supported: 6s, 10s`)

Needs `MINIMAX_API_KEY` and video quota on your MiniMax plan. The
default `mock` path remains the offline ffmpeg-based clip (back-compat with
v0.2) — use `--provider minimax` only when you have a thumbnail image
and video quota available.

### Full v0.2 pipeline (now complete)
```
new → research → script → storyboard → audio → review → preview → final → youtube → thumbnail → shorts
```
Each step writes files that the next step consumes, with human gates at
every generator boundary. AI never auto-publishes; humans decide.

### What's NOT here yet (deferred — no verified spec)
- **GLM image provider** — GLM Coding Plan docs don't document an image
  endpoint cleanly. Waiting on a verified spec before shipping.
- **Cloud rendering** — infra-heavy, no spec. Local ffmpeg continues
  to be the rendering path.
- **Per-segment BGM transitions** — fade in/out at scene boundaries
  (current `--bgm-fade-in/--bgm-fade-out` is project-level only).

## SFX Cues + BGM Fades (v0.3.5)

`vf mix` now reads `audio-assets/mix.yaml` (alongside `--mix-yaml <path>`
override) for SFX cues and BGM fade durations. Plus a new `--mix` flag on
`vf final` that chains `runMix` into the final pipeline.

### `audio-assets/mix.yaml` convention
```yaml
bgm: calm                       # optional: tag override for which BGM to pick
sfx:                            # optional: scene-keyed SFX cues
  scene_2: whoosh
  scene_4: ding
bgm_fade_in_sec: 1.5            # optional: fade BGM in over N seconds
bgm_fade_out_sec: 2             # optional: fade BGM out over last N seconds
```
- SFX cue keys MUST match `scene_N` where N is 1-based.
- CLI flags (`--bgm`, `--bgm-fade-in`, `--bgm-fade-out`) override the spec.
- Files referenced in `sfx` MUST exist in `assets/audio-assets/sfx/<tag>.wav`
  (from `vf audio-asset --sfx <tag>`); the CLI gives a readable error
  with the next-step hint if a cue is missing.

### `vf final --mix`
After the normal final render, `vf final --mix` calls `vf mix` so the
published artifact is `output/final-mixed.mp4` (narration + ducked BGM +
SFX cues) instead of the bare narration-only mp4.

```bash
vf audio "demo"               # assets/audio/scene-N.wav
vf audio-asset "demo" --bgm calm --sfx whoosh
# write audio-assets/mix.yaml (sfx cues + fades)
vf final --mix --cwd projects/demo    # produces output/final-mixed.mp4
```

## ## Audio Mixing (v0.3.4)

`vf mix` combines per-scene narration TTS (`assets/audio/scene-N.wav` from
`vf audio`) with a background music track (`assets/audio-assets/bgm/*.wav`
from `vf audio-asset`) into one final-mixed mp4.

```bash
vf audio "demo"           # produces assets/audio/scene-N.wav (narration)
vf audio-asset "demo" --bgm calm   # produces assets/audio-assets/bgm/calm.wav
vf mix "demo"
# → projects/demo/output/final-mixed.mp4  (narration + ducked BGM, AAC 192k)
```

### How mixing works
The mixer uses ffmpeg's `concat` demuxer to join all narration files in
order, then layers them over the BGM via `amix` with a `sidechaincompress`
keyed off the narration — so the BGM ducks to ~-18 dB when narration is
speaking and floats back up between lines. Volume automation is the simple
"good enough" version — broadcast-grade ducking remains a v0.4+ concern.

### Tuning
- `--bgm <path>` — explicit BGM file (defaults to first `.wav` in
  `assets/audio-assets/bgm/`)
- `--bgm-attenuation <db>` — how much to pre-attenuate the BGM (default `-18`)

### What's NOT here yet (deferred)
- **Per-segment BGM transitions** — fade in/out at scene boundaries
  (current `--bgm-fade-in/--bgm-fade-out` is project-level only).
- **SFX ducking** — current SFX cues play at unity volume. No automatic
  ducking under narration (would require a per-cue sidechaincompress
  keyed off the narration stream — v0.4+).

## ## Audio Assets (v0.3.3)

`vf audio-asset` adds **background music** and **sound effects** to a
project. Per doc §60 (Advanced Audio), this is the BGM/SFX asset layer —
actual mixing into the final mp4 is a separate concern (v0.3.4+).

```bash
node packages/cli/dist/index.js new "demo"
node packages/cli/dist/index.js audio-asset "demo" --bgm calm --sfx whoosh
# → projects/demo/assets/audio-assets/bgm/calm.wav (mock placeholder by default)
# → projects/demo/assets/audio-assets/sfx/whoosh.wav
```

### Providers
- **`mock`** (default) — deterministic 1-second silent WAV placeholder. No
  network. Useful for testing the pipeline without real audio assets.
- **`file-based`** — looks up `{tag}.wav` (or any filename containing the
  tag) in `--bgm-dir` / `--sfx-dir`. Pass the directories to activate.
  Real providers (Suno, ElevenLabs, etc.) plug into the same
  `AudioAssetProvider` interface — v0.3.3 ships the contract + two
  implementations.

### Licensing
The `file-based` provider reads a sibling `{tag}.license.txt` if present
and records the license on the run record. Otherwise the run record
labels the asset "user-provided (no license file found)" — humans are
responsible for verifying licensing.

## ## YouTube Automation (v0.2.7)

`vf youtube` produces the text-only publishing package for the video:
title, description, chapter timestamps, a thumbnail prompt, and a Shorts
script beat.

```bash
node packages/cli/dist/index.js youtube "AI 思维链"
# → projects/ai-思维链/youtube/title.txt
# → projects/ai-思维链/youtube/description.md
# → projects/ai-思维链/youtube/chapters.vtt   (WebVTT format — paste into YouTube Studio)
# → projects/ai-思维链/youtube/package.yaml  (full structured metadata)
# → projects/ai-思维链/youtube/thumbnail-prompt.txt  (describe what to design)
# → projects/ai-思维链/youtube/shorts-hook.txt  (60-second Shorts beat)
```

### Workflow
1. Run `vf youtube` after the project is FINAL_APPROVED.
2. Copy `title.txt` and `description.md` into YouTube Studio's upload form.
3. Paste `chapters.vtt` into the description box (YouTube parses it for
   the chapter markers on the timeline).
4. Use `thumbnail-prompt.txt` to design the thumbnail manually (the actual
   thumbnail image generation lands in v0.2 phase 8 / Advanced Media).
5. Record a separate Short from `shorts-hook.txt`.

### What's NOT here yet
Per doc §58 / Phase 9, YouTube automation also covers **thumbnail
generation** and **Shorts clipping**. v0.2 phase 7 ships the text
metadata only — the image generation and MP4 clipping ship in v0.2 phase 8
(Advanced Media §60).

## Pi Extension (v0.2.6)

The `vf` CLI is now also exposed as `/video` for agentic harnesses:

### Shell wrapper — `bin/video`
```bash
bin/video new "demo"
bin/video research "AI 思维链"
bin/video storyboard "AI 思维链" --from-research projects/.../research
bin/video preview --cwd projects/demo
```

The wrapper transparently forwards every verb to the `vf` CLI, so any
shell, Makefile, or CI script can drive the pipeline with one binary.

### Agent command — `.opencode/command/video.md`
OpenCode / Cursor / Claude Code / similar agentic harnesses that look up
`.opencode/command/*.md` will pick up `/video` as a slash command with
frontmatter (description, tools) plus a markdown body listing every
verb, the canonical pipeline order, and the critical invariants
(never auto-approve, credentials stay in env, fail loudly).

The same pattern transfers to Pi (`.pi/agents/` + `.pi/skills/` definitions)
with a small adaptation — Pi's frontmatter differs. The `vf` CLI is the
stable surface both harnesses wrap.

### Why no auto-approval
Per doc §58 and §65, the workflow enforces a human gate between every
generator step and the next. The agent (whether Pi or OpenCode) calls the
drafting verbs and surfaces the artifacts; the human reads and
`vf approve`s before `vf preview` ever touches the render path.

## Review Agent (v0.2.5)

`vf review` produces three review YAMLs — Content / Visual / Technical —
before you publish. Per doc §31 each section has a per-field verdict
(`ok` / `warn` / `fail`) plus an `overall` verdict (`pass` / `warn` /
`fail`); the agent lists concrete observations in array fields (e.g.
`unsupported_claims`, `missing_assets`).

```bash
node packages/cli/dist/index.js review "AI 思维链"
# → projects/ai-思维链/review/{content-review,visual-review,technical-review}.yaml
# → runs/<id>.yaml with provider/model/prompt_hash/tokens
```

The Review Agent is read-only — it never overwrites a human edit. Read the
three YAMLs, decide whether to fix the script/storyboard, or run
`vf preview` and proceed. **No automated gate is applied** (doc §32: agents
never have the final decision; only the human does).

### When to run
Run `vf review` after `vf script` + `vf audio` and before `vf preview`. If
any section's overall is `warn` or `fail`, fix the underlying issue (the
observations tell you what), then re-run.

## Voice + Subtitle (v0.2.4)

`vf audio` synthesizes real voiceover for the video using the Edge TTS
service (no API key needed) and writes per-scene WAVs + a captions file.

```bash
node packages/cli/dist/index.js script "AI 思维链"   # produces script/script.zh-CN.md
node packages/cli/dist/index.js audio "AI 思维链"   # synth + srt
# → projects/ai-思维链/assets/audio/scene-N.wav (one per scene, exact duration)
# → projects/ai-思维链/captions/zh-CN.srt
```

### Provider abstraction
- **`EdgeTTSProvider`** (default) — Microsoft Edge online TTS via
  `edge-tts-universal`. No API key. May fail offline; gracefully errors out
  with the provider name + status.
- **`FakeTTSProvider`** — silent WAV for tests + CI. Pass `--fake` to `vf
  audio` to use it (no network).

### Wiring audio into the preview
Once `vf audio` has produced per-scene WAVs, add `audio: assets/audio/scene-NN.wav`
to the corresponding scene's `narration:` block in `storyboard.yaml`. The
existing `vf preview` picks up real audio automatically (Remotion mounts
the `<Audio>` component for any scene with `audio` set).

### Cost
Edge TTS is free. There is no per-character or per-request cost.

## Script Agent (v0.2.3)

`vf script` drafts a Chinese-language script for the video. Per doc §28,
the script follows the 7-section narrative spine:

> Hook → Problem → Explanation → Example → Comparison → Implication → Conclusion

The structure is a recommended default; the agent adapts it when you pass a
`--direction`.

```bash
export MINIMAX_API_KEY=...
node packages/cli/dist/index.js script "AI 思维链" --duration 40 \
  --from-research projects/ai-思维链/research
# → projects/ai-思维链/script/script.zh-CN.md (all 7 sections)
# → runs/<id>.yaml with provider/model/prompt_hash/tokens/cost
```

The script file is plain Markdown with one `## Section` per heading — easy
to edit in any editor. Pass `--lang en-US` to produce `script.en-US.md`
instead.

### Wiring it into the storyboard
```bash
node packages/cli/dist/index.js storyboard "AI 思维链" \
  --from-script projects/ai-思维链/script/script.zh-CN.md
```
The script's 7 sections appear in the storyboard prompt as supporting
context — the Storyboard Agent still produces its own draft (mapped to
the script's flow, but structurally free).

### Full v0.2 chain
```bash
vf research "<topic>"        → research/{research.md, sources.yaml, claims.yaml}
vf script "<topic>" \         → script/script.zh-CN.md (or en-US)
  --from-research ...
vf storyboard "<topic>" \     → storyboard/storyboard.yaml
  --from-research ... \
  --from-script ...
vf preview / vf final        → MP4
```
Each step is independently editable; the agents never overwrite a human
edit without explicit re-invocation.

## Research Agent (v0.2.2)

`vf research` gathers facts and source links about any topic before you draft
the storyboard. It produces three human-reviewable files in
`projects/<slug>/research/`:

- `research.md` — narrative with `> **Fact (source: ...):** ...` and `> **Opinion:** ...` callouts
- `sources.yaml` — provenance (url / title / accessed / snippet)
- `claims.yaml` — each claim tagged `fact` / `opinion` / `uncertain` / `needs_human`

Any `uncertain` / `needs_human` claim is surfaced at the top of
`research.md` under `## Needs human review` so you see them first.

```bash
export MINIMAX_API_KEY=...   # required for the default GLM provider + MiniMax web search

node packages/cli/dist/index.js research "AI 思维链" --duration 40
# → projects/ai-思维链/research/{research.md, sources.yaml, claims.yaml}
# → runs/<id>.yaml with provider/model/prompt_hash/tokens/cost
# → next: edit, then `vf storyboard --from-research projects/ai-思维链/research`
```

### Web search
Enabled by default via MiniMax Coding Plan `/v1/coding_plan/search`.
Disable with `--no-web` if you prefer the LLM's training-data-only view
(useful for evergreen topics or when API budget is tight). If web search
fails, the output is still produced but `meta.web_search_failed: true`
in `runs/<id>.yaml` so the failure is visible — never silently fabricated.

### Consuming research in the storyboard
```bash
node packages/cli/dist/index.js storyboard "AI 思维链" \
  --from-research projects/ai-思维链/research
```
The research context is injected as supporting evidence; the Storyboard
Agent still produces its own draft (it doesn't replace the researcher's
work — it cites and weighs it).

## Storyboard Agent (v0.2)

`vf storyboard` drafts a VDSL storyboard from a topic by calling an LLM
(MiniMax by default, GLM as fallback). The draft lands at
`projects/<slug>/storyboard/storyboard.yaml` for human review before
`vf preview` ever touches it.

```bash
export MINIMAX_API_KEY=...   # required for the default MiniMax provider
export GLM_API_KEY=...        # enables fallback to GLM if MiniMax fails

node packages/cli/dist/index.js storyboard "AI 思维链" --duration 40
# → scaffolds projects/ai-思维链/, drafts storyboard.yaml, writes runs/<id>.yaml
# → next: edit, then `vf approve storyboard`, then `vf preview`
```

The CLI never logs the key, never writes it to disk, and never includes
it in `runs/<id>.yaml` (verified by an integration test that greps the
whole project tree).

### Which provider?
Default from `llm.config.yaml` if present, otherwise `minimax` for
`storyboard` role with `glm` as fallback (matches doc §6 example). Pass
`--model minimax` or `--model glm` to override for one command.

### What's intentionally NOT here yet
Per doc §66 dev order, v0.2 phase 1 ships ONLY the Storyboard Agent.
Research Agent (§55), Script Agent (§55), Voice/Subtitle (§56),
Review Agent (§57), and Pi Extension (§58) are subsequent phases —
each gets its own plan.

## Benchmark

`projects/benchmark-v01/` is the canonical v0.1 video: 6 scenes, 39 seconds,
zh-CN explainer about AI chain-of-thought. Run `pnpm run acceptance` to
verify it meets all §62.4 acceptance criteria.
