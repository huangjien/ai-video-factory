# Contributing

Thanks for your interest in the AI Video Factory. This is a small project
with a focused workflow; the steps below should get you productive quickly.

## Local setup

Requires **Node 22+** (tested on Node 26), **pnpm 12.5+** (the project uses pnpm for workspace dependency management), and **ffmpeg** (tested on ffmpeg 9.x).

```bash
# macOS
brew install ffmpeg
brew install pnpm@12.11.2

# Debian/Ubuntu
sudo apt install ffmpeg nodejs
npm install -g pnpm@12.11.2

# Verify
node --version   # v22+
pnpm --version    # v12.5+
ffmpeg -version  # 9.x
```

Clone, install deps, verify everything builds:

```bash
git clone https://github.com/huangjien/ai-video-factory.git
cd ai-video-factory
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run acceptance    # runs the §62.4 acceptance audit
```

CI runs the same four commands (build + lint + test + acceptance) on every
PR and push to `main`. See `.github/workflows/test.yml`.

## Codebase orientation

| Path                                      | What's there                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/vdsl/`                          | VDSL schema (zod) + validator + compiler. The video format's source of truth.   |
| `packages/video-components/`              | 24 scene components in `REGISTRY` + chrome overlays (`CaptionsOverlay`, `BrandWatermark`, `BrandIntro`) + 7 animation primitives (`fade`, `slide`, `scale`, `draw`, `typewriter`, `entrance`, `fadeOut`) + 9 `style.theme` palettes (3 official + 6 v0.4.x additions) + 5 intro gradients (`aurora`, `sunset`, `ocean`, `citrus`, `channel-banner`). |
| `packages/video-renderer/`                | Remotion composition that consumes `RenderPlan`. The renderer.                  |
| `packages/llm/`                           | Provider abstraction: `MiniMaxProvider`, `GLMProvider`, `LayaClient` decision sidecar (v0.6). Used by every agent. |
| `packages/prompts/`                       | Central prompt registry — every LLM/Laya prompt body is a file under `prompts/` (`.md` / `image-styles.yaml` / `music.json`), loaded via `loadPrompt()`; `video prompts` lists them. Edit prompts there, not in agent source. Holds the golden-set fixtures under `evals/` (v0.10). |
| `packages/draft/`                         | Article drafter agent + quality judge + image-style presets + visual classifier (the `video draft` brain). |
| `packages/make/`                          | End-to-end `video make`: TTS → audio assets → scene visuals → render → mix, with impact analysis + content-keyed caches. |
| `packages/audio-plan/`                    | Audio Planner agent (audio-config.yaml proposals). |
| `packages/media/`                         | Caption wrapping, audio probing, scene-timing sync. |
| `packages/qa/`                            | Render QA checks (ffprobe) + Laya triage consult. |
| `packages/motion/`                        | Motion agent + heuristics (per-scene animation timelines). |
| `packages/learn/`                         | Human-review learning loop (lessons → prompt rules). |
| `packages/agent-storyboard/`              | Storyboard Agent (system prompt + agent).                                       |
| `packages/research/`                      | Research Agent + MiniMax `web_search`.                                          |
| `packages/script/`                        | Script Agent (7-section spine).                                                 |
| `packages/tts/`                           | Edge TTS voiceover.                                                             |
| `packages/audio-assets/`                  | BGM + SFX providers (mock + file-based).                                        |
| `packages/audio-mix/`                     | ffmpeg-driven audio mixing (BGM + narration + SFX cues + fades).                |
| `packages/media-generators/`              | Image + video provider abstractions + MiniMax / OpenAI / Gemini image implementations. |
| `packages/review/`                        | Read-only Content/Visual/Technical review agent.                                |
| `packages/youtube/`                       | YouTube publishing package (title/description/chapters.vtt/...).                |
| `packages/workflow/`                      | 10-state machine + checkpoints + run records.                                   |
| `packages/cli/`                           | The `video` CLI (entry point + all `bin/video` verbs).                             |
| `packages/cli/src/audio-command.ts`       | TTS per scene.                                                                  |
| `packages/cli/src/audio-asset-command.ts` | `video audio-asset` (BGM/SFX).                                                     |
| `packages/cli/src/mix-command.ts`         | `video mix` (read `audio-assets/mix.yaml`).                                        |
| `packages/cli/src/render-command.ts`      | `video preview` / `video final` (Remotion render + mix chaining).                     |
| `packages/cli/src/youtube-command.ts`     | `video youtube` (title + description + chapters.vtt).                              |
| `packages/cli/src/thumbnail-command.ts`   | `video thumbnail` (mock + MiniMax image).                                          |
| `packages/cli/src/shorts-command.ts`      | `video shorts` (mock + MiniMax video).                                             |
| `bin/video`                               | Shell wrapper: `video <verb> [args...]` → `node packages/cli/dist/index.js ...` |
| `.opencode/command/video.md`              | Slash-command definition for OpenCode / Cursor / Claude Code.                   |
| `projects/benchmark-v01/`                 | Canonical end-to-end project (39s zh-CN CoT explainer).                         |
| `scripts/acceptance.mjs`                  | §62.4 audit script (ffprobe-based).                                             |
| `scripts/benchmark-verify.mjs`            | Render-twice structural identity.                                               |
| `docs/`                                   | Project docs (kept in repo for visibility).                                     |

