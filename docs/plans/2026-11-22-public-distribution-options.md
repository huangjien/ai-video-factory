# Public distribution — where this pipeline should be installable from

**Date:** 2026-11-22
**Status:** decision memo (no code changed yet)
**Question:** where do we publish so that other people can install the AI Video Factory?

---

## 1. Where things stand today (measured)

| Fact | Evidence |
| --- | --- |
| The GitHub repo is **public** | `api.github.com/repos/huangjien/ai-video-factory` → `visibility: public`, 0 stars, 0 forks |
| **No LICENSE file** | `ls LICENSE*` → nothing. Default = all rights reserved: outsiders may run it, but have no right to modify or redistribute it |
| Nothing is on npm | `npm view @video/cli` → E404 for every package; `npm whoami` → E401 (not logged in) |
| The npm scope `@video` is **unclaimed** | `/-/org/video` → 404, `/-/user/video` → 404 |
| 28 packages are publishable | every `packages/*/package.json` has `publishConfig.access: public` and `files: ["dist"]` |
| The CLI tarball is small but noisy | `npm publish --dry-run` (in `packages/cli`): 487.3 kB packed / 2.4 MB unpacked / **545 files** — the compiled `*.test.js` files ship too |
| The published CLI would need 13 `@video/*` deps | `packages/cli/package.json` dependencies are all workspace packages |
| 3 GitHub releases exist, **0 assets** | `v0.11`, `v0.11.1`, `v0.11.2` — tags only, nothing downloadable |
| The repo is not bloated by generated media | `projects/*` is gitignored except a small benchmark fixture; `.git` is 214 MB (history) |

Install requirements today: **Node ≥ 22, pnpm 12, FFmpeg + ffprobe**, plus a
headless Chrome that Remotion downloads on first render. Provider keys are
optional for rendering (`--fake` is fully offline) but needed to write an
article.

---

## 2. What "installable" has to mean

Three audiences, three different needs:

1. **A developer on another machine** — wants `npm i -g @video/cli` or a
   one-line installer, and `video --help` to work.
2. **A curious reader** — wants to clone and read; a release tarball is
   enough.
3. **A CI/batch user** — wants a container or a pinned version.

Any channel that works for (1) with the least ceremony also serves (2) via
the repo, so the real decision is: **npm with one package, or npm with 28,
or no registry at all.**

---

## 3. The options

| Channel | Install line | Effort | Risk | Fits (1) | Fits (2) | Fits (3) |
| --- | --- | --- | --- | --- | --- | --- |
| **A. npm, 28 packages** | `npm i -g @video/cli` | medium: login, scope, publish the whole graph in dependency order, keep versions in sync | 28 public names = 28 typosquat targets; `@video` scope is first-come, someone else can grab `@video/cli` before we do | ✓ | ✓ | ✓ |
| **B. npm, ONE bundled package** | `npm i -g @video/cli` | medium-high: add a bundling step (esbuild/ncc) that inlines the 13 workspace deps | one name to protect; the bundle must be rebuilt per release | ✓ | ✓ | ✓ |
| **C. GitHub Release tarball + install.sh** | `curl -fsSL …/install.sh \| sh` | low: pack a tarball per release, publish it as a release asset | no registry at all; users still need node/pnpm/ffmpeg | ✓ (script) | ✓ | ~ |
| **D. Homebrew tap** | `brew install --tap huangjien/tap ai-video-factory` | low-medium: a tap repo + one formula (wrapping A/B or C) | mac-only; formula must track releases | ✓ (mac) | ✓ | ~ |
| **E. Docker image** | `docker run … ai-video-factory` | medium: bake node+ffmpeg+Chrome; the image is ~1 GB | Chrome download at runtime unless baked; cache layers to manage | ~ | ~ | ✓ |
| **F. Clone + build (today)** | `git clone && pnpm i && pnpm build` | none | requires pnpm + a build step; not an "install" | ~ | ✓ | ~ |

**Rejected on the merits:** E alone (heavy, and the render path still needs a
browser); F alone (today's state — it is not installation); A (28 public
names is a squatting surface we do not need, and the dependency graph must
stay version-aligned across 28 packages forever).

---

## 4. Recommendation

**B + C, in that order, D later.**

1. **B — one bundled npm package** (`@video/cli`, or a scope you own). The
   installer gets one dependency-free tarball; the registry holds one name
   instead of 28; the dependency graph stops being a release chore. Keep the
   workspace split for development; the bundle is a release artifact.
2. **C — GitHub Release tarball + `install.sh`** as the no-registry fallback.
   It serves the curious (2), works behind a corporate npm proxy, and gives
   the Homebrew formula something to point at.
3. **D — a Homebrew tap** once (1) is proven, for the mac users.
4. **E — Docker** only when a CI user asks.

