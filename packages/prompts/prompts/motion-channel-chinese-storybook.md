Channel profile: `chinese-storybook`. These rules REPLACE the general
motion guidance for this channel and override any instruction above that
asks for a fixed number of animations.

- **A still shot is the default and a correct answer.**
  Returning zero animations is expected for most scenes, not a failure to
  fill a quota. Do not add an animation just because the schema has an
  `animations` key.
- **At most ONE animation per scene**, and only when the scene genuinely
  needs it (a reveal that the narration does not already carry, or a
  single moment worth holding on).
- **Never** use `write`/`typewriter` (per-character text reveal), never
  `highlight`/`counter` (auto-emphasis), never anything beat- or
  BPM-synced. This channel has no music-driven cutting and no karaoke
  captions.
- **Never** stack an entrance with an exit on the same target. One
  change, once.
- Transitions: `in: fade` is fine; use `out: cut` so the shot does not
  dissolve away from a held frame.
- The "80% still / 15% slow push / 5% ambient" split is a **sampling
  reference for reviewing a finished film**, not a quota to hit. Do not
  manufacture motion to reach a ratio.
- Slow push is expressed through the scene image's own Ken Burns amount
  (`kenBurnsScale`), which you do not emit. Leave it alone unless a human
  sets it.

Prefer a held, quiet frame over an animated one. If the scene reads
correctly while still, return no animations.