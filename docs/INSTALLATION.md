# AI Video Factory — Installation

Everything needed to get the AI Video Factory running on a machine.

- **You want to make a video?** → [`docs/USAGE.md`](./USAGE.md)
- **You want to understand the system?** → [`docs/architecture.md`](./architecture.md)
- **You want the storyboard format?** → [`docs/schema.md`](./schema.md)

This document covers: requirements, installation, provider keys and secrets,
verification, the optional local components, and the agent-harness adapters.

Current version: **v0.11.2** (see `package.json`).

---

## 1. Requirements

Required:

- Node.js 22 or newer (`engines.node: ">=22"`)
- pnpm 12 (`packageManager: "pnpm@12.15.0"`) — this is a pnpm workspace,
  not an npm project
- FFmpeg, including `ffprobe`
- macOS, Linux, or Windows with a POSIX-compatible shell for `bin/video`

Check the versions:

```bash
node --version
pnpm --version
ffmpeg -version
ffprobe -version
```

For macOS:

```bash
brew install node ffmpeg
corepack enable   # provides the pinned pnpm
```

For Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

On Windows, install Node.js from nodejs.org and FFmpeg from an approved
package manager or ffmpeg.org. Ensure `node`, `pnpm` and `ffmpeg` are on
`PATH`. The CLI itself runs on Node; only the `bin/video` wrapper needs a
POSIX shell.

---

## 2. Installation

### 2.1 From a clone of this repository

From the repository root:

```bash
pnpm install
pnpm run build
```

The build (`tsc -b`) compiles all workspace packages into `packages/*/dist`.
`pnpm install` also links the workspace packages, so `@video/cli` resolves
`@video/*` without publishing.

### 2.2 Reaching the CLI

The CLI runs from its compiled entry point:

```bash
node packages/cli/dist/index.js --help
```

For a shorter command in the current shell, define an alias:

```bash
alias video='node packages/cli/dist/index.js'
```

Every example in [`docs/USAGE.md`](./USAGE.md) assumes that alias is active.

The repository also ships a wrapper for agentic shells and automation, which
forwards every verb to the same CLI:

```bash
bin/video --help
```

### 2.3 The git hook (prompt-eval gate)

The repository carries a pre-push hook that scores the prompt golden set
before any push that touches `packages/prompts/`:

```bash
git config core.hooksPath .githooks
```