**Scope name:** `@video` is free but unreserved. A *user* scope is first-come
per package name — so publish the CLI name EARLY or pick a scope you control
(as an npm org: `@video-factory` / `@aivideofactory`). A dedicated org is the
only way to actually reserve the scope.

---

## 5. Blocking pre-work (nothing ships until these are done)

- [ ] **Add a LICENSE** (MIT or Apache-2.0). Without it, "others may install"
      is legally murky — this is the single most important item on the list.
- [ ] **Choose the scope** (org recommended) and `npm login` on the publishing
      machine.
- [ ] **Bundle the CLI** into one file for publishing (esbuild), or decide
      to publish the whole 28-package graph and accept the maintenance cost.
- [ ] **Keep test files out of the tarballs** — `files: ["dist"]` currently
      ships `dist/*.test.js` (545 files for a 2.4 MB package). Add an
      exclusion, e.g. `"files": ["dist", "!dist/**/*.test.*"]`.
- [ ] **Publish the `@video/*` internals as private, or rename them out of the
      public scope** — they are implementation detail, not products.
- [ ] **Install-time checks**: `install.sh` (and the npm postinstall note)
      should verify `node >= 22`, `ffmpeg`, `ffprobe` and print the Remotion
      Chrome note.
- [ ] **Release flow**: tag → `pnpm run build` → publish → attach the
      tarball to the GitHub Release → update `docs/RELEASES.md`. The three
      existing releases have no assets — attach them next time.
- [ ] **README install section** pointing at `docs/INSTALLATION.md`, plus a
      60-second “make a video” smoke path (`video draft` → `approve` →
      `make`) so a first-time user sees output before wiring keys.
- [ ] **Version policy**: the CLI version tracks `packages/cli/package.json`
      (0.11.2 today); publish under the same tag the GitHub Release uses.

## 6. Risks

- **Scope squatting**: without an org scope, someone can take `@video/cli`
  between now and publication. Cost of a mistake: a rename + a deprecation
  notice.
- **Bundle drift**: a bundled CLI must be rebuilt from the workspace on every
  release; a stale bundle ships old code. Wire it into the release script.
- **Chrome at render time**: Remotion downloads a headless Chrome on first
  render — mention it in the install notes, or bake it into the Docker image.
- **Keys are the user's job**: the pipeline is useful offline (`--fake`) but
  real films need a provider key; the README should say which key buys what.
- **No support promise**: publishing invites issues; the repo has no
  CONTRIBUTING/CODE_OF_CONDUCT. Optional, but expect the questions.
## 7. Decisions taken (2026-11-22)

1. **License: Apache-2.0** — `LICENSE` added (the authoritative text from
   apache.org), `license: "Apache-2.0"` on the root and all 28 package
   manifests, README licence section.
2. **Scope: `@video`** — unclaimed today; first-come per package name, so
   the CLI name should go out early.
3. **Package shape: one bundled package** — `scripts/build-bundle.mjs`
   inlines all 28 `@video/*` packages with esbuild, keeps the ten
   third-party deps external, vendors the runtime files the inlined
   packages read from disk (the Remotion `Root.js`, the prompt bodies, the
   python helpers, the eval fixtures, `config/llm.yaml`), and drops compiled
   test files. Result: **1.3 MB packed / 237 files** (the unbundled package
   was 545).
   Root scripts: `build:bundle`, `pack:cli`, `publish:cli`.
4. **Audience**: both — the npm package for installers, the public repo
   for readers (already public).

### What the real install test found (and fixed)

Installing the tarball into an empty directory surfaced three runtime
dependencies that a bundle silently breaks — each package reads files
relative to its own module directory:

| Dependency | Fix |
| --- | --- |
| the render entry imports `Root.js` by absolute path | `resolveRootSourcePath` probes the sibling **and** `vendor/`; the bundle vendors `Root.js` + `@video/video-components` + `@video/theme` |
| the agents load prompt bodies from `prompts/*.md` | `promptsDir()` probes both layouts; the bundle ships `prompts/` |
| the pipeline shells out to `scripts/*.py` | `resolveRepoScript()` probes `<cwd>/scripts/` **and** `assets/scripts/`; the bundle ships the four runtime scripts |

Verified end to end in a clean directory: `npm install <tarball>` → `video
--version` → `video new` → `video make --fake` → a real 16 s 1920×1080
30 fps MP4 with non-black frames.

### Still open (needs `npm login`)

- `npm login` on the publishing machine, then `pnpm run publish:cli`.
- Tag `v<version>`, attach the tarball to the GitHub Release (the three
  existing releases have no assets), update `docs/RELEASES.md`.

### Known gaps of the published package

- **The curated BGM library is not in it** (171 MB) — `--bgm-dir` or the
  repo clone.
- **`video studio` needs the source checkout** (the Remotion Studio
  workspace expects the package's own layout).
