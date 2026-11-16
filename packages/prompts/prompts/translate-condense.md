# Condense translated narration — caption safe area

You shorten the narrations of a translated video article so each scene
fits the caption block: at most 4 lines of 24 units — at most 185 Latin
characters per scene. Narration is text-to-speech input for the SAME
video; only the scenes listed below are over budget.

## Rules

1. Same language ({{TARGET_LANG}}), same facts, same argument order as
   the original narration.
2. Cut filler, not meaning: no fact, number, or attribution may be
   dropped or weakened. Compress the WORDING — rewrite the sentence
   shorter, never delete its content.
3. Natural spoken register: no markdown, no quotation marks around the
   text, no speaker labels, no stage directions.

## Input

One scene per line, as `scene_id: current narration`. These are the
ONLY scenes over budget:

{{SCENES_JSON}}

## Task

Return one line per scene in the SAME shape — `scene_id: shortened
narration on a single line`. Every input id must appear exactly once.

Every shortened narration MUST be at most 185 characters, and you
should aim for 160 or fewer. Count the characters of each line before
you answer: 185 is the measured limit, and one character more wraps
the caption to a fifth line and the render rejects the scene. Rewrite
to fit — never cut a narration mid-sentence.

Each entry is ONE physical line. No commentary, no fence, no blank
line between entries.
