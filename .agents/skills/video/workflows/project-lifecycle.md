# Project Lifecycle

## 默认四版本交付

除非用户另有说明，每个主题默认交付四个版本：中文横屏完整版、中文竖屏 Shorts、英文横屏完整版、英文竖屏 Shorts。先完成中文横屏主片，再从定稿翻译英文并制作英文横屏；中英文竖屏版分别从各自语言的横屏定稿改编，保留主张、关键证据和结论，按 150 秒编排，交付成片最多 180 秒。横屏完整版按内容需要讲清前因后果、论据和利弊，不为满足时长压缩观点。竖屏必须使用原生 9:16 构图，不裁切横屏画面。

## 2. Major commands

Minimal API (v0.3.9+ recommended) — two commands do the whole pipeline:

```bash
video draft "<topic>"   # LLM writes article.md + audio-config.yaml + derived storyboard.yaml
                        # quality gate: an LLM judge scores 8 dimensions × 24 indicators on a
                        # 0-100 weighted scale (bar: 90 = grade A; Critical risk flags fail
                        # regardless of score); below-bar drafts are regenerated with the
                        # judge's feedback (default 8 attempts, top-scoring candidate wins
                        # even if nothing passed; a judge failure degrades to accepting the
                        # draft unreviewed) → article-review.yaml sidecar. Implementation:
                        # packages/draft/src/article-review.ts (runScoredDraft).
                        # Flags: --no-review, --min-score <n>, --max-attempts <n>, --candidates <n> (parallel best-of-N; default auto: 2 for duration >= 240 s, else 1);
                        #         --ask/--no-ask (agent questions, §2.6), --bgm <tag|none>
                        # Generator pool (2026-11-21): the article (and the storyboard
                        # derived from it) is written by a RANDOM pick of openai|gemini|glm —
                        # whichever hold a key — so no two films fail the same way. The
                        # JUDGE stays minimax, so the grader never reads its own prose.
                        # --model <provider> pins one; --model auto asks for the pool.
                        # A pool-picked generator falls back to another pool member.
video make <project>    # TTS → audio assets → render scenes → mix → final-mixed.mp4
```

### The draft stage leaves a run record per model call

`video draft` used to write no run record at all — a 94-minute draft left
nothing but the article, and the time could only be reconstructed from file
mtimes. Now every model call writes one:

| File | What it records |
|---|---|
| `runs/draft-*.yaml` | the generation call |
| `runs/draft-judge-*.yaml` | the scoring call (often a different provider) |
| `runs/draft-audio-plan-*.yaml` | the audio plan call |

Each carries the serving `provider`, the `model`, the `tokens`, a real
`duration_ms` (not the `0` the other stages still write), and a `telemetry`
block: `requests`, `streams`, `headers_timeout_retries`,
`reasoning_tokens`.

`headers_timeout_retries > 0` means the client threw a request away and
re-issued it — the failure mode that used to double every long call. On a
healthy run it is 0: `packages/llm/src/http.ts` gives the shared undici pool
a 40-minute header wait, so a slow completion is no longer killed at 300 s
and started over. `LLM_HTTP_TIMEOUT_MS` shortens that ceiling if you want a
faster failure.

`reasoning_tokens` is the other half of the story: on a reasoning model the
hidden thinking is usually most of the output. The **judge** asks for none
(MiniMax-M3 then skips thinking entirely — measured: 31,916 output tokens /
161 s → 1,692 tokens / 9.5 s for the same scorecard), and the **draft keeps
its** — without it the article comes out half-length.

Full command set:

