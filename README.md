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
| `vf research <topic>` | (v0.2.2) AI-gather facts + sources + claims via MiniMax/GLM (+ optional web search) |
| `vf script <topic>` | (v0.2.3) AI-draft a 7-section script (Hook→Conclusion) via MiniMax/GLM (optionally consumes `vf research` via `--from-research`) |
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
| `npm test` | unit + integration tests (vitest) |
| `npm run build` | `tsc -b` across all packages |
| `npm run lint` | ESLint flat config |
| `npm run format` | Prettier |
| `npm run benchmark:verify` | render the benchmark twice and assert structural identity (§62.4) |
| `npm run acceptance` | full §62.4 audit (functional + video + engineering) |

## Architecture map

See `ARCHITECTURE.md` — maps each design-doc section to the package and
file that implements it, plus the v0.2+ roadmap.




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
zh-CN explainer about AI chain-of-thought. Run `npm run acceptance` to
verify it meets all §62.4 acceptance criteria.
