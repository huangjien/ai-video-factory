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
3. NEVER translate, reword, or reformat the `visual:` value of any scene.
   Copy it byte-identical. It is an image-model directive whose content
   hash decides cached image reuse; any change re-spends image generation.
4. Keep every scene `id:` identical. Keep scene count and order identical.
5. Keep `duration:`, `hold_after_sec:`, `lead_in_sec:` numbers identical.
6. Keep `characters:` lists (ids and variants) identical if present.
7. Frontmatter: set `language: {{TARGET_LANG}}`. Keep every other
   frontmatter key with its value unchanged (the caller fixes `voice:`
   and `captions_source:` itself).
8. Translated narration stays within ±30% of the source length. Never
   summarize, never expand, never drop a sentence — the scene count and
   pacing depend on complete narration.
9. Natural spoken register for {{TARGET_LANG}}: narration is
   text-to-speech input. No markdown, no quotation marks around it, no
   speaker labels, no parenthetical stage directions.

## Input article

{{ARTICLE}}

## Task

Translate the article to {{TARGET_LANG}}.
{{EXTRA_RULES}}

Output ONLY the translated article markdown — no commentary, no fence
around the whole document.