| Command | Purpose |
|---|---|
| `video new <id>` | Scaffold `projects/<id>/` |
| `video draft <topic>` | Generate `article.md` + `audio-config.yaml` + derived `storyboard.yaml` (LLM) |
| `video script <topic>` | Narration script only |
| `video storyboard <topic>` | VDSL storyboard only |
| `video audio-plan <project>` | Voice / BGM / SFX plan |
| `video audio <project>` | TTS narration |
| `video audio-asset <project>` | BGM + SFX |
| `video make <project>` | Full render: TTS → assets → scenes → mix → `final-mixed.mp4` |
| `video preview <project>` | Fast preview render |
| `video review <project>` | LLM review (content / visual / technical) |
| `video revise <project>` | Apply the review's findings as a targeted article edit (no full rewrite) |
| `video approve [stage] <project>` | Approve a stage |
| `video reject <project> <reason>` | Reject current stage |
| `video final <project>` | Final mixed MP4 with narration + BGM + SFX |
| `video validate <storyboard.yaml>` | VDSL schema check |
| `video status [project]` | Pipeline state |
| `video thumbnail <project>` | YouTube thumbnail (MiniMax image) — auto-branded: 朱红 canvas border + top-left mascot badge via `scripts/thumbnail-brand.py` + `brand.yaml` `brand.thumbnail` (configurable: colors, widths, diameter) |
| `video shorts <project>` | Shorts package from the final master (default: the whole film — hook through payoff; `--duration N` cuts a scene-aligned teaser; `--provider minimax` generates an AI teaser from thumbnail + shorts-hook). Aspect-aware — a landscape master is shown whole over a blurred vertical backdrop; a vertical master is kept whole (remux) or trimmed |
| `video vertical <project>` | Derives a native 1080×1920 edition from the landscape article. When its target or summed scene durations exceed 180 s, adapts the script to a 150 s target. Checks the rendered `vertical/output/final-mixed.mp4` against the 180 s limit. |
| `video youtube <project>` | Title / description / chapters / shorts hook; `--upload` publishes final-mixed.mp4 + thumbnail directly (OAuth: `video youtube --auth` once, then `--privacy private\|unlisted\|public`, default private) |
| `video douyin <project>` | 抖音 (Douyin) submission metadata: title / 文案 / ≤5 话题 / cover prompt → `douyin/package.yaml` + `CHECKLIST.md`, PLUS a vertical 1080×1920 cut of the film at `douyin/video.mp4` (`--cut-mode inset` = blurred backdrop, nothing cropped — the default; `--cut-mode crop` = fills the screen, loses ~43% of the width). `--upload` publishes through the official 开放平台 API and needs `client_key`/`client_secret` in `~/.config/secrets/douyin-client-secret.json` + `DOUYIN_ACCESS_TOKEN` in `~/.config/secrets/ai.env`; without them it stops at the packaging and writes the manual checklist. |
| `video bilibili <project>` | Bilibili submission metadata: title / 简介 / ≤10 tags / suggested 分区 / cover prompt → `bilibili/package.yaml` + `CHECKLIST.md`. Never hard-fails: a bad model response degrades to a deterministic package with a warning. **Upload is automated**: `python3 scripts/bilibili-upload.py <project>` (stream_gears + cookie login at `~/.config/secrets/biliup-cookies.json`, ~30-day expiry → `--login` re-scans the QR; `--dry-run` prints the submission fields; 分区 tid mapping built in, `--tid` overrides). Verified 2026-11-04: 军种与兵种的组织文化 → BV1EExQ6GEUj in 36 s. EN videos: use `--standalone --video … --title … --desc … --tag … --tid …`. |
| `video visuals <project>` | v0.8: generate scene images + contact sheet for review (gate off by default) |
| `video research <topic>` | Facts + sources + claims package (feeds draft) |
| `video motion <project>` | Per-scene animation timelines (agent + heuristics) |
| `video mix <project>` | ffmpeg mix only (BGM + narration + SFX) |
| `video qa <project>` | Render report + contact sheet |
| `video scene <project> list/restore/approve` | Per-scene version store |
| `video excalidraw <project>` | `.excalidraw` asset → animated SVG |
| `video studio <project>` | Remotion Studio live-preview workspace |
| `video theme [name]` | Palette inspector (list / one / resolve project) |
| `video character [list \| approve <id> <style> <version> --by <name>]` | Character bible: list the characters and their per-style reference sheets, or promote a candidate to the official sheet (stamps the reviewer, supersedes the previous one) |
| `video learn <project>` | Human-review learning loop (`--ask`/`--answer`/`--status`/`--propose`) |
| `video backlog add/list/approve/drop/reset` | Idea store at repo-root `backlog.yaml` (`add` runs an overlap preflight vs `projects/<id>/article.md`, `--force` overrules) |
| `video backlog harvest` | LLM extracts candidate topics from `docs/plans/` + `learnings/` → `proposed` entries (dedup; overlap hits flag the note, approve decides; `--dry-run` writes nothing) |
| `video backlog judge` | One batched LLM ranking of open ideas, fed the channel's latest analytics report; writes one rolling `runs/backlog-judge.yaml` snapshot whose fingerprint covers prompt inputs and provider route |
| `video backlog auto` | Uses only a complete ranking whose fingerprint matches current inputs; missing/stale cache triggers judge, and judge failure or concurrent backlog changes stop the run. Spare-capacity producer: MiniMax idle ≥1h + both Token Plan windows ≥80% → judge's top idea becomes zh+en landscape MP4s + separate zh+en vertical Shorts and AUTO-PUBLISHES (bilibili zh+en public; YouTube zh+en+Shorts private; publish failure non-fatal; TikTok lane reserved; zhihu stays manual); nightly launchd (01:00/03:00/05:00) via `--install-scheduler`; refuses while an idea is stuck mid-pipeline |
| `video backlog status` | One screen: scheduler state, live lock, per-entry stage checklist with the continue command, failed runs — nothing writes |
| `video backlog stats` | Derived hit-rate join: idea → project → article / final-mixed.mp4 / `bilibili/bvid.txt` |
| `video backlog schedule` | Weekly launchd auto-harvest (`--install`/`--remove`/`--status`, `VIDEO_ASK=off`); `--kind auto` switches to the 10-minute auto-producer |
| `video prompts [show <name>]` | Inspect the central prompt registry (`packages/prompts/prompts/`) |

Every command accepts `--cwd <dir>` (default `projects/`). Every step writes `runs/<id>.yaml` and updates `state.yaml`.

### Picking from the backlog (`video draft --from-backlog <id>`, 2026-11-18)

`video draft --from-backlog <id>` drafts a stored idea: the entry's topic
names the project, its optional long `content` reaches the drafter as
idea-seed context (same channel as `--file`), the entry is stamped
`drafting` before the paid call and `drafted` + project backlink on
success — a failure or the ask gate's exit 2 reverts the stamp. Status
lifecycle `proposed → idea → drafting → drafted | dropped` lives in
`backlog.yaml`; `video backlog reset <id>` recovers a crash. Design:
`docs/plans/2026-11-18-backlog-feature-design.md`.

### Zhihu companion upload (Chinese videos, standing rule 2026-11-15)

When a CHINESE video is submitted to bilibili, also hand the owner a Zhihu
manual-upload kit in the same session — the owner asked for this as a
standing convention. Zhihu exposes no upload API.

1. Reuse `bilibili/package.yaml` fields as-is — title / 简介 / tags / cover
   (`youtube/thumbnail.jpg`) all transfer to Zhihu unchanged, plus
   `output/final-mixed.mp4` (Zhihu accepts 1080p MP4 ≤4h ≤20GB; no
   transcode needed). Entry: zhihu.com → 创作中心 → 发视频.
2. Suggest answering an existing AI失业/结构性失业 question with the video
   via 视频回答 — question pages carry long-tail search traffic the video
   feed does not.
3. EN videos are exempt — the owner asked only for Chinese ones.

**Automation shelved 2026-11-15** (owner canceled after ~8 failed
iterations). What worked: storage_state login (z_c0 is a session cookie —
导出 storage_state 才能跨进程存活), navigating to `www.zhihu.com/upload-video`
(creator.zhihu.com 不存在；发视频入口在新标签页打开该 URL)。What did NOT:
after file-chooser set_files the app hashes the file (blob reads) and gets
`oauth/sign_in` token + `creator/rights is_pass=true`, then **silently never
issues the upload request** — no error, no toast; real Chrome
(channel=chrome), hiding navigator.webdriver, headed mode all ineffective.
Forensics: `projects/<id>/bilibili/zhihu-debug/`;参考脚本
`scripts/zhihu-upload.py`（登录与字段解析可用，发布流程不可用）。

### Channel profiles are the narrative-grammar extension point (zero code)

