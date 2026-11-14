# BGM library — curated royalty-free tracks

This directory is the project's **single source of truth for BGM music**.
Every video we generate picks its background music from here (no live
generation, no outside download). The 34 tracks cover distinct types / modes
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
| `epic-the-epic-hero` | epic / trailer build | The Epic Hero | Keys of Moon | ETbsXdqgcTM |
| `trailer-silhouette-of-war` | trailer / conflict | Silhouette of War | Keys of Moon | Lzofxb1vATw |
| `war-endless-storm` | war / open conflict | Endless Storm | Makai Symphony | TNs5JFYaTMk |
| `sad-lonesome-journey` | sad / melancholy | Lonesome Journey | Keys of Moon | p5cWMxzzMdA |
| `sad-undertow` | sad / quiet piano | Undertow | Scott Buckley | 3TKghKSDnEM |
| `dramatic-this-too-shall-pass` | dramatic / emotional peak | This Too Shall Pass | Scott Buckley | LlU2X2AWhho |
| `dark-shattered-glass` | dark / mysterious | Shattered Glass | Cjbeards | lRwq7pfA4Gg |
| `suspense-faith` | suspense / spy | FAITH | yenss | VZzyKHoBKtQ |
| `chinese-lau-tzu-ehru` | chinese / erhu | Lau Tzu Ehru | Doug Maxwell | QRF2zzEFu8c |
| `japanese-yugen` | japanese / soft | Yugen | Keys of Moon | MM2-z8inpY8 |
| `samurai-a-just-ronin` | samurai / duel | A Just Ronin | SolasComposer | EmkO1W6asvM |
| `medieval-adventure-beyond` | medieval / folk quest | Adventure Beyond | Alexander Nakarada | LYf2gOIt_OQ |
| `hopeful-resolutions` | hopeful / turnaround | RESOLUTIONS | Scott Buckley | LEm_RLKKGBQ |
| `inspiring-flowing-energy` | inspiring / forward motion | Flowing Energy | Keys of Moon | pBT01U9zgfQ |
| `romantic-white-petals` | romantic / tender | White Petals | Keys of Moon | uYjUI_zeeJk |
| `corporate-synesthesia` | corporate / product | SYNESTHESIA | GalaxyTones | ikz1aBQi2v0 |
| `lofi-herbal-tea` | lofi / study | Herbal Tea | SmartToaster | 6ukEy6FOxZE |

## Source playlist

All tracks came from two curated "No Copyright Music" playlists:

- <https://www.youtube.com/playlist?list=PL_k9bFPONrNfrmOXvxU3FijljSFUCc-Rm>
  — "No Copyright Music" / "背景音樂 無版權音樂 免費音樂" (the first 17 tracks).
- <https://www.youtube.com/playlist?list=PLfP6i5T0-DkJPT4dkMAr0PwRq1m25UtoO>
  — a 213-track non-copyrighted library (the epic / sad / dark / oriental /
    romantic / corporate set, added 2026-11-11).

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

`loudness_lufs_i` spans about 15 dB across this library (-22.0 to -7.3),
while the mixer applies ONE fixed bed level. A quiet master therefore sits
several dB under the narration and a loud one swamps it. The quiet end
(`sad-lonesome-journey`, `japanese-yugen`, `romantic-white-petals`) needs a
raised bed to be audible at all; the loud end (`war-endless-storm`,
`corporate-synesthesia`) needs attenuation.

`dynamic_range_lu` above ~8 means the track breathes, so the bed swells in
the gaps between narration — fine under sparse narration, wrong under dense
explanatory text. The 2026-11-11 additions reach 21.6 LU
(`samurai-a-just-ronin`) and 16.2 LU (`medieval-adventure-beyond`).

`needs_loop_under_300s` marks tracks shorter than a typical runtime. They
loop, and a track that does not resolve at its end (`upbeat-your-love`) makes
the seam audible; `chill-slow-times-over-here`, `classical-gymnopedie-no-3`
and `peaceful-sleeping-sheep` run long enough not to. Five tracks added on
2026-11-11 also run long enough not to: `dramatic-this-too-shall-pass` (448s),
`hopeful-resolutions` (328s), `samurai-a-just-ronin` (381s) and
`medieval-adventure-beyond` (309s).

`medieval-adventure-beyond` is also the cleanest loop in the library: it
starts and ends on silence, so the 1.4x repeat under an 8-minute body is
inaudible (`epic-phoenix` had the same property — see the removal note
below).

## Removed tracks

`epic-phoenix` (Phoenix, Scott Buckley) was deleted on 2026-11-14 after the
video it scored — 任务式指挥与 Agent 设计 (YouTube `5D0s18diEf4` /
`jJ7JfM2NEkM`) — drew a copyright claim. The mp3, its `.license.txt` and its
`music.json` entry are gone; both language versions of the film were re-cut
with `medieval-adventure-beyond` instead and re-published.

The root cause is the SOURCE, not the track: every track here was pulled
from a YouTube "no copyright" repost channel, so the original artist's
Content ID fingerprint still matches the repost and the claim lands on us.
A track's `.license.txt` saying "no-copyright" is not evidence — only the
licensor's own terms are. Prefer a track that another shipped film already
uses without a claim, and add its licence to the video description.

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

A 192 kbps mp3 keeps the whole library (34 tracks) at ~170 MB; the original
`AudioAssetError("directory not found")` is the easiest way to spot a
track that's missing during a refetch.

Measure a new track before writing its `music.json` entry — the numbers
are real readings, not estimates:

```bash
ffmpeg -hide_banner -nostats -i assets/bgm/<slug>.mp3 -af ebur128=peak=true -f null -
```

`I:` is `loudness_lufs_i`, `LRA:` is `dynamic_range_lu`; `ffprobe` gives
`duration_sec`.
