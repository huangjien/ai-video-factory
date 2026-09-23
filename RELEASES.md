# Release Notes

Each tagged release of the AI Video Factory. The full pipeline goes:

```
vf research → script → storyboard → audio (TTS) → audio-asset (BGM+SFX)
            ↓
       (write audio-assets/mix.yaml: bgm, sfx per scene_N, fades)
            ↓
       vf preview → vf approve review → vf final --mix → final-mixed.mp4
            ↓
       vf thumbnail --provider minimax → real AI thumbnail
       vf shorts --provider minimax    → real AI Shorts clip
       vf youtube                         → YouTube publishing package
       vf review                          → Content/Visual/Technical review YAMLs
```

## v0.3.5 — SFX cues + BGM fades + `vf final --mix`

**Branch:** `feat/v0.3-sfx-cues-and-fade`
**Tags:** `v0.3.5`

- `audio-assets/mix.yaml` convention: `bgm`, `sfx: {scene_N: tag}`, `bgm_fade_in_sec`, `bgm_fade_out_sec`. CLI flags override the spec.
- New engine `mixTracksWithSpec` places SFX cues via `adelay` + applies `afade=in/out` to the BGM track.
- `vf mix` reads `mix.yaml` (or `--mix-yaml <path>`) + supports `--bgm-fade-in/--bgm-fade-out` flags.
- `vf final --mix` chains `runMix` after the final render so the published artifact is `output/final-mixed.mp4`.
- Docs: refreshed stale "What's NOT here yet" sections; consolidated ARCHITECTURE roadmap duplication.

## v0.3.4 — Audio mixing engine + `vf mix` CLI

**Branch:** `feat/v0.3-audio-mix`
**Tags:** `v0.3.4`

- `@vf/audio-mix` package with `mixTracks(opts)` using ffmpeg `concat` demuxer (list-file driven) + `amix` + `sidechaincompress` (BGM ducks ~-18 dB under narration).
- `vf mix <project> --bgm <path> --bgm-attenuation <db>` verb.
- Pure mechanical ffmpeg pipeline — no AI, no network.

## v0.3.3 — Audio assets (BGM + SFX provider layer)

**Branch:** `feat/v0.3-audio-assets`
**Tags:** `v0.3.3`

- `@vf/audio-assets` package with `AudioAssetProvider` interface.
- Two implementations: `MockAudioAssetProvider` (deterministic silent WAV placeholder, offline default) + `FileBasedAudioAssetProvider` (looks up `{tag}.wav` from `--bgm-dir`/`--sfx-dir`, reads optional `{tag}.license.txt`).
- `vf audio-asset <project> --bgm <tag> --sfx <tag>` verb writes to `assets/audio-assets/{bgm,sfx}/{tag}.wav` + run record.

## v0.3 — Real AI providers (MiniMax image + video)

**Branch:** `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video`
**Tags:** `v0.3`

- `MiniMaxImageProvider` (`image-01`): powers `vf thumbnail --provider minimax` for real AI thumbnails. Surfaces MiniMax envelope errors readably (e.g. 2056 quota, 1004 auth).
- `MiniMaxVideoProvider` (`MiniMax-Hailuo-2.3`, image-to-video): powers `vf shorts --provider minimax`. Implements the full async flow: create task → poll until Success → download. Honest envelope-error handling.
- Both providers use `MINIMAX_API_KEY` env var (no API key for the MiniMax Coding Plan path — already set in this dev env).
- `ImageResult.contentType` widened to `"image/png" | "image/jpeg"`; `VideoRequest` extended with `firstFrameImageUrl`.

## v0.2 — Full v0.2 pipeline (8 phases)

**Branch:** `feat/video-agent-v01`
**Tags:** `v0.2`

- VDSL → Remotion → MP4 pipeline
- 10 motion components (Title, Paragraph, CodeBlock, Terminal, Image, FlowChart, Comparison, Timeline, Callout, EndCard)
- Checkpoint state machine + 10 CLI workflow verbs (`new`, `validate`, `status`, `approve`, `reject`, `rollback`, `resume`, `preview`, `final`, etc.)
- 5 LLM-driven agents (Storyboard, Research, Script, Review, YouTube) — all reuse `@vf/llm` (MiniMax + GLM providers)
- Edge TTS voiceover (`@vf/tts`)
- Benchmark video (`projects/benchmark-v01/`): 6 scenes, 39 seconds, zh-CN explainer about AI chain-of-thought
- §62.4 acceptance automation: 11/11 checks passing
- `bin/video` + `.opencode/command/video.md` for Pi Extension / OpenCode harness integration

## How the tags map to branches

| Tag      | Branch(es)                                             | Merged in commit(s)  |
| -------- | ------------------------------------------------------ | -------------------- |
| `v0.2`   | `feat/video-agent-v01`                                 | merge commit on main |
| `v0.3`   | `feat/v0.3-advanced-media` + `feat/v0.3-minimax-video` | merge commit on main |
| `v0.3.3` | `feat/v0.3-audio-assets`                               | merge commit on main |
| `v0.3.4` | `feat/v0.3-audio-mix`                                  | merge commit on main |
| `v0.3.5` | `feat/v0.3-sfx-cues-and-fade`                          | merge commit on main |

All release tags are on `origin` and pushed.

## Versioning convention

- **v0.x.y** — development tags, may be incremented without a strict semver contract.
- **Major bumps (v1.0)** reserved for the first production-ready milestone after GLM image + cloud rendering land.
- Tags are immutable; new work creates a new tag rather than moving an old one.
- **Package manager**: this project uses **pnpm 12.5+** (enforced via the `packageManager` field in `package.json`). The lockfile is `pnpm-lock.yaml`; do not commit `package-lock.json`.