The hook is inert until that line is set. Layer 1 (structural: prompt
fingerprint + orphan guard) is offline and sub-second; layer 2 (rubric judge)
runs only when `PROMPT_EVAL_JUDGE=1` is set and `GLM_API_KEY` is present
(~5 min). A failing eval blocks the push — see
[Troubleshooting](#8-setup-troubleshooting) for the recovery commands.

### 2.4 Installing the published package

The npm package is a **single bundled binary**: all 28 workspace packages
are inlined into one file, so there is one name to install and no
dependency graph to track.

```bash
npm install -g @video/cli
video --help
```

What the tarball carries (1.3 MB packed):

| Path | What |
| --- | --- |
| `cli.js` | the bundle — every `@video/*` package inlined |
| `vendor/Root.js` | the Remotion Root the render entry imports by path |
| `vendor/node_modules/@video/…` | what `Root.js` imports at runtime |
| `prompts/` | the prompt bodies the agents load by name |
| `assets/scripts/` | the python helpers the pipeline shells out to |
| `assets/{media-generators,tts}/python/` | the image/TTS helpers |
| `assets/config/llm.yaml` | every model id and provider role (§3.4) |
| `evals/` | the prompt golden set (`video prompts eval` works installed) |

Third-party dependencies (remotion, react, zod, undici, …) stay external
and are installed by npm.

Two things the package does **not** carry: the curated BGM library
(`assets/bgm/`, 171 MB — use `--bgm-dir`, or clone the repo) and the
Remotion Studio workflow (`video studio` needs the source checkout).

### 2.5 Global installation

After the `@video/*` packages have been published, install the CLI globally:

```bash
pnpm add --global @video/cli
video --help
```

The global package contains the CLI and its runtime dependencies. It does
not create files in its installation directory. Projects are created in the
current working directory, or below the directory passed with `--cwd`:

```bash
mkdir my-video-projects
cd my-video-projects
video new demo
```

### 2.6 Local development

Link the workspace CLI instead of publishing it:

```bash
pnpm run build
cd packages/cli && pnpm link --global
video --help
```

After any source change, rebuild before using the CLI:

```bash
pnpm run build
```

---

## 3. Provider keys and secrets

Credentials live in the **environment**, never in a committed file. A
committed key is a defect — the test suite greps for it.

| Key | Unlocks | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | generator pool, images (`--image-provider openai`) | model ids in `config/llm.yaml`; chat also honors `OPENAI_MODEL` |
| `GEMINI_API_KEY` | generator pool, images (`--image-provider gemini`) | model ids in `config/llm.yaml`; chat also honors `GEMINI_MODEL` |
| `GLM_API_KEY` | generator pool, research fallback | model ids in `config/llm.yaml` |
| `MINIMAX_API_KEY` | **the judge**, images (default provider), BGM (`--music-provider`), TTS (`minimax-system`), web search | model ids in `config/llm.yaml` |

**The draft generator pool** (owner rule, 2026-11-21): `video draft` picks a
generator at random from **OpenAI / Gemini / GLM** — whichever hold a key —
and the **judge is always MiniMax**, so the grader never reads its own prose.
`--model <name>` pins one generator; `--model auto` asks for the pool
explicitly. A pool-picked generator falls back to another pool member on a
quota error.

Set the keys in the shell that launches the CLI, or keep them in a private
file and source it:

```bash
export OPENAI_API_KEY=... GEMINI_API_KEY=... GLM_API_KEY=... MINIMAX_API_KEY=...
```

### 3.1 Secrets directory

Machine-local credentials live under `~/.config/secrets/` (git-ignored):

| File | Used by |
| --- | --- |
| `client_secret_youtube.json` | YouTube uploads — or point `YOUTUBE_CLIENT_SECRET_FILE` elsewhere |
| `ai.env` | a local env file for the keys above |
| `biliup-cookies.json` | Bilibili uploads (via `biliup`) |

### 3.2 Publishing credentials (all optional)

The pipeline renders and mixes without any of these; only publishing needs
them.

| Platform | Credential | How to get it |
| --- | --- | --- |
| YouTube | `YOUTUBE_REFRESH_TOKEN` + client secret | [YouTube authorization](USAGE.md#youtube-authorization) for setup, token renewal, and consent timeouts |
| Bilibili | `biliup` cookies | `~/.config/secrets/biliup-cookies.json`; the uploader runs from `~/.venvs/biliup/bin/python` |
| Douyin | `DOUYIN_ACCESS_TOKEN` | 抖音开放平台 app (needs review). Without it the command packages the metadata and a manual checklist |
| Zhihu | — | no API: manual upload from `bilibili/ZHIHU-KIT.md` (the scripted attempt was shelved 2026-11-15) |

YouTube uploads land **private** (testing-mode OAuth apps lock them); making
one public is a human decision in YouTube Studio.

### 3.3 The fully offline render path

Rendering itself needs no key. With a project that already has
`article.md` and `audio-config.yaml`, the whole render runs offline:

```bash
video make "<topic>" --fake   # silent TTS placeholders, no images, no network
```

`--fake` is the offline render path: mock TTS, no image generation, no
provider calls. Writing the article still needs a generator — one of the
pool keys above — unless you supply `article.md` by hand.

### 3.4 Model ids and provider roles — `config/llm.yaml`

Every model id the pipeline serves, and which provider each role calls,
lives in **`config/llm.yaml`** — one file, no built-in copies. Retiring or
renaming a model is an edit there; the providers read it when they start.

```yaml
roles:
  review: { primary: glm, fallback: minimax } # which provider a role calls
models:
  chat:
    openai: gpt-6.1-sol # which model id it serves
  tts:
    minimax: speech-2.8-hd
```

Kinds: `chat` (draft pool, judge, research, scripts, storyboards, reviews),
`decision` (the typed Decisions APIs — a different endpoint with different
model ids), `image`, `video`, `tts`.

Precedence, highest first: a per-call `model` option → `OPENAI_MODEL` /
`GEMINI_MODEL` (chat only) → an override file → `config/llm.yaml`. Point
`LL_CONFIG` at another YAML file to override without editing the repo copy;
it replaces only the keys it names, so a file holding just
`models.chat.openai:` changes that one id.

A missing or blank id is never defaulted: the provider throws
`no model id for <kind>/<provider>` and names the file to fix. A malformed
file is reported with the offending key (`models.chats: Invalid enum
value`) and never applied in part. An installed package carries the file at
`assets/config/llm.yaml` — set `LL_CONFIG` to override it.

---

## 4. Optional local components

### 4.1 The nightly auto-producer (macOS)

`video backlog` keeps an idea store and can produce films on a schedule via
launchd:

```bash
video backlog schedule --install --kind auto    # nightly 01:00/03:00/05:00 producer
video backlog schedule --status
video backlog schedule --remove
```

The weekly idea harvest uses `--kind harvest` (the default). The producer
picks the judge's top-ranked idea when MiniMax is idle and quota allows, and
records every stage in `runs/`.

### 4.2 Local TTS clones (voicebox / f5tts)

`video draft` offers a local narration backend when the server is running:

```bash
video draft "<topic>" --tts voicebox:narrator-zh
```

`--tts minimax-system` (the default) needs no local server and is the
better-sounding option.

---

## 5. Publishing this repository (maintainers)

The publishable artifact is the bundled CLI:

```bash
pnpm run build:bundle    # tsc -b + esbuild bundle → packages/cli/dist-bundle/
pnpm run pack:cli       # the same, then npm pack → video-cli-<version>.tgz
pnpm run publish:cli    # the same, then npm publish --access public
```

The bundle inlines every `@video/*` package, keeps the third-party
dependencies external (npm installs them), vendors the runtime files the
inlined packages read from disk (the Remotion Root, the prompt bodies,
the python helpers), and drops the compiled test files. `pnpm publish
--dry-run` in `packages/cli/dist-bundle` shows exactly what would ship.

Release flow: bump `packages/cli/package.json` → `pnpm run build:bundle` →
`npm publish --access public` → tag `v<version>` → attach the tarball to
the GitHub Release → update `docs/RELEASES.md`.

The npm scope `@video` is **not reserved**: a plain user scope is
first-come per package name. Publish the CLI name early, or move to an
npm org to actually own the scope.

---

## 6. Verify the installation

Run the type check and the test suite:

```bash
pnpm run build
pnpm test
```

The other project checks:

```bash
pnpm run lint
pnpm run format:check
pnpm run benchmark:verify
pnpm run acceptance
pnpm run prompts:eval          # offline layer: prompt fingerprints + snapshots
pnpm run prompts:eval:judge    # rubric layer: needs GLM_API_KEY, ~5 min
```

`benchmark:verify` and `acceptance` render video, so they require FFmpeg,
ffprobe, and a working local Remotion renderer. Some provider integration
tests require local loopback sockets and are not a substitute for live API
testing.

A successful install ends with all eleven acceptance checks passing:

```text
ALL 11 §62.4 acceptance checks passed
```

---

## 7. Agent-harness adapters (v0.4.1)

The `video` CLI is the **stable harness-agnostic surface**. The repository
ships adapter files for the harnesses it officially supports; every adapter
forwards to `video` (or to `bin/video`, a thin shell wrapper).

### 7.1 Shell wrapper — `bin/video`

Forwards every verb to `video`, so any shell, Makefile, or CI script can
drive the pipeline with one binary. No harness required.

### 7.2 OpenCode — `.opencode/command/video.md`

OpenCode, Cursor, Claude Code, and similar agentic harnesses that look up
`.opencode/command/*.md` pick up `/video` as a slash command. The file uses
OpenCode's frontmatter (`description`, `tools`) and a markdown body listing
every verb, the canonical pipeline order, and the critical invariants (never
auto-approve, credentials stay in env, fail loudly).

### 7.3 pi / oh-my-pi — `.omp/commands/video.md`

The `oh-my-pi` coding agent (`@oh-my-pi/pi-coding-agent`, `omp.sh`)
discovers native slash commands under `<cwd>/.omp/commands/*.md`. The
repository ships `.omp/commands/video.md` with the OMP-native frontmatter
(`name`, `description`) and the same canonical pipeline and invariants body.
Inside an `omp` interactive session the user types the slash command, and
its arguments map verbatim to the CLI's arguments.

The command body uses `$ARGUMENTS`, so the slash input passes through
unchanged. Permissions default to `read: allow, write/edit/bash: ask` (in
`.omp/settings.json`) to preserve the human-gate principle — the agent can
read freely but must ask before mutating anything.

#### Skills in OMP

`.agents/skills/<name>/SKILL.md` is the canonical skill source (the lock
file is `.omp/skills-lock.json`). For OMP, `.omp/skills/<name>/SKILL.md` are
symlinks that resolve to the canonical files — `readlink -f
.omp/skills/<name>/SKILL.md` shows the canonical path. `.omp/settings.json`
points `skills.customDirectories` at `.omp/skills` so OMP's native provider
picks them up alongside any others.

To install a new skill, add it to the canonical `.agents/skills` directory,
then verify the symlink exists at `.omp/skills/<new-skill-name>/SKILL.md`.
Add it manually if the installer did not create one — there is a single
symlink per skill. Claude Code reads the same canonical skills from
`.claude/skills`.

### 7.4 Why there is no auto-approval

Per `docs/workflow.md`, the workflow enforces a human gate between every
generator step and the next. Whether the caller is OpenCode, OMP, or a human
at a terminal, the agent invokes the drafting verbs and surfaces the
artifacts; the human reads and approves before the preview ever touches the
render path.

### 7.5 Adding a new harness

1. Create the harness-specific command file under the directory it expects
   (`.opencode/command/`, `.omp/commands/`, `.claude/commands/`,
   `.gemini/commands/`, `.codex/commands/`).
2. Use that harness's native frontmatter shape.
3. Document the expansion pattern (`$ARGUMENTS` for OMP, positional for
   OpenCode and Claude) in the body.
4. The CLI stays the source of truth — never duplicate verb logic in the
   adapter file.

---

## 8. Setup troubleshooting

### FFmpeg or ffprobe not found

The render path needs both binaries on `PATH`. Install with the package
manager for your platform (`brew install ffmpeg` on macOS,
`apt-get install -y ffmpeg` on Debian and Ubuntu), then reopen the shell so
the new `PATH` takes effect.

### `packages/cli/dist/index.js` not found

The CLI has not been built yet. Run `pnpm run build` from the repository
root. This is also the fix after any source change — the compiled output is
what the CLI runs.

### A draft says "no key" or picks no generator

The generator pool needs at least one of `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `GLM_API_KEY`; the judge needs `MINIMAX_API_KEY`. Confirm
the variables are exported in the shell that launches the CLI — they are
read from the environment, never from a file. The run log prints the pick:

```text
  generator: gemini (pool: openai, gemini, glm) · judge: minimax
```

### A provider key is set but calls still fail

Check the provider's quota — a 429, 402, or 403 triggers the automatic
fallback to another pool member, and the provider that actually served is
recorded in `runs/<run-id>.yaml`. If the model id is the problem (a model
retired or renamed), change it in `config/llm.yaml` (§3.4) — or, for chat
only, set `OPENAI_MODEL` / `GEMINI_MODEL`.

### The pre-push hook blocks the push

`pre-push: prompt evals FAILED — not pushing` means the prompt golden set
drifted. Read the judge comment first: every axis minimum is calibrated to
a measured floor, not a target, so a lone sub-floor score can be judge
variance. Then:

```bash
pnpm run prompts:eval                       # layer 1: what actually failed
node packages/cli/dist/index.js prompts eval --update-snapshots        # re-record layer 1
node packages/cli/dist/index.js prompts eval --judge glm --update-recorded  # re-record layer 2
```

Re-record only when the prompt change was deliberate; otherwise revert it.
`git push --no-verify` bypasses the hook knowingly.

### The nightly producer holds a stale lock

`backlog status` reports `owner pid … is DEAD — lock is stale`. The next
scheduled fire takes it over; delete `runs/backlog-auto.lock` to release it
now.

### Disk usage grows fast

`node_modules` and the Remotion bundler cache are the usual culprits. The
renderer disables Remotion's persistent webpack cache in the bundler
options, because leaving it on leaks tens of gigabytes. Remove
`packages/video-renderer/.studio` and any `scenes-draft/` directory to
reclaim space.

### A Bilibili or Douyin upload does not happen

Both are non-fatal by design. Bilibili needs the `biliup` virtualenv and
cookies (see §3.2); without them the command stops after packaging. Douyin
without `DOUYIN_ACCESS_TOKEN` produces the package plus a manual checklist
instead of uploading. The artefacts are in `projects/<slug>/bilibili/` and
`projects/<slug>/douyin/`.

---

## Next

Installation is done. Continue with [`docs/USAGE.md`](./USAGE.md) to make
a video.
