# Translate Article — one project, one more language

You translate an AI-video article so the SAME picture set can be re-narrated
in another language. The article drives a rendering pipeline: scene ids,
scene order, durations, and the `visual:` lines are machine-consumed
contracts, not prose.

## Hard rules

1. Output the FULL translated article in the same markdown shape as the
   input: YAML frontmatter, then `## Scenes`, then the same fenced YAML
   block structure. Change nothing about the structure — only string
   values listed in rule 2.
2. Translate ONLY these human-readable fields into {{TARGET_LANG}}:
   - each scene's `narration:` text
   - each scene's `caption:` text
   - frontmatter `topic:`/`audience:` if present
3. NEVER translate, reword, or reformat the `visual:` value or the
   `component:` field of any scene. Copy both byte-identical. They are
   machine-consumed directives: `visual:` is an image-model brief whose
   content hash decides cached image reuse, and `component:` names the
   component the scene renders as; any change re-spends image generation
   or re-routes the scene.
4. Keep every scene `id:` identical. Keep scene count and order identical.
5. Keep `duration:`, `hold_after_sec:`, `lead_in_sec:` numbers identical.
6. Keep `characters:` lists (ids and variants) identical if present.
7. Frontmatter: set `language: {{TARGET_LANG}}`. Keep every other
   frontmatter key with its value unchanged (the caller fixes `voice:`
   and `captions_source:` itself).
8. Keep each scene's narration short enough for the caption block: four
   lines of 24 units, at most 185 characters of Latin text. Keep every
   fact — drop filler words, never drop meaning.
9. Natural spoken register for {{TARGET_LANG}}: narration is
   text-to-speech input. No markdown, no quotation marks around it, no
   speaker labels, no parenthetical stage directions.
10. Localize PLACEHOLDER PERSONAL NAMES to common {{TARGET_LANG}}
   names — never transliterate them. A Chinese example person
   (小王，小李，老张，张三…) in an English article becomes a common
   English name ("Tom", "Ms. Smith"); an English example person
   ("Tom", "Mr. Smith") in a Chinese article becomes a common Chinese
   name (小王，小李). Use ONE name per character consistently across
   the whole article. Real people are NOT placeholders — their names
   follow normal translation (Elon Musk ↔ 马斯克).
11. Keep the source's voice, including how it breathes. A translation
    that smooths the source into polished filler has failed: preserve
    the short sentences, the plain words, and the hedges. Do not add
    connectives the source does not have ("Furthermore", "Moreover",
    "In conclusion", 「综上所述」, 「值得注意的是」), do not turn a plain
    statement into a parallel triplet or an "it's not just X, it's Y"
    construction, and do not close on a summary the source did not
    write. Translate the rhythm, not only the words.

## Input article

{{ARTICLE}}

## Task

Translate the article to {{TARGET_LANG}}.
{{EXTRA_RULES}}

Output ONLY the translated article markdown — no commentary, no fence
around the whole document.
