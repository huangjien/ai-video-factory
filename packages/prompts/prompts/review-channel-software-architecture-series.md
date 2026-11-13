# Review criteria added by channel profile: `software-architecture-series`

Judge the draft against these IN ADDITION to the standard rubric. Each
failure is an ordinary weighted finding — report the measured number, not a
style opinion.

## Standalone-ness (the channel's core requirement)

- **Abstract opening.** If the first scene's narration opens with an
  ABSTRACT premise — a dichotomy ("X vs Y"), a definition, a general claim,
  a quote — instead of a concrete scene (a situation, a number, a moment,
  an artifact), that is a finding. Quote the opening line and name the
  concrete scene it should have started from.
- **Undefined borrowed concept.** For each term the film borrows (a
  doctrine, a pattern, a standard, a term from another episode), find the
  FIRST scene that uses it and check that the narration defines it there in
  plain language, before the term carries any argumentative weight. A term
  used in the TITLE and defined nowhere in the first two scenes is a
  finding. A citation ("依据《ADP 6-0》") placed BEFORE the plain
  definition is a finding — the reader does not yet know what the source
  says.
- **Cross-episode dependency.** Any reference to another episode ("上一集",
  "前面讲过", "还记得…") is a finding: every film must stand alone.
- **Premise discharge.** Name the concept the title promises and state
  whether a viewer could explain it after scene two. If not, that is a
  finding, with the scene where the definition is missing.

## Pacing

- **Delivery rate.** Count the Chinese characters in all scene narration,
  divide by (`duration_target_sec` / 60). Outside **220–240 characters per
  minute** is a finding. State the measured rate.
- **Narration share.** Spoken characters against total runtime must land in
  **55–70%**. Outside that is a finding. State the measured share.
- **Per-scene ceiling.** Any scene whose narration exceeds **96 Chinese
  units** (the storyboard's caption ceiling, 4 lines × 24) is a finding —
  `video make` refuses to render it.

## Shape

- **Arc.** The film must show 具体场景 → 白话定义 → 机制 → 边界与代价 → 落地
  → 回扣 once through. A missing stage, or stages out of order, is a
  finding.
- **Concrete landings.** The application section must use concrete,
  current artifacts (a CI pipeline, a rollback, a deploy, an on-call
  rotation) rather than placeholders like "系统一" or "某平台". Generic
  abstractions in the landing section are a finding.

## Voice

- **Split personality.** A second narrator voice ("imagine", "as a
  developer", text that addresses the viewer directly) is a finding.
- **English-first jargon.** Using the English term where a standard Chinese
  term exists (and vice versa: English in the middle of Chinese narration
  for a term that has a Chinese name) is a finding — state the pair and
  which one the film should keep.