## Conventions

### Commits

- **One commit per todo.** Each commit's message is `<type>(<scope>): <summary>`.
- Use **`pnpm`** — never commit `package-lock.json` (the lockfile is `pnpm-lock.yaml`).
  - `feat(<pkg>): <feature>` for new functionality.
  - `fix(<pkg>): <bugfix>` for bug fixes.
  - `docs:` for documentation-only changes.
  - `chore: <summary>` for tooling / meta changes.
  - `ci: <summary>` for CI changes.
- Messages are short (one line). Detail lives in the PR description or commit body.

### Branches

- **One branch per phase.** Naming convention: `feat/v<X>.<Y>-<slug>` (e.g. `feat/v0.3-audio-mix`).
- Keep branch scope tight — a branch should land a single coherent change.

### Tags / releases

- After a phase ships, merge the branch to `main` with `--no-ff`, then tag `v<X>.<Y>` (or `v<X>.<Y>.<N>` for sub-releases).
- Tags are immutable; new work creates a new tag.
- Bump the version in the merge commit message and tag message.

### Testing

- **TDD for everything that has shape.** New package = write failing tests first, then implement. Schema files (`*.test.ts` beside `*.ts`) are the contract.
- **One assertion per test.** Smoke tests live in CLI integration tests (`packages/cli/src/*.integration.test.ts`).
- **Test files must end with `.test.ts` or `.test.tsx`** so vitest picks them up.

### Prompts

- Every LLM/Laya prompt body lives in `packages/prompts/prompts/` — one file per prompt (e.g. `storyboard.md`). Edit the file; the pipeline loads it on the next run. Never inline prompt text in agent source.
- Prompts with dynamic parts keep the static skeleton in the file with `{{placeholder}}` tokens and fill them via `fillPrompt()` (see `packages/script/src/prompt.ts`); message assembly (`buildMessages`) stays in code.
- `loadPrompt()` strips one trailing newline, so file content stays byte-identical to the historical inline strings — `RunRecord.prompt_hash` lineage depends on this. Run `video prompts` to list/inspect the registry.
- Registry hygiene is test-enforced: `packages/cli/src/prompt-registry.test.ts` imports every loader site and asserts the loader cache equals the files on disk, so an orphan prompt file (added, never loaded) or a dangling reference (deleted, still called) fails the suite. Rule: every prompt loads at module scope in its owning package.
- Prompt **quality** regression is enforced by a golden set (v0.10): fixtures live in `packages/prompts/evals/<agent>/<case-id>.yaml`, each with a committed message snapshot in `__snapshots__/`. Run `video prompts eval` (structural, offline, free) or `pnpm run prompts:eval`; add `--judge glm` for the LLM rubric layer before landing a prompt change. Design + known gaps: `docs/v0.10-prompt-evals-plan.md`.
- After a **deliberate** prompt edit, re-record both baselines or the next reviewer inherits the wrong one: `video prompts eval --update-snapshots` for the fingerprint, and `--judge glm --update-recorded` for the score.
- Layer 1 runs in CI for free (`packages/cli/src/prompt-evals.test.ts`), including the two-way orphan guard — every fixture needs a snapshot, every snapshot needs a fixture. Layer 2 costs tokens and stays manual.

#### Prompt evals before push (`.githooks/pre-push`)

Enable once: `git config core.hooksPath .githooks`. The hook fires only when the push carries a change under `packages/prompts/`, then runs the golden set.

| Situation | Hook behaviour | Cost |
| --- | --- | --- |
| default | layer 1 gates. Drift or an orphan fixture **blocks the push** | ~1s, free |
| `PROMPT_EVAL_JUDGE=1 git push` | layer 2 rubric also runs; a score below its axis `min` blocks | **~4 min, ~10 provider calls** |
| `PROMPT_EVAL_JUDGE=1` with provider down | exit 2 — warns, does **not** block | ~10s |
| `CI=true` (workflows) | skips; the unit job already runs layer 1 | 0 |
| `git push --no-verify` | skips the hook | 0 |

**Why layer 2 is opt-in.** Measured 2026-10-18 on GLM, three draft cases: generation 95–165s per case, rubric judge 20–35s per case. The generation dominates and is irreducible — you cannot judge an article without writing it first. A judged layer can never be a fast gate, so it does not block by default.

`PROMPT_EVAL_JUDGE=1` judges the whole golden set (both agents). Narrow it with `PROMPT_EVAL_AGENT=<name>` and `PROMPT_EVAL_PROVIDER=<glm|minimax>`.

**Exit codes.** `0` pass · `1` a measured failure (prompt drift, or a judged score below `min`) · `2` a case could not be measured at all (provider timeout, outage, content filter, schema rejection). The hook blocks on 1 and warns on 2 — a gate that blocks on its own flakiness gets disabled within a week.

**Calibrated thresholds.** Every `min` in `packages/prompts/evals/` is set to *observed floor − 1* over ≥4 judged runs, not to an aspirational target. A threshold above the current floor fails the very prompt it guards. When you deliberately change a prompt: `--update-snapshots` for the fingerprint, then `PROMPT_EVAL_JUDGE=1` plus `--update-recorded` for the score.

### Formatting

- Prettier is scoped by `.prettierignore` to code this repo owns: `packages/`, `scripts/`. Third-party agent skills (`.agents/`, `.claude/`, …), generated project output, build output, lock files, and **all Markdown/YAML/JSON** are excluded.
- Markdown and data files are excluded on purpose. Prettier realigns every markdown table to uniform column widths, which rewrites large unchanged regions of otherwise-identical documents for zero semantic gain. Prettier formats code, not prose.
- ~175 pre-existing files under `packages/` still differ from Prettier's output — mostly line-wrap choices at the 80-column boundary. Reformatting them is a deliberate, reviewable commit of its own, not something to fold into a feature change.
- If you touch a file, make that file clean. Do not reformat unrelated files to "fix the check".

### Branches and CI

- CI runs on every push/PR to `main` (`.github/workflows/test.yml`).
- A PR should pass CI before merge.
- Recommend branch protection: require CI check + 1 review before merge to `main` (see "Branch protection" section below).

## Adding a new agent or provider

The pattern is consistent across `v0.3`:

1. **Create a new package** under `packages/<name>/`.
2. **Add a zod schema** in `src/schemas.ts` with `.strict()` (rejects unknown fields).
3. **Add a provider abstraction** if it talks to an external service — see `@video/llm`, `@video/media-generators`, `@video/audio-assets` for the pattern.
4. **Add a CLI verb** in `packages/cli/src/<verb>-command.ts`.
5. **Wire the verb** into `packages/cli/src/index.ts`.
6. **Update run records** to include provider/model/tokens fields (per the schema in `@video/workflow`).
7. **Write docs**: README section + architecture.md entry.
8. **Add a release tag** when the phase ships.

## Adding a new VDSL component

1. Add zod schema for the props in `packages/video-components/src/registry.ts`.
2. Implement the React component in `packages/video-components/src/components/<Name>.tsx`.
3. Export from `packages/video-components/src/index.ts`.
4. Add a unit test using `renderToStaticMarkup` (see existing `components.test.tsx`).
5. If the component needs a new animation type, add it to the `animations.ts` file in the same package.

## Adding a new CLI verb

1. Create `packages/cli/src/<verb>-command.ts` exporting `run<Verb>(opts: <Verb>Options): Promise<number>`.
2. Add a `program.command("<verb>")...` block in `packages/cli/src/index.ts`.
3. Add tests (CLI integration or unit depending on complexity).
4. Update README + architecture.md.

## Code style

- **TypeScript strict everywhere** (`tsconfig.base.json` enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- `z.instanceof(Uint8Array)` rejects Node 26's `Uint8Array<ArrayBufferLike>` variant — use `z.custom<Uint8Array>()` with `instanceof` check (see `audio-assets/src/schemas.ts`).
- Node 26 distinguishes `Uint8Array<ArrayBuffer>` from `Uint8Array<ArrayBufferLike>`. Be explicit about which you want.
- **Use the ESLint config as-is** — no inline `eslint-disable` unless absolutely necessary.

## Branch protection recommendation

I recommend GitHub branch protection on `main`:

1. Go to `Settings` → `Branches` → `Add branch protection rule`.
2. Branch name pattern: `main`.
3. Enable:
   - ☑ Require a pull request before merging
   - ☑ Require approvals (1)
   - ☑ Require status checks to pass before merging (`test` — the GitHub Actions workflow)
   - ☑ Require conversation resolution before merging (optional but helpful)
   - ☑ Include administrators (so even direct pushes from owners go through PR review)
4. Don't enable:
   - "Require linear history" (we use merge commits)
   - "Require signed commits" (overkill for personal project)
   - "Require deploy before merge" (no deploy step)

This keeps `main` clean, forces every change through the CI gate, and preserves the merge-commit history that makes the tags meaningful.

## Release process (recap)

1. Cut a branch: `git checkout -b feat/v<X>.<Y>-<slug> main`.
2. Develop with TDD, commit frequently (one commit per todo), keep branch tight.
3. Run `pnpm test && pnpm run build && pnpm run lint && pnpm run acceptance` locally — all must pass.
4. Push the branch, open a PR.
5. Once CI is green and the PR is approved, merge with `--no-ff` (`git merge --no-ff feat/...`).
6. Tag the merge commit: `git tag -a v<X>.<Y> -m "<summary>"`.
7. Push `main` + tags: `git push origin main v<X>.<Y>`.
8. Update RELEASES.md with a brief summary of what shipped.
