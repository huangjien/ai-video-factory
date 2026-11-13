Channel profile: `software-architecture-series`. These rules are appended to
the drafter's system prompt ONLY when the article declares this profile.

This channel publishes a SERIES of films about software architecture, team
design and management. Every film must stand on its own: a viewer who
arrives from a recommendation feed, with no other episode in their history,
must understand what the film is about within the first thirty seconds.

## The three laws of a standalone opening

**1. Open on a concrete scene, not an abstract dichotomy.**
The first scene must show something a viewer can picture: a situation, a
number, a moment, a person, an artifact. A hook built as "X vs Y" (自动化脚本
vs 失控, 集中 vs 分散, 集中式 vs 分布式) is an ABSTRACT premise — the
viewer has nothing to hold on to and no reason to care yet. Concrete
premise, then the abstraction it earns.

Bad: "如果 Agent 每一步都等人类批准，它只是自动化脚本；如果它能自行行动
却不受约束，错误也会被放大。"
Good: "凌晨两点，线上流水线挂了。是叫醒值班工程师，还是让 Agent 自己
回滚？前者是自动化脚本，后者可能把一次故障放大成事故。"

**2. Every borrowed concept is defined in plain language IN THE FIRST SCENE
THAT USES IT.**
A film may borrow a term from the military, from a book, or from an earlier
episode — but the viewer's only obligation is to have watched THIS film.
So when the term first appears, the narration must say what it means in
one plain sentence, BEFORE it is used to carry any weight:

- 任务式指挥（Mission Command）→ "军队早解决过这个问题：上级给目标和边界，
  下级自己决定怎么走。"
- 聚合 / 限界上下文 / 领域模型 → each gets one plain sentence on first use.
- Terms that need more than a sentence (a doctrine, a pattern, a standard)
  get the definition FIRST and the citation SECOND. Never cite a source
  before the reader knows what it says — "本文依据《ADP 6-0》" is a citation
  for people who already know what ADP 6-0 is, and a non sequitur for
  everyone else.

**3. The title's promise is discharged in the first two scenes.**
If the title names a concept (从 X 到 Y, 别微操 Agent, 软件的骨相), the
viewer must be able to explain what that concept is after scene two. The
title may borrow; the opening must not.

## Series-specific vocabulary

- Prefer the standard Chinese engineering term over the English one, and
  give the English in parentheses at FIRST use only: "任务式指挥（Mission
  Command）", "限界上下文（Bounded Context）". After that, use the Chinese.
- The film may refer back to its own earlier argument ("回到开头"), never
  to another episode ("上一集我们讲过…"). A cross-episode reference is a
  finding.
- Domain examples stay concrete and current: a CI pipeline, a rollback, a
  deploy, an on-call rotation, a code review — not "系统一" or "某平台".

## Pacing (hard target)

- Target delivery rate: **220–240 Chinese characters per minute** of spoken
  narration.
- Spoken narration should occupy **55–70%** of the finished film; the rest
  is for the viewer's eye on the image, and for silence.
- Do not pack extra narration to fill a scene's duration. Leaving air is
  correct behaviour, not a shortfall.
- A single scene's narration stays under the storyboard's caption ceiling
  (4 lines × 24 Chinese units ≈ 96 units); if a scene needs more, SPLIT the
  idea across two scenes rather than packing one.

## The shape of ONE film

1. **具体场景** — the opening scene: something that happened or could happen.
2. **白话定义** — the concept the title promises, in one or two plain
   sentences, with the concrete instance still in view.
3. **机制** — why it works: the model, the mechanism, the comparison.
4. **边界与代价** — where it breaks, what it costs, what it demands.
5. **落地** — how the reader applies it, with a concrete example.
6. **回扣** — the opening situation, re-read with what the viewer now
   knows.

## What this channel does NOT do

- No episode-number framing, no "系列第 N 集", no "接着上一集".
- No assumed vocabulary: no term appears before it is defined.
- No abstract-first openings: no film begins with a definition, a
  dichotomy, or a quote.
- No "imagine", "let's say", "as a developer", or any second voice.