Cross-video story grammar — narrator voice, pacing, arc, plot engine —
extends via channel-profile prompt block PAIRS in `packages/prompts/prompts/`:
`draft-<profile>.md` (drafter rules) + `review-<profile>.md` (judge
criteria), appended only when the article declares the profile. Zero
TypeScript. Rules: judge criteria live in the profile's review block, never
the global judge prompt (findings cost regeneration cycles — scope them);
story-shape changes never touch storyboard generation (`article.md` is the
source of truth, the storyboard re-derives); keep vocabulary consistent
with published films (the seven plot engines in `chinese-storybook` reuse
the naming from `projects/故事的7种基本情节`). Workflow: edit the pair → pin
new content with `toContain` tests in
`packages/draft/src/channel-profile.test.ts` → `pnpm build` → smoke
`video prompts show <block>`.


## 2.5 Branding & marketing (root `brand.yaml`)

Branding lives at the WORKSPACE root — `<repo>/brand.yaml` + `<repo>/assets/brand/*` — and EVERY project inherits it automatically at render time (preview / final / make). Override per project by dropping `projects/<id>/brand.yaml` (per top-level key; a project `intro:` replaces the root `intro:` wholesale). Paths resolve relative to the brand.yaml that declared them.

```yaml
# <repo>/brand.yaml  (shipped default: name "AI 视频工厂" + placeholder icon)
brand:
  name: "我的频道"              # shown in the intro band
  icon: assets/brand/icon.png   # corner watermark on EVERY scene (png/jpg/svg)
  corner: bottom-right          # top-left|top-right|bottom-left|bottom-right
  size_px: 72                   # at 1080p; scales with composition width
  opacity: 0.85
  intro:                        # fixed branded opening (omit = no intro chrome)
    duration_sec: 15            # 10-20s is the marketing norm
    background: aurora          # aurora|sunset|ocean|citrus
    show_name: true
```

Multi-BGM — different music for the opening vs the body, in `audio-config.yaml` (overrides `bgm`; `track` = named tag generated like `bgm`, or a file path resolved project-first then workspace-root — shared brand audio lives in `<repo>/assets/brand/`; `until_sec` = absolute window end, last entry runs to the end):

**BGM comes from a local library, never a service.** `assets/bgm/` holds the
curated tracks (`<mood>-<slug>.mp3` + a sibling `.license.txt`); `music.json` is
its index, carrying each track's real duration/LUFS/dynamic-range plus scenario
notes. `bgm: <tag>` in `audio-config.yaml` resolves against the project's own
`assets/audio-assets/bgm/` first, then `assets/bgm/`, then `assets/brand/`; an
unresolvable tag warns and mixes silence rather than failing the render. The
file is handed to ffmpeg in place — it is never copied per project. Track it
shorter than the runtime and it loops, so prefer `needs_loop_under_300s: false`
for long videos; the mixer applies one fixed bed level, so avoid
`quiet_master` tracks that would vanish under narration.

`bgm_tracks` still works for multi-window timelines; path-shaped `track` values
resolve project-first then workspace-root.

```yaml
bgm_tracks:
  - { track: calm, until_sec: 18 }   # branded opening mood
  - { track: epic }                  # rest of the video
```

Windows crossfade (1s) into one timeline wav (`assets/audio-assets/bgm/_timeline.wav`), then mix through the normal ducker/fades.


## 2.6 Agent question protocol (video-ask/1, v0.7)

Inside an agent harness (zcode, Claude Code, opencode, pi, OMP), `video draft` auto-detects the agent and — when any style knob was left unspecified — prints a question set to stdout and exits 2 instead of burning a full scored draft on silent defaults (`zh-CN`, 360 s, `flat-vector`, `paper-light`, `calm`). Exit 2 means the run did NOT start: zero spend, zero files written.

| Exit | Meaning |
|---|---|
| 0 | ran |
| 1 | failure (unchanged) |
| 2 | questions pending — run not started, nothing spent |

In the ask path stdout is pure JSON (parseable with `jq`); human-readable hints go to stderr. Questions are only ever asked for knobs the caller did not explicitly pass — a fully flagged replay never exits 2, even inside an agent session.

Rules:

