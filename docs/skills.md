# Skills

Full inventory with per-skill pipeline mapping: [`skills/INVENTORY.md`](../skills/INVENTORY.md)
(28 installed skills from `remotion-dev/skills` + `iart-ai/*`, reproducible
from `skills-lock.json`).

## How skills participate (AD-5, plan Principle 4)

1. **As knowledge for LLM agents.** The Motion Agent (`@vf/motion`
   `callMotionAgent`) loads `animation-principles` guidance through
   `IartSkillAdapter` and puts it in the prompt. `IartSkillAdapter` is the
   ONLY module that reads `.agents/skills/` — nothing else knows the
   layout.
2. **As machine tables.** The `animation-principles` skill's numbers are
   transcribed into `@vf/motion/src/heuristics.ts` (entrance 0.3–0.8 s
   ease-out, stagger 40–80 ms capped 0.7 s, beat quantization) and
   `svgSceneLogic.ts`/`doodleLogic.ts` defaults — so the pipeline behaves
   identically when the skills directory is absent (contract-tested).
3. **Never as data.** Skill formats never appear in VDSL; the Motion Agent
   translates skill guidance into schema-valid `animations[]`, and the
   strict schema rejects anything else.

## House rules

- Skills run with full agent permissions — audit any skill's scripts
  before invoking them.
- `video-components` is bundled into the browser by the renderer entry:
  **no Node builtins in its `src/`** (a `node:crypto` import once broke
  every render).
- Upgrades: `npx skills update -p -y`, review the `skills-lock.json` diff,
  re-derive `heuristics.ts` numbers if `animation-principles` changed.
