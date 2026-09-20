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
# One-time setup (Node 22+, macOS)
brew install ffmpeg          # required by §4
npm install                   # workspace deps

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

## Commands

| Command | Purpose |
| --- | --- |
| `vf new <id>` | scaffold a project under `projects/<id>/` |
| `vf storyboard <topic>` | (v0.2) AI-draft a storyboard from a topic via MiniMax/GLM |
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
| `npm test` | unit + integration tests (vitest) |
| `npm run build` | `tsc -b` across all packages |
| `npm run lint` | ESLint flat config |
| `npm run format` | Prettier |
| `npm run benchmark:verify` | render the benchmark twice and assert structural identity (§62.4) |
| `npm run acceptance` | full §62.4 audit (functional + video + engineering) |

## Architecture map

See `ARCHITECTURE.md` — maps each design-doc section to the package and
file that implements it, plus the v0.2+ roadmap.


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
zh-CN explainer about AI chain-of-thought. Run `npm run acceptance` to
verify it meets all §62.4 acceptance criteria.
