# AI Video Factory — Installation

Everything needed to get the AI Video Factory running on a machine.

- **You want to make a video?** → [`docs/USAGE.md`](./USAGE.md)
- **You want to understand the system?** → [`docs/architecture.md`](./architecture.md)
- **You want the storyboard format?** → [`docs/schema.md`](./schema.md)

This document covers: requirements, installation, verification, and the
optional agent-harness adapters.

---

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

---

## 2. Installation

### 2.1 From a clone of this repository

From the repository root:

```bash
pnpm install
pnpm run build
```

The build compiles all workspace packages into `packages/*/dist`.

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

### 2.3 Global installation

After the `@video/*` packages have been published, install the CLI globally:

```bash
npm install --global @video/cli
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

### 2.4 Local development

Link the workspace CLI instead of publishing it:

```bash
npm run build
npm link --workspace @video/cli
video --help
```

After any source change, rebuild before using the CLI:

```bash
npm run build
```

---

## 3. Verify the installation

Run the type check and the test suite:

```bash
npm run build
pnpm test
```

The other project checks:

```bash
pnpm run lint
pnpm run format:check
npm run benchmark:verify
pnpm run acceptance
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

## 4. Agent-harness adapters (v0.4.1)

The `video` CLI is the **stable harness-agnostic surface**. The repository
ships adapter files for the harnesses it officially supports; every adapter
forwards to `video` (or to `bin/video`, a thin shell wrapper).

### 4.1 Shell wrapper — `bin/video`

Forwards every verb to `video`, so any shell, Makefile, or CI script can
drive the pipeline with one binary. No harness required.

### 4.2 OpenCode — `.opencode/command/video.md`

OpenCode, Cursor, Claude Code, and similar agentic harnesses that look up
`.opencode/command/*.md` pick up `/video` as a slash command. The file uses
OpenCode's frontmatter (`description`, `tools`) and a markdown body listing
every verb, the canonical pipeline order, and the critical invariants (never
auto-approve, credentials stay in env, fail loudly).

### 4.3 pi / oh-my-pi — `.omp/commands/video.md`

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

`.agents/skills/<name>/SKILL.md` is the canonical skill source (per
`skills-lock.json`). For OMP, `.omp/skills/<name>/SKILL.md` are symlinks
that resolve to the canonical files — `readlink -f
.omp/skills/<name>/SKILL.md` shows the canonical path. `.omp/settings.json`
points `skills.customDirectories` at `.omp/skills` so OMP's native provider
picks them up alongside any others.

To install a new skill, add it to the canonical `.agents/skills` directory,
then verify the symlink exists at `.omp/skills/<new-skill-name>/SKILL.md`.
Add it manually if the installer did not create one — there is a single
symlink per skill.

### 4.4 Why there is no auto-approval

Per `docs/workflow.md`, the workflow enforces a human gate between every
generator step and the next. Whether the caller is OpenCode, OMP, or a human
at a terminal, the agent invokes the drafting verbs and surfaces the
artifacts; the human reads and approves before the preview ever touches the
render path.

### 4.5 Adding a new harness

1. Create the harness-specific command file under the directory it expects
   (`.opencode/commands/`, `.omp/commands/`, `.claude/commands/`,
   `.gemini/commands/`, `.codex/commands/`).
2. Use that harness's native frontmatter shape.
3. Document the expansion pattern (`$ARGUMENTS` for OMP, positional for
   OpenCode and Claude) in the body.
4. The CLI stays the source of truth — never duplicate verb logic in the
   adapter file.

---

## 5. Setup troubleshooting

### FFmpeg or ffprobe not found

The render path needs both binaries on `PATH`. Install with the package
manager for your platform (`brew install ffmpeg` on macOS,
`apt-get install -y ffmpeg` on Debian and Ubuntu), then reopen the shell so
the new `PATH` takes effect.

### `packages/cli/dist/index.js` not found

The CLI has not been built yet. Run `pnpm run build` from the repository
root. This is also the fix after any source change — the compiled output is
what the CLI runs.

### Missing MiniMax or GLM key

The AI commands (`video draft`, `video research`, `video script`) need a
provider key in the environment. Set `GLM_API_KEY` or `MINIMAX_API_KEY`
before running them. The local render path does not need a key — see
[`docs/USAGE.md`](./USAGE.md) for the fully offline route.

### A provider key is set but calls still fail

Keys are read from the shell environment, never from a committed file.
Confirm the variable is exported in the shell that launches the CLI, and
check the provider's quota — a 429, 402, or 403 triggers the automatic
fallback to the secondary provider, and the provider that actually served
is recorded in `runs/<run-id>.yaml`.

### Disk usage grows fast

`node_modules` and the Remotion bundler cache are the usual culprits. The
renderer disables Remotion's persistent webpack cache in the bundler
options, because leaving it on leaks tens of gigabytes. Remove
`packages/video-renderer/.studio` and any `scenes-draft/` directory to
reclaim space.

---

## Next

Installation is done. Continue with [`docs/USAGE.md`](./USAGE.md) to make
a video.
