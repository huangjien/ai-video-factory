# BGM library — curated royalty-free tracks

This directory is the project's **single source of truth for BGM music**.
Every video we generate picks its background music from here (no live
generation, no outside download). Track 16 covers distinct types / modes
so the audio-plan agent can pick a mood without overlap.

## Naming convention

`<mood>-<slug>.mp3`, sibling `<mood>-<slug>.license.txt` with provenance.
The slug is a lowercased, hyphen-joined token from the original track title.

## Index

| Tag (slug) | Mood / type | Track | Artist | Source ID |
|---|---|---|---|---|
| `ambient-take-your-pick` | ambient | Take Your Pick | Aaron Lieberman | amdXZYd9JzU |
| `peaceful-sleeping-sheep` | peaceful / serene | Sleeping Sheep | The Green Orbs | WQxCICpsaqY |
| `cheerful-moments-nekzlo` | cheerful / playful | Moments | Nekzlo | CFTjunNQXZw |
| `happy-rainbow` | happy / bright | Rainbow | JayJen | 1I8RRwzw3aA |
| `classical-gymnopedie-no-3` | classical / piano | Gymnopedie No. 3 | Wahneta Meixsell | eO2MmgE7IXk |
| `dance-wild-pogo` | dance / rhythmic | Wild Pogo | Francis Preve | RWNXtzZbn1I |
| `electronic-nekozilla` | electronic / synth | Nekozilla | Different Heaven | hiGfUpAytDo |
| `hiphop-groomin` | hip-hop / beat-driven | Groomin | Text Me Records / Social Work | u4IJ2knh_oY |
| `jazz-the-messenger` | jazz / brass-piano | The Messenger | Silent Partner | LcqBd58MXVw |
| `kids-twinkle-twinkle` | kids / friendly | Twinkle Twinkle Little Star | The Green Orbs | 6dljI1XwggY |
| `light-gravity` | light / breezy | Gravity | Extenz | _-Ws0B_9QXk |
| `rock-not-the-only-one` | rock / guitar-driven | Not the Only One | Rondo Brothers | YXJfaJemHMo |
| `cheerful-smile-ikson` | cheerful-pop / optimistic | Smile | Ikson | BoJOdjZQEFM |
| `emotional-past-life` | emotional / nostalgic | Past Life | JVNA | YYpwHYPF4HY |
| `chill-slow-times-over-here` | chill / slow | Slow Times Over Here | Midnight North | Dak6FQssVKw |
| `travel-sunset-paradise` | travel / vacation | Sunset Paradise | Wonki | AZQONwyI5IE |
| `upbeat-your-love` | upbeat / forward-moving | Your Love | Niwel (NCS) | PuCWn_OVga8 |

## Source playlist

All tracks came from
<https://www.youtube.com/playlist?list=PL_k9bFPONrNfrmOXvxU3FijljSFUCc-Rm>
— a curated "No Copyright Music" / "背景音樂 無版權音樂 免費音樂" list.
Each `*.license.txt` cites the source video ID, the artist, and the
no-copyright status. Verify before any commercial distribution.

## How a track gets chosen

`packages/prompts/prompts/music.json` indexes this directory: tag → track,
artist, duration, loudness, dynamic range, and `use_when` / `avoid_when`
scenario notes. `renderBgmCatalogue()` turns it into the table the audio
planner reads (`audio-plan.md`), so the planner names a real tag instead of
inventing one.

`bgm: <tag>` in `audio-config.yaml` resolves project-first
(`assets/audio-assets/bgm/`) then this directory, then `assets/brand/`. The
resolved file is passed to ffmpeg **in place** — nothing is copied into the
project, so the library stays a single copy. A tag that resolves nowhere
warns and mixes silence rather than failing the render.

## Two measurements that change the choice

`loudness_lufs_i` spans about 8 dB across this library (-15.4 to -7.5),
while the mixer applies ONE fixed bed level. A quiet master therefore sits
several dB under the narration and a loud one swamps it.

`dynamic_range_lu` above ~8 means the track breathes, so the bed swells in
the gaps between narration — fine under sparse narration, wrong under dense
explanatory text.

`needs_loop_under_300s` marks tracks shorter than a typical runtime. They
loop, and a track that does not resolve at its end (`upbeat-your-love`) makes
the seam audible; `chill-slow-times-over-here`, `classical-gymnopedie-no-3`
and `peaceful-sleeping-sheep` run long enough not to.

## Adding a track

Drop `<mood>-<slug>.mp3` plus its `.license.txt` in this directory and add an
entry to `music.json` — the planner reads that file, so a track missing from
it is invisible to the planner even if the audio is present.

## Re-fetching

```bash
yt-dlp -x --audio-format mp3 --audio-quality 192K \
  -o "assets/bgm/<slug>.mp3" \
  "https://www.youtube.com/watch?v=<id>"
```

A 192 kbps mp3 keeps the whole library at ~85 MB; the original
`AudioAssetError("directory not found")` is the easiest way to spot a
track that's missing during a refetch.