1. On `video draft` exit 2: parse stdout as JSON; dispatch on `protocol === "video-ask/1"`.
2. Present the **recommended option first, labeled "(Recommended)"**; render each choice's `note` as its description. Never bury the recommendation.
3. The agent may replace the static recommendation with a topic-aware pick when the topic clearly demands it (e.g. 鸿门宴 → `liubang-xiaodiao` + `editorial`) and MUST state the reason in the question text. The CLI stays deterministic; the agent, which knows the topic, owns the final highlight.
4. **Render as a clickable UI whenever the harness has one — never as prose tables.**
   - **OpenCode ≥1.19**: relay ALL questions through the native `question` tool
     (one call, up to 6 questions — no batching needed). Map each video-ask
     question to `{header: <id>, question: <question>, options: choices.map(c =>
     ({label: c.value, description: c.note}))}`; put the recommended value
     FIRST with its description prefixed `(Recommended) — `. For `duration`
     (number type), offer the `suggestions` as options. Execution pauses
     until the user clicks; map answers → flags, re-run. Requires
     `permission.question: "allow"` in opencode.json (set 2026-10-15) and
     the TUI client.
   - **zcode-style UIs (4-question limit)**: present in two batches —
     narration (`lang`, `duration`, `bgm`), then look-and-feel
     (`image_style`, `style`).
   - Text-table fallback is a LAST resort when no question UI exists at all.
5. Map answers → flags, re-run with the same topic. All knobs explicit → no second ask (normal run).
6. Unattended sub-runs (scripts the agent launches that call draft internally) pass `--no-ask`; headless cron/launchd shells set `VIDEO_ASK=off`.

Overrides: `--ask` / `--no-ask` flags; `VIDEO_ASK=force|off` env (unknown value → auto with a stderr warning).

Exit-2 shape (abbreviated):

```json
{
  "protocol": "video-ask/1",
  "command": ["draft", "鸿门宴"],
  "detected": "zcode (ZCODE_APP_VERSION)",
  "questions": [
    {
      "id": "lang", "flag": "--lang", "type": "choice",
      "question": "Narration language?",
      "choices": [
        { "value": "zh-CN", "note": "Chinese narration (repo default)" },
        { "value": "en-US", "note": "English narration" }
      ],
      "default": "zh-CN", "recommended": "zh-CN",
      "why": "a wrong guess costs a full regen (~4× one draft)"
    }
  ],
  "resolved": { "lang": "zh-CN", "duration": 360, "audience": "developers",
                "image_style": "flat-vector", "style": "paper-light", "bgm": "calm" }
}
```

`questions[]` holds one entry per unspecified knob (stable order: `lang`, `duration`, `image_style`, `image_provider`, `style`, `bgm`), each with `recommended`, `{value, note}` choices, and a `why`. `resolved` echoes the full effective config (explicit + defaults) — use it to show "keeping X" or to pass a complete flag set back.

Re-run pattern (all knobs explicit → no second ask):

```bash
video draft "<topic>" --lang zh-CN --duration 120 \
  --image-style editorial --image-provider minimax \
  --style paper-light --bgm guofeng
```

### The six knobs, and what each one buys

Ask about all of them. Each is a silent default today, and each one
wrong costs a paid re-render.

| Knob | Flag | Silent default | Why it is worth asking |
|---|---|---|---|
| `lang` | `--lang` | `zh-CN` | narration language drives every downstream prompt |
| `duration` | `--duration` | `360` | scene count scales with it |
| `image_style` | `--image-style` | `flat-vector` | taste call, unrecoverable post-render |
| `image_provider` | `--image-provider` | `minimax` | decides **cost** and visual character; every scene image re-spends when it changes |
| `style` | `--style` | `paper-light` | theme repaints every scene |
| `bgm` | `--bgm` | `calm` | generated per tag at make time |

`--image-provider <minimax|openai|gemini|mock|none>` and `--image-style`
both stamp into **`article.md` frontmatter** (`image_provider:` /
`image_style:`) — `article.md` is the durable source of truth, so
`video make` honors them without the flag being passed again.
Precedence: explicit `--image-provider` flag > `--fake` (⇒ `none`) >
frontmatter > `minimax`. An unrecognized frontmatter value falls back to
`minimax` rather than failing — `article.md` is hand-edited.

