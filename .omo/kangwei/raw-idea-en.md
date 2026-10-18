# Raw idea: Conway's Law (ENGLISH version of the 康威定律 video)

Topic: Conway's Law — an explainer for software engineers and engineering leads.
Duration: ~240 seconds. Narration language: **en-US** (the whole article, including every
`narration:` line, must be in English). Audience: working developers and tech leads.

## The anchor sentence — must appear verbatim on screen at least once

The best statement of Conway's Law is: **"Any system is designed to organize the people
who built it."**

(Free translation of 「任何系统的构成，都反映了设计这个系统的组织结构」. This is the
1967 paper's claim; keep the sentence short enough to typeset as a full-screen quote card.)

## Outline to follow (preserve the argument, don't pad it)

1. **Hook** — tape the org chart and the system architecture chart side by side on the wall.
   The two shapes are startlingly similar: tree for tree, boundary for boundary. Not a
   coincidence — someone wrote this rule down in 1967.
2. **The 1967 sentence** — Melvin Conway's paper "How Do Committees Invent?" contains no
   code at all. Fred Brooks later cited it in The Mythical Man-Month, which is how it
   reached every engineer.
3. **Why it is nearly a law** — modules have to cooperate through interfaces, and an
   interface is the mirror of how the teams talk. Cross-team coordination costs far more
   than talking inside one team, so architects unconsciously cut the system into
   clean-bounded modules and give each team one. The evidence: teams whose
   communication structure is regular build regular systems; teams whose communication is
   tangled build tangled systems.
4. **Changing the org first** — Brooks's surgical team was a deliberate experiment in
   breaking the org shape: one surgeon, everyone else in support, a very short decision
   chain buying very clear roles. Microsoft's NT team went the other way: one kernel,
   everyone blocked on it, so they split it into multiple kernels and gave each team one;
   the architecture rearranged itself.
5. **Inverse Conway** — the stronger use: if you want an architecture, build the team
   that produces it. The org chart is the hidden input, not the architecture diagram.
   Stop drawing an ideal architecture on a whiteboard and hoping it lands; change the
   reporting lines into the shape you want first.
6. **How three big companies use it** — Netflix splits teams by business capability, not
   by technical layer, each squad end-to-end from front end to database. Amazon makes
   every team a small company under the two-pizza rule, so service boundaries and team
   boundaries line up one to one. Google breaks the strict hierarchy with 20% free time
   and source code visible to everyone internally — a platform team provides capability
   and product teams take what they need.
7. **Heuristic, not iron law** — it is descriptive, not causal: it helps you predict, it
   does not guarantee an outcome. A large system can never be split purely along org
   lines, or you become a prisoner of your own org chart. And every reorg leaves
   oscillations in the code that have to be smoothed deliberately.
8. **Three landing steps + close** — (a) put the org chart and the architecture chart
   side by side and see whether the shapes rhyme; where they rhyme, the law is working.
   (b) before every reorg, ask what the architecture will become. (c) to decouple, move
   the reporting lines before you touch the code. Close on the line: Conway's Law isn't a
   limitation, it's a reminder — to change the architecture you usually have to change
   the organization first, and your next version is already written in today's org chart.

## Voice and craft

- Engineer-facing explainer, English narration, brisk. No academic register, no "we shall examine".
- Concrete, checkable examples; avoid stacking abstract nouns.
- Open on a counterintuitive scene, close with actionable advice.
- Keep each scene's `narration:` under about 140 characters so it fits the caption safe area.
- Do not read on-screen elements aloud in the narration — titles and labels belong to the
  visual layer only.

## Visual direction

Every `visual:` line must be a six-part image brief — subject, setting, composition with a
named shot and where the subject sits, ONE lighting source with direction and quality, style
and palette, then constraints that reserve a quiet region for the title and forbid text,
letters, numbers, logos and watermarks.

**Never put these classifier trigger words in a `visual:` line** (they route the scene to a
deterministic diagram component whose data gets invented): quote, cycle, loop, rank,
leaderboard, chart, graph, distribution, percent, %, checklist, list, bullet, points, items,
pyramid, hierarchy, layer, tier, stack, venn, overlap, intersect, key insight, takeaway,
in one sentence, network, flow, pipeline, step, steps, process, workflow, diagram, flowchart,
node, edge, compare, versus, vs, difference, trade-off, before and after, code, terminal,
console, command, script, cli, json, yaml, timeline, history, chronology, year, era,
milestone, formula, equation, database, sql, query, schema, table, rows, columns, markdown.
Write the brief as a photographed or illustrated scene instead (a physical whiteboard, a
mirror, a folded blueprint, two identical framed diagrams, a mirrored org/system pair).