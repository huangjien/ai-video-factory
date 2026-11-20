# Douyin (抖音) publishing lane — 2026-11-20

**Package:** `@video/douyin` (new) · **Command:** `video douyin <project>`

## The problem

The channel publishes to Bilibili, YouTube and (manually) Zhihu. Douyin was
the missing one — and it is not just another form to fill in:

- **Douyin is vertical.** A 16:9 film arrives letterboxed and reads as two
  different products. A Douyin post needs a 9:16 file.
- **Douyin has an official publishing API** (抖音开放平台 → 内容发布), so
  unlike Bilibili this can be a real automated publish — but the app has
  to be created and the capability approved by the owner first.

## What the owner has to provide

Nothing for the packaging half; the automated publish needs three things:

1. An app on 开放平台 with the **内容发布** capability APPROVED.
2. That app's `client_key` / `client_secret` in
   `~/.config/secrets/douyin-client-secret.json`.
3. `DOUYIN_ACCESS_TOKEN` in `~/.config/secrets/ai.env`, obtained by
   exchanging an authorization code.

Until (2) and (3) exist, the command packages the post and writes a
manual-upload checklist — the same shape the Bilibili lane uses, so
nothing is wasted.

## The design

### 1. The vertical cut (`packages/douyin/src/cut.ts`)

Two modes, and the choice matters:

- `inset` (DEFAULT) — the frame scaled to COVER a 1080×1920 canvas and
  blurred, with the whole 16:9 film scaled to fit the width and centred on
  top. **Nothing is cropped**: the title cards, the captions and a borrowed
  archive picture all stay readable. This is what these films need — they
  are explainers, and a cropped explainer loses the type.
- `crop` — a centre crop (`crop=ih*9/16:ih`). It fills the screen like a
  native vertical video but throws away ~43% of the width.

The graph has to be `-filter_complex`, not `-vf`: the inset mode takes the
same input twice (backdrop + foreground), and `-vf` accepts a single
input-to-output chain. The audio is copied (the master is already mixed)
and the file is faststarted, so a five-minute video starts playing before
the whole download finishes.

### 2. The packaging (`packages/douyin/src/{schemas,prompt,fallback,agent,checklist}.ts`)

Mirrors the Bilibili package exactly: an LLM agent writes title / 文案 /
话题 / cover_prompt, and **never throws** — a provider outage, a content
filter, malformed YAML or a schema violation all degrade to
`buildFallbackPackage`, which derives a valid package from `article.md`
with no model involved. A post is worth more than a polished title, and
Douyin is where a rejected post costs the most (the video has to be
re-uploaded whole).

Field limits: title ≤ 55, 文案 ≤ 2200, 话题 ≤ 5 × ≤ 20 characters.

The prompt (`packages/prompts/prompts/douyin.md`) writes in the VIDEO's
language and treats Douyin as a phone: the title is a hook, not a summary;
the 文案 is a caption, not an essay; the 话题 are the terms a viewer
would actually search.

### 3. The upload (`packages/douyin/src/uploader.ts`)

Three calls, like YouTube's resumable upload but simpler:

1. `video/create` → a `video_id` and a one-time `upload_url`
2. POST the file to that `upload_url`
3. `video/upload` → commit; the post gets an `item_id`

The endpoint paths and request bodies are isolated in one module so they
can be checked against the current documentation in a minute — the platform
moves, and an API that 400s with a readable body is a five-minute fix, not
a rewrite. Every error surfaces the API's own `description` and
`error_code`: a Douyin rejection is usually a capability or policy problem
the owner has to read, not a bug to retry.

### 4. The command (`packages/cli/src/douyin-command.ts`)

`video douyin <project>` — cuts the vertical file, packages the post,
writes `douyin/package.yaml` + `cover-prompt.txt` + `CHECKLIST.md`, and
with `--upload` publishes and records `douyin/item_id.txt`.

### 5. The auto lane

`video backlog auto` gained `douyin-zh` and `douyin-en` publish steps
(after the four existing ones). A publish failure stays non-fatal, like
every other lane. `video backlog stats` counts the entries that reached
Douyin.

## Verification

- `packages/douyin/src/douyin.test.ts` — the fallback package against the
  schema and the field limits, the vertical filter graph, the checklist,
  and the uploader's three-call flow plus both error paths.
- `packages/cli/src/douyin-command.test.ts` — the command: the cut runs,
  the files are written, the run record is written, `--upload` is skipped
  without a token, publishes with one, and falls back to the checklist
  when the API refuses.
- Live: `video douyin 古人长什么样-reconstructing-what-historical-fi` →
  1080×1920 / 192.9 s cut, title 「流传千年的肖像，可能比头骨更会骗人」,
  话题 #面部重建 #考古 #图坦卡蒙 #颅骨复原 #古代DNA.

## Open

- The API bodies await the owner's app (see "What the owner has to
  provide"). Until then the lane is packaging + cut + checklist, and the
  publish path is covered by tests against a mocked API.
- The cover: `video thumbnail --format vertical` already makes a branded
  1080×1920 cover at `youtube/thumbnail-vertical.jpg`; the command picks
  it up automatically.