**`--style` does NOT stamp into the frontmatter — add `theme:` yourself.**
The draft command only writes the theme into the in-memory article it
uses to build `storyboard.yaml`, and `video make` re-derives the storyboard
from `article.md` on every run. A frontmatter with no `theme:` therefore
re-derives to the default `paper-light` and the theme you asked for is
silently lost. Put `theme: <name>` in `article.md` frontmatter next to
`image_style:` and it survives every re-derive.

`--bgm <tag|none>`: the answered tag is stamped into a **fresh** `audio-config.yaml` (`none` → `bgm: null`); an existing `audio-config.yaml` wins (warning printed, file untouched); `--no-audio-plan` drops the `bgm` question entirely.

## 2.9 The review → revise loop (findings become targeted edits)

`video review` is read-only: it writes `review/{content,visual,technical}-review.yaml`
and stops. `video revise` closes the loop — it resolves every content/visual
finding to the passage it quotes (or the scene/section it names), then the
surgical reviser edits **only those passages**.

```bash
video review  "AI 思维链"     # → review/*.yaml (read-only)
video revise  "AI 思维链"     # → article.md (targeted) + article-revise.yaml
video draft --from-review "AI 思维链"  # the same fix as a draft stage
```

What it does NOT do:

- **No full rewrite.** Untouched passages stay byte-identical — `characters:`,
  `hold_after_sec`, `lead_in_sec`, `map:` and every frontmatter key survive.
- **No technical edits.** Resolution / fps / audio / missing-asset findings
  describe the render; they are listed as skipped, never handed to the reviser.
- **No invented sources.** An unsupported-claim finding gets the rule stated
  ON the finding ("no verified source was found — soften or scope the claim
  instead of adding a citation"). Without it the reviser invented a book
  title nobody supplied. `--research` fact-checks the claims first (one
  research call per claim — slow, and it often fails on this repo's
  providers, so it is off by default).

**Both copies get fixed.** An article says each claim TWICE — once in the
prose section (what the human reads) and once in the scene narration (what
the video says). 15 of the 20 narrations in `projects/努力` restate a phrase
that also lives in the prose. A finding therefore gets TWO targets: the
narration and the prose sentence that says the same thing. Fixing only the
copy the judge quoted leaves the article contradicting itself — measured on
`projects/努力`: narration-only scored 76.6/100, both copies 88.4/100.

**Findings must be anchored.** Every structured review finding carries
`field` (narration / caption / visual / section) and `quote` (the passage,
verbatim). A finding that names a scene but not the text inside it is
reported and then set aside — the repair path edits one quoted passage at a
time, so an un-anchored finding is a finding nobody can act on.

**The judge reads a fresh storyboard.** The storyboard is derived from
article.md, and only `video make` re-derives it — so after a hand edit the
file on disk still carries the old narrations and the judge quotes wording
the article no longer has. `video review` now derives the current storyboard
IN MEMORY (the Review Agent stays read-only) and warns when the file on
disk is behind.

The revised article is re-scored by the article judge, so `article-revise.yaml`
records `before_overall → after_overall` next to the findings applied and the
findings skipped. `--re-review` re-runs the review agent on the revised film.
`video revise` refreshes `storyboard.yaml` from the revised article — the
storyboard is derived, so a hand-edit there would be overwritten by the next
`video make`.

`video draft --from-review <project>` runs the same fix as a draft stage: seed =
the article on disk, the review's findings applied in the first revision, then the
quality loop continues with the judge's own findings (budget 2 by default, never
regenerating the seeded article; frontmatter and narration config preserved;
agent-ask skipped — the project's frontmatter is the answer).

## 3. Canonical end-to-end

```bash
# 1. Scaffold
video new "transformer architectures"

# 2. Two human-edit checkpoints via LLM
video draft "transformer architectures"
#   → edit projects/.../article.md and projects/.../audio-config.yaml
#   article.md narrations drive scene visuals; audio-config.yaml drives voice/BGM/SFX

# 3. Render
video make transformer-architectures
#   writes output/final-mixed.mp4

# 4. (Optional) Publish
video youtube transformer-architectures
video thumbnail transformer-architectures
video shorts transformer-architectures
```

Idempotent: `video make` skips a step when its output is newer than its inputs. Use `--fake` to render without network / API calls (silent placeholder WAVs, no AI images).

