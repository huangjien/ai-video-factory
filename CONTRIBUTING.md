# Contributing

Thanks for your interest in the AI Video Factory. This is a small project
with a focused workflow; the steps below should get you productive quickly.

## Local setup

Requires **Node 22+** (tested on Node 26) and **ffmpeg** (tested on ffmpeg 9.x).

```bash
# macOS
brew install ffmpeg

# Debian/Ubuntu
sudo apt install ffmpeg nodejs

# Verify
node --version   # v22+
ffmpeg -version  # 4.x+
```

Clone, install deps, verify everything builds:

```bash
git clone https://github.com/huangjien/ai-video-factory.git
cd ai-video-factory
npm install
npm run build
npm test
npm run lint
npm run acceptance    # runs the §62.4 acceptance audit
```

CI runs the same five commands (build + lint + test + acceptance) on every
PR and push to `main`. See `.github/workflows/test.yml`.

## Codebase orientation

| Path | What's there |
|---|---|
| `packages/vdsl/` | VDSL schema (zod) + validator + compiler. The video format's source of truth. |
| `packages/video-components/` | 10 React components + 5 animation primitives + `dark-tech` theme. |
| `packages/video-renderer/` | Remotion composition that consumes `RenderPlan`. The renderer. |
| `packages/llm/` | Provider abstraction: `MiniMaxProvider`, `GLMProvider`. Used by every agent. |
| `packages/agent-storyboard/` | Storyboard Agent (system prompt + agent). |
| `packages/research/` | Research Agent + MiniMax `web_search`. |
| `packages/script/` | Script Agent (7-section spine). |
| `packages/tts/` | Edge TTS voiceover. |
| `packages/audio-assets/` | BGM + SFX providers (mock + file-based). |
| `packages/audio-mix/` | ffmpeg-driven audio mixing (BGM + narration + SFX cues + fades). |
| `packages/media-generators/` | Image + video provider abstractions + MiniMax implementations. |
| `packages/review/` | Read-only Content/Visual/Technical review agent. |
| `packages/youtube/` | YouTube publishing package (title/description/chapters.vtt/...). |
| `packages/workflow/` | 10-state machine + checkpoints + run records. |
| `packages/cli/` | The `vf` CLI (entry point + all `bin/video` verbs). |
| `packages/cli/src/audio-command.ts` | TTS per scene. |
| `packages/cli/src/audio-asset-command.ts` | `vf audio-asset` (BGM/SFX). |
| `packages/cli/src/mix-command.ts` | `vf mix` (read `audio-assets/mix.yaml`). |
| `packages/cli/src/render-command.ts` | `vf preview` / `vf final` (Remotion render + mix chaining). |
| `packages/cli/src/youtube-command.ts` | `vf youtube` (title + description + chapters.vtt). |
| `packages/cli/src/thumbnail-command.ts` | `vf thumbnail` (mock + MiniMax image). |
| `packages/cli/src/shorts-command.ts` | `vf shorts` (mock + MiniMax video). |
| `bin/video` | Shell wrapper: `video <verb> [args...]` → `node packages/cli/dist/index.js ...` |
| `.opencode/command/video.md` | Slash-command definition for OpenCode / Cursor / Claude Code. |
| `projects/benchmark-v01/` | Canonical end-to-end project (39s zh-CN CoT explainer). |
| `scripts/acceptance.mjs` | §62.4 audit script (ffprobe-based). |
| `scripts/benchmark-verify.mjs` | Render-twice structural identity. |
| `docs/` | Project docs (kept in repo for visibility). |

## Conventions

### Commits
- **One commit per todo.** Each commit's message is `<type>(<scope>): <summary>`.
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

### Branches and CI
- CI runs on every push/PR to `main` (`.github/workflows/test.yml`).
- A PR should pass CI before merge.
- Recommend branch protection: require CI check + 1 review before merge to `main` (see "Branch protection" section below).

## Adding a new agent or provider

The pattern is consistent across `v0.3`:

1. **Create a new package** under `packages/<name>/`.
2. **Add a zod schema** in `src/schemas.ts` with `.strict()` (rejects unknown fields).
3. **Add a provider abstraction** if it talks to an external service — see `@vf/llm`, `@vf/media-generators`, `@vf/audio-assets` for the pattern.
4. **Add a CLI verb** in `packages/cli/src/<verb>-command.ts`.
5. **Wire the verb** into `packages/cli/src/index.ts`.
6. **Update run records** to include provider/model/tokens fields (per the schema in `@vf/workflow`).
7. **Write docs**: README section + ARCHITECTURE entry.
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
4. Update README + ARCHITECTURE.

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
3. Run `npm test && npm run build && npm run lint && npm run acceptance` locally — all must pass.
4. Push the branch, open a PR.
5. Once CI is green and the PR is approved, merge with `--no-ff` (`git merge --no-ff feat/...`).
6. Tag the merge commit: `git tag -a v<X>.<Y> -m "<summary>"`.
7. Push `main` + tags: `git push origin main v<X>.<Y>`.
8. Update RELEASES.md with a brief summary of what shipped.
