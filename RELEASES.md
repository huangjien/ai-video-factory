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

## v0.3.7 — real BGM/SFX in `vf make` via `--bgm-dir` / `--sfx-dir`

**Branch:** `feat/v0.3.7-make-audio-dirs`
**Tags:** `v0.3.7`

- **`vf make <project> --bgm-dir <dir> --sfx-dir <dir>`** wires the existing `FileBasedAudioAssetProvider` into the make pipeline. The tags in `audio-config.yaml` (`bgm: calm`, `sfx: {scene_1: whoosh}`) resolve to `{tag}.wav` inside your library (exact filename first, then any `.wav` containing the tag). Without the flags the audio-assets step keeps writing 1-second silent mock placeholders — meaning the BGM ducking/fades in `vf mix` were technically running over silence.
- Per-kind selection: `--bgm-dir` alone upgrades only BGM (SFX stays mock), and vice versa. A sibling `{tag}.license.txt` in your library is surfaced on the make report; a missing tag fails the `audio-assets` step readably (add the file or drop the cue).
- **`runMake` no longer crashes the CLI on a failed step.** `runStep` failures are recorded as `✗` steps and later steps are skipped (they depend on the failed step's outputs), so `vf make` exits 1 with the per-step summary instead of a stack trace.
- `runAudioAssets` is exported from `@vf/make` for direct testing.
- Docs: corrected earlier `--imageProvider` mentions to the real kebab-case flag `--image-provider`; new `--bgm-dir`/`--sfx-dir` guidance in §6.2 and §9.1 (EN + zh-CN).
- Tests: 349/349 pass; new `packages/make/src/audio-asset-dirs.test.ts` covers real-bytes copy + license surfacing, per-kind fallback to mock, mock default, and the missing-tag failure. Verified end-to-end on `projects/harness-engineering`: 290 s real BGM (25.5 MB) + 2 SFX cues land in `assets/audio-assets/` and `final-mixed.mp4` carries audible audio.

## v0.3.6 — `--fake` keeps scenes visible + malformed-draft narration recovery

**Branch:** `fix/v0.3.6-fake-image-default`
**Tags:** `v0.3.6`

- **`vf make --fake` default imageProvider changed from `"mock"` to `"none"`.** The mock provider produced 64×36 solid-colour PNGs, and `updateStoryboardForImages` rewrote every scene from `AnimatedIllustration` (caption + animated SVG) to `ImageBackground` (image-only). For long videos this left ~9 minutes of blank frames after the title card. Defaulting to `"none"` skips image generation in offline mode and scenes keep `AnimatedIllustration`. Pass `--image-provider mock` explicitly if you want to exercise the ImageBackground path with placeholders.
- **`updateStoryboardForImages` carries the scene caption into the new ImageBackground props**, and `ImageBackground` now renders an optional bottom-overlay caption. So if image generation partially fails or mock images are in use, scenes still show their caption text.
- **`articleToStoryboardYaml` truncates long `Title.subtext`** at the first natural punctuation near 50 characters, so old drafts with very long LLM visual descriptions no longer overflow the 36 px subtext `<p>`.
- **LLM prompt tightened**: the `VISUAL DIRECTION` section now tells the drafter the renderer keyword-matches to a small shape vocabulary, so extra description beyond the matching keyword is dead weight that bloats on-screen captions.
- **Empty-narration draft recovery.** Real failure mode (seen on the `harness-engineering` project): the LLM puts all prose in `## N. ...` section bodies and ships every scene's `narration:` blank — the strict zod schema then rejected `vf audio-plan` (and would have rejected `vf make`) with an opaque 19-issue JSON dump. New `parseArticleWithRecovery` in `@vf/draft`: strict parse first, and on the empty-narration failure back-fill narrations from section bodies (sentence-aware distribution across scenes; only `## N. ...` headings count, so the H1 title and hook block are never treated as a section). All four article.md consumers route through it — `vf make` (surfaces a `recover-narrations` step in the report), `vf audio-plan` (prints a warning + `vf draft --from` hint), `vf draft` storyboard-sync, and `vf youtube`. `vf audio-plan --strict` keeps the old fail-loudly behaviour for CI.
- **LLM prompt (narration)**: §7 SCENE NARRATION now states the narration field must contain the actual spoken content and that section bodies do not replace it.
- Tests: 345/345 pass; added `packages/make/src/fake-image-default.test.ts`, plus `schemas.test.ts` cases for lenient parse, recovery distribution, kept-verbatim scenes, `parseArticleWithRecovery` passthrough/rethrow, and subtext truncation.

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
| `v0.3.6` | `fix/v0.3.6-fake-image-default`                         | merge commit on main |
| `v0.3.7` | `feat/v0.3.7-make-audio-dirs`                            | merge commit on main |

All release tags are on `origin` and pushed.

## Versioning convention

- **v0.x.y** — development tags, may be incremented without a strict semver contract.
- **Major bumps (v1.0)** reserved for the first production-ready milestone after GLM image + cloud rendering land.
- Tags are immutable; new work creates a new tag rather than moving an old one.
- **Package manager**: this project uses **pnpm 12.5+** (enforced via the `packageManager` field in `package.json`). The lockfile is `pnpm-lock.yaml`; do not commit `package-lock.json`.
