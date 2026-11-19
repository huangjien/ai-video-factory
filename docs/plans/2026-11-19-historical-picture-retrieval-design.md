# Historical picture retrieval — design note

**Date:** 2026-11-19
**Status:** shipped (uncommitted working tree)
**Package:** `@video/image-sources` (new)
**Touches:** `packages/make`, `packages/draft`, `packages/media-generators`, `packages/cli`,
`packages/prompts`

---

## The problem

Every scene image was painted by a text-to-image model from a one-line
`visual:` direction. For a history film that means an AI approximation of a
real person, a real artifact and a real battle: often wrong, always
synthetic, and never traceable. The archives already hold the real thing —
Wikimedia Commons has the portraits, the prints, the maps and the
paintings, each with its license in the file record.

## The decision

Three choices, made with the user before any code was written:

| Choice | Value | Why |
|---|---|---|
| Use mode | per scene: `direct` / `reference` / `none` | a portrait wants the real picture; a battle wants a composed shot |
| Sources | Commons, Wikipedia, the project's own pictures, Met/Smithsonian/Openverse | Commons first — its license records are the most explicit |
| Scope | only the scenes a plan marks historical | a modern film pays nothing |

Plus one policy the user set in the question itself: **no copyright
problem**. Only PD / CC0 / PDM pictures may enter the pipeline.

## The flow

```
article.md ──▶ PLAN (1 LLM call, whole article)
                   │  per scene: historical? subject? query? mode?
                   ▼
              RETRIEVE (only the historical scenes)
                   │  Commons · Wikipedia · Met · Smithsonian · Openverse
                   │  · the project's own figures and cast sheets
                   │  ↓  free-license filter
                   ▼
              MATCH (1 LLM call, whole article)
                   │  which returned picture is really the subject?
                   ▼
              RESOLVE (picture + mode + cache digest)
                   │
                   ├─ direct   → the picture IS assets/images/scene_N.jpg
                   ├─ reference→ the picture is attached to the image request
                   └─ none     → generate from text, exactly as before
```

Every step may fail. A failed plan, a dead archive, a missing license, a
failed download — each one logs a line and the run continues as if the
feature did not exist. No scene fails because a picture archive was down.

## The pieces

| Module | Job |
|---|---|
| `license.ts` | maps the three license vocabularies (Wikimedia code / short name, Openverse code) onto one code; the allowlist is PD, CC0, PDM |
| `sources/commons.ts` | MediaWiki `generator=search` + `imageinfo` + `extmetadata`; the license comes with the file |
| `sources/wikipedia.ts` | the article's lead image, then the Commons file record for its license — a non-free lead image is dropped |
| `sources/museum.ts` | Met (`isPublicDomain`), Smithsonian (CC0 terms), Openverse (`license=cc0,pdm`) |
| `sources/artifacts.ts` | the project's placed figures and the character bible's cast sheets |
| `retrieve.ts` | fan out, filter by license, rank, download; the query ladder |
| `plan.ts` | one LLM call for the whole article |
| `match.ts` | one LLM call for the whole article: which picture is really the subject |
| `attribution.ts` | `scene_N.source.json` + `ATTRIBUTION.md` |
| `packages/media-generators/src/image-io.ts` | Pillow: normalize any archive format to a scene-sized JPEG |

## Five findings from the live run (玄武门, 26 scenes)

1. **A rich query finds nothing.** An archive ANDs its terms. `唐太宗`
   returns five portraits; `唐太宗入军图 尉迟乙僧 绢本设色` returns none.
   The plan prompt now asks for two or three terms, and the retriever
   widens the search anyway: planned query → bare subject → single terms.
2. **The project's own pictures cannot end the search.** The cast sheet
   answers every query, so "the search returned something" is not evidence
   that the query was good enough. Only a real archive hit ends the ladder.
3. **A string match cannot tell two emperors apart.** The retrieval found
   `Gaozong of Song.jpg` for the subject 唐高宗 李治 — a Song-dynasty
   emperor with the same temple name — and a modern shopping mall for
   唐长安城 西市. The subject's name is in Chinese and the file titles are
   in English; no string comparison can bridge that. Hence the **match
   step**: one more LLM call, for the whole video, that sees the subject
   and the returned titles and picks the picture that really depicts it —
   or answers "none". A wrong picture on screen is worse than no picture.
4. **A cast sheet is never the frame.** Showing the drawing instead of the
   person is not what a portrait scene needs, so cast sheets are
   reference-only. The project's earlier scene images are not candidates
   at all: reusing one would put another scene's art in this frame, and
   the candidate set would grow during the run — which would change the
   cache key on every re-run.
5. **Only one provider can take a reference.** MiniMax-H3 has an edits
   endpoint; image-01, gpt-image and Gemini do not. A provider that would
   silently ignore the picture is skipped, not tried — and the run log
   says so.

## The cache

A borrowed picture is an image INPUT, so it joins the image cache key:

```
direct:<sha256 of the picture's identity>
ref:<sha256 of the picture's identity>
```

The term is appended **only when there is a picture**, so a scene with no
borrowed picture keeps exactly the key it had before the feature existed —
turning the feature on does not re-buy every image a project already has.
The impact table (`video make --dry-run`) stays offline: it reads the
recorded digest out of `scene_N.source.json` instead of re-retrieving.

## Attribution

The audio library sets the precedent (`assets/bgm/<tag>.license.txt`). Images
get the same treatment:

- `assets/images/scene_N.source.json` — mode, source, title, author,
  license, license URL, page URL, file URL, digest, sha256, timestamp.
- `assets/images/ATTRIBUTION.md` — one row per picture: scene, use (frame
  or reference), picture, source, author, license, link.

## What is deliberately not here

- No new provider. MiniMax-H3 already takes reference images.
- No change to the caption or bake-text pipelines — a baked title still
  lands on a directly-used picture.
- No SVG support, no colour grading of borrowed pictures to the film style.
- The character bible stays text-anchored for scene art; the cast sheets
  inform a frame, they do not replace the anchor mechanism.
