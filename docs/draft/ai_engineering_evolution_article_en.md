# From Prompt Engineering to Agentic Engineering: The Evolution of AI Engineering

## 1. From "Making AI Answer" to "Making AI Get Work Done"

Carlo is Italian. What kind of pizza do you think he likes?

An AI might answer Margherita because it is a classic Italian pizza.
That sounds plausible, but it is only a guess. Carlo might prefer
Pepperoni, or he might not like pizza at all.

If we want AI to do more than guess---to understand Carlo's actual
preferences, find a suitable menu item, stay within budget, check
ingredients, and eventually place an order with authorization---the
problem changes.

We are no longer concerned only with "How can we get a better answer
from AI?" We must also ask:

-   Does it understand the task?
-   Can it access the right information?
-   Does it know what success means?
-   Can it use real tools to take action?
-   Are its actions constrained by appropriate permissions?
-   Can it adapt when something fails?
-   Can the final result be independently verified?

The same shift is taking place in DevOps. Previously, an engineer might
paste a failed Jenkins log into an AI chat and ask for an explanation.
An AI Agent may now be able to read the log, inspect code, modify files,
run tests, and continue troubleshooting within its authorized
boundaries.

This article follows two scenarios:

-   **The pizza scenario:** From guessing Carlo's favorite pizza to
    reliably arranging his dinner.
-   **The DevOps scenario:** From explaining Jenkins logs to diagnosing,
    fixing, and verifying failures under controlled conditions.

One important clarification: these concepts did not emerge as eight
strictly sequential generations that replaced one another. Many have
earlier research and engineering roots. As model capabilities and
tooling have evolved, they have increasingly been combined into more
complete systems.

## 2. Prompt Engineering: Turning Vague Requests into Clear Instructions

Prompt Engineering focuses on designing instructions so that a model
understands the task more accurately and produces outputs that meet
expectations.

Start with:

> Carlo is Italian. Guess what kind of pizza he likes.

A better prompt might be:

> Guess which pizza Carlo is most likely to enjoy. Explain your
> reasoning, and clearly distinguish speculation from fact. His
> nationality alone cannot establish his personal taste.

The AI might answer:

> I would guess Margherita because it is a classic Italian pizza.
> However, that is only a guess; nationality alone cannot tell us
> Carlo's actual preference.

That is the value of prompt engineering: clarifying the task,
constraining the output, and encouraging the model to communicate
uncertainty.

### Eye-opening techniques: Structured Prompts, Few-shot Prompting, and Chain-of-Thought

An important early improvement was moving from casual questions to
structured instructions:

``` text
Role: You are a DevOps incident-analysis assistant.

Task: Analyze the failed Jenkins Pipeline logs.

Inputs:
- Build logs
- Most recent code changes
- Relevant test results

Requirements:
1. Identify the first diagnostically useful error.
2. Distinguish confirmed facts from hypotheses.
3. Rank plausible root causes by likelihood.
4. Propose a validation method for each cause.
5. Do not present an unverified hypothesis as fact.

Output:
- Key evidence
- Candidate root causes
- Validation steps
- Remaining uncertainty
```

Structured prompts make the task, context, constraints, and output
format explicit. **Few-shot prompting** provides a small number of
examples so the model can follow the expected response pattern.

Another eye-opening development was **Chain-of-Thought (CoT)
prompting**. Research published in 2022 showed that prompting models to
produce intermediate reasoning steps could improve performance on some
multi-step reasoning tasks. Work such as ReAct subsequently explored
combining reasoning and action.

For example, when analyzing a Jenkins failure, a model might distinguish
a dependency-download failure from a failed test assertion, then use the
logs to decide what to inspect next rather than immediately asserting an
unverified cause.

There is an important caveat: Chain-of-Thought is a prompting technique,
not a guarantee of correctness. A model's displayed reasoning may still
be wrong, and production systems do not necessarily need to expose the
model's full internal reasoning. They should instead provide checkable
evidence, concise decision summaries, and verification results.

### Where does prompting reach its limits?

If all we know is that Carlo is Italian, even a sophisticated prompt
cannot tell us his actual favorite pizza.

Likewise, if the Jenkins log contains only:

``` text
ERROR: Build failed
```

the model cannot reliably determine the root cause.

**Prompt Engineering improves how a task is expressed; it does not
automatically supply missing facts.**

## 3. Context Engineering: Put the Right Information on the Table

Context Engineering focuses on selecting, organizing, retrieving, and
updating the information a model needs to complete a task.

Suppose the AI can now access Carlo's preference record:

``` yaml
person: Carlo
favorite_pizza: Pepperoni
dislikes:
  - olives
usual_takeaway_day: Friday
budget_eur: 20
```

Now ask:

> What is Carlo's favorite pizza? When does he usually order takeaway,
> and which ingredient should be avoided?

The AI can answer from the record: Carlo's favorite is Pepperoni, he
usually orders takeaway on Fridays, and he dislikes olives.

This answer is no longer merely a guess based on nationality. It is
grounded in relevant information.

In real systems, context may come from user profiles, conversation
history, knowledge bases, code repositories, build logs, test reports,
databases, and external APIs. The goal is not simply to provide more
information, but to make sure that information is relevant, trustworthy,
current, and retrievable when needed.

### Eye-opening techniques: RAG, Vector Search, Long Context, and Memory

**Retrieval-Augmented Generation (RAG)** retrieves external information
and supplies it to the model so that its answer can be grounded in those
sources. Vector databases and semantic search help systems find relevant
content across large document collections.

For the pizza scenario, the system might retrieve Carlo's preference
record stating that he dislikes olives. For DevOps, it might retrieve
historical incidents that resemble the current Jenkins failure.

Longer context windows allow models to process more information at once.
But a longer context is not automatically a better one: irrelevant
material, outdated records, and contradictions can still reduce answer
quality. Context engineering therefore also involves filtering, ranking,
compression, source tracking, and state management.

**Prompt Engineering determines how to ask; Context Engineering
determines what the model can see when answering.**

## 4. Spec-Driven Development: Define What Success Looks Like First

Does having the right information guarantee success? Not yet.

"Find Carlo a good pizza" is still ambiguous. The most popular option
may not suit his taste, and the cheapest option may not be appropriate
either.

We need to turn the goal into explicit, checkable requirements:

``` yaml
task: choose_friday_pizza

requirements:
  must_be_pizza: true
  preferred_topping: Pepperoni
  forbidden_ingredients:
    - olives
  maximum_total_price_eur: 20

acceptance_criteria:
  - item_is_a_pizza
  - olives_are_absent
  - total_including_fees_is_at_most_20_eur
  - ingredients_and_price_are_verified
```

Here, Pepperoni is a preference, while the olive restriction and €20
maximum are hard constraints. If no suitable item exists, the AI should
report the problem rather than pretend it found a compliant option.

### Eye-opening techniques: Structured Outputs, JSON Schema, Test-First Practices, and Specification-Driven Workflows

Structured outputs let models return data in a specified format, such as
JSON conforming to a schema. This reduces ambiguity when downstream
software needs to parse the result. Test-first development, acceptance
tests, and specification-driven workflows make "done" something that can
be checked.

For example, an Agent can return the pizza name, ingredients, price,
delivery fee, and evidence source. A program can then check each hard
constraint instead of simply trusting the model's claim that the choice
is suitable.

In DevOps, a specification might require changes to remain within a
defined scope, prohibit deleting tests to manufacture a pass, require
relevant tests to succeed, mandate approval for production deployment,
and require a final report containing verification evidence.

Specification-driven development is not an invention of the AI era.
Requirements specifications, contracts, and acceptance tests have long
been part of software engineering. They become especially important with
AI because models can execute many operations quickly---and can just as
quickly amplify an ambiguous objective into a real-world failure.

## 5. Agent Engineering: From Giving Advice to Taking Action

So far, the AI can understand instructions, access information, and
recognize acceptance criteria. But it might still only tell us what to
do.

Agent Engineering focuses on enabling a model to execute the steps
required to complete a task, using tools and an appropriate runtime
environment.

Carlo's task can become:

``` text
Read preferences
      ↓
Query menus
      ↓
Check ingredients and prices
      ↓
Filter candidates
      ↓
Compare and verify
      ↓
Present a result for confirmation
```

In DevOps, an Agent can retrieve Jenkins build records, inspect relevant
code, review recent commits, propose a minimal fix, modify files in a
workspace, and run the relevant tests.

### Eye-opening techniques: Function Calling, ReAct, Tool Use, and Multi-Agent Systems

**Function Calling / Tool Calling** allows a model to request a
structured tool invocation. For example, it can request that a program
look up a Jenkins build instead of merely writing, "Please check
Jenkins."

**ReAct (Reasoning and Acting)** represents another important idea:
alternate reasoning, action, and observation. The model identifies what
information it needs, calls a tool, observes the result, and uses that
observation to decide what to do next.

Agent frameworks subsequently made it easier to organize tool calls,
state, orchestration, and multi-agent collaboration into reusable
software structures.

However, the ability to call tools does not guarantee reliable task
completion. An Agent can choose the wrong tool, misread a result, modify
the wrong file, or get stuck in repeated calls. Tool execution must
therefore be combined with permissions, feedback, and verification.

## 6. MCP: Connecting AI to Real Tools and Data

As the number of Agents and external systems grows, a new integration
problem appears. Each AI client may otherwise need a separate
implementation for every data source and tool, increasing development
and maintenance costs.

### Eye-opening technology: Model Context Protocol (MCP)

Anthropic publicly introduced the **Model Context Protocol (MCP) on
November 25, 2024**. MCP provides a standardized way for AI applications
to connect to data sources, business tools, and development
environments. It is best understood as a common interface for connecting
AI applications to external capabilities---not as an Agent by itself.

In the pizza scenario, an MCP server might expose tools for querying
restaurant menus, ingredient information, or order status. An Agent can
use those capabilities through an MCP client without requiring every AI
application to implement an entirely different integration.

In DevOps, MCP servers can expose GitHub, Jenkins, databases, or
internal support systems so compatible AI clients can retrieve build
information, search tickets, or call approved tools.

MCP primarily addresses **how tools and context are connected in a
standardized way**. It does not guarantee that a model will select the
right tool, nor does it automatically provide appropriate permissions,
business workflows, or acceptance criteria. Real deployments still need
authentication, authorization, input validation, auditing, and risk
controls.

## 7. Harness Engineering: Give the Agent a Badge---and a Door It Cannot Open

Suppose Carlo's AI can search menus, compare prices, and prepare an
order. Should it be allowed to pay automatically?

That depends on the authorization boundary.

A reliable system might let the AI read preferences, search menus, and
compare prices automatically, while requiring confirmation before
placing an order or making a payment.

Harness Engineering focuses on the execution environment, tool
interfaces, permissions, operational boundaries, and runtime constraints
around an Agent. The goal is to let it work while reducing the risk of
unauthorized or uncontrolled actions.

In DevOps, an Agent might be allowed to read a designated repository,
edit files in an isolated branch, and run tests. That should not
automatically grant it production credentials or deployment permissions.

### Eye-opening techniques: Sandboxes, Least Privilege, Approval Gates, and Observability

The breakthrough here is not necessarily one new invention. It is the
combination of mature engineering practices for AI-driven execution:

-   **Sandboxing:** Restrict execution to an isolated workspace or
    container.
-   **Least privilege:** Grant only the permissions required for the
    task.
-   **Human-in-the-loop:** Require confirmation for high-risk actions
    such as payments or production deployments.
-   **Audit logs:** Record tool calls, changes, and execution results.
-   **Policy enforcement:** Use programmatic rules to block high-risk
    actions rather than relying only on prompt instructions.

A prompt can tell an Agent not to deploy to production, but the actual
security boundary should be enforced by permissions and the runtime
environment. Models can misunderstand instructions; system controls must
not depend solely on model self-discipline.

## 8. Loop Engineering: Let the System Adapt When Things Fail

The first pizza found might contain olives. The second might exceed the
budget after delivery fees are added. A reliable system should not hand
an unsuitable result to Carlo simply because its first attempt failed.

It needs a feedback loop: execute, observe, check, adjust, and retry
within limits.

``` text
Execute
   ↓
Observe tool results
   ↓
Check against the specification
   ↓
If non-compliant: diagnose and adjust
   ↓
Retry within limits
   ↓
Succeed or stop and ask for help
```

In Jenkins, an Agent might change a configuration and run tests. If they
fail, it reads the new logs, checks whether the failure is related to
the change, and decides whether to try a correction. If repeated
attempts fail, evidence conflicts, or risk increases, it should stop and
request human intervention.

### Eye-opening techniques: Feedback Loops, State Graphs, and Workflow Orchestration

Early approaches such as ReAct already embodied the idea of alternating
action and observation. Later, state graphs, workflow orchestration, and
Agent frameworks made it easier to model loops, branches, retries,
timeouts, and approval steps explicitly.

In this article, **Loop Engineering** is a useful label for these
practices, not a universally standardized discipline with a single
agreed definition or start date.

A good loop is not an infinite retry. It needs limits on attempts, time,
and cost, and each retry should use new evidence. If the restaurant has
no compliant pizza, repeatedly querying the same menu will not make one
appear.

## 9. Evaluation Engineering: Do Not Let the Agent Give Itself a Perfect Score

Suppose the AI says, "I found a suitable Pepperoni pizza for €18."

We still need to verify the claim. Does the menu list that item? Does it
contain olives? Does the €18 price include delivery? Is the price
current?

Evaluation Engineering focuses on systematic, repeatable methods for
judging an AI model's or Agent's actual performance using evidence.

### Eye-opening techniques: Automated Evaluation, Regression Tests, Trajectory Evaluation, and Observability

For the pizza task, checks can cover the menu source, ingredients, total
price, and order status. For Jenkins, the Agent's claim that "the issue
is fixed" should be checked against questions such as:

-   Did the relevant tests actually pass?
-   Did the previously failing stage complete successfully?
-   Were regressions introduced?
-   Were tests deleted or assertions weakened to hide the failure?
-   Did the Pipeline complete, or was a rerun merely started?
-   Does the result meet the specification and permission policy?

AI evaluations can use fixed test sets, known-root-cause failure
scenarios, execution-trace reviews, and human sampling to measure task
success, false positives, incorrect modifications, retries, cost, and
completion time.

A model's claim that a task is complete is a claim, not evidence.
Passing tests only demonstrates that the tested behavior met those
checks; it does not prove that the entire system is free of defects.

Evaluation should therefore be at least partly independent of the
execution process. An Agent should not be the only judge of its own
success.

## 10. Skills: Teach the Agent How to Work, Not Just Which Tools Exist

MCP can connect an Agent to tools, but knowing which tools are available
does not mean the Agent knows how to follow a team's process correctly.

For example, Carlo's dinner task might follow a standard procedure:
check dietary restrictions first, compare menu prices, calculate
delivery fees, and then present an order summary for confirmation.

A DevOps team might standardize its incident process: collect logs,
identify the first meaningful error, inspect recent changes, make a fix
in an isolated branch, run tests, and produce an evidence report.

### Eye-opening technology: Agent Skills

Anthropic introduced **Agent Skills on October 16, 2025**, and released
Skills as an open standard in December 2025. A Skill is typically a
directory containing instructions, scripts, and reference material that
an Agent can discover and load when relevant to a task.

A DevOps Skill might look like this:

``` text
jenkins-failure-triage/
├── SKILL.md
├── references/
│   └── common-failure-patterns.md
└── scripts/
    └── collect-build-evidence.py
```

`SKILL.md` can describe when the Skill applies, diagnostic steps,
tool-use rules, output format, and stop conditions. Reference files
provide team knowledge, while scripts can perform deterministic data
collection or checks.

MCP and Skills serve different purposes:

-   **MCP:** Connects external tools and data.
-   **Skill:** Packages reusable workflow knowledge and procedures.
-   **Agent:** Decides when to use tools, load Skills, and advance the
    task.
-   **Harness:** Controls actual execution permissions and boundaries.
-   **Evaluation:** Checks whether the result meets the requirements.

MCP can be thought of as an interface for connecting capabilities; a
Skill packages a reusable way of working. They can be combined, but they
are not interchangeable.

## 11. OpenClaw and Personal Agents: From Chat Windows to Persistent Assistants

As Agents move beyond developer IDEs and one-off conversations, users
increasingly expect a different experience: not just answering
questions, but helping with ongoing work through connected tools and
familiar communication channels.

### Eye-opening technology: Personal Agent Systems Such as OpenClaw

The project now known as OpenClaw went through the names Clawd and
Moltbot. Its author announced the OpenClaw name on **January 29, 2026**.
It represents one approach to personal Agents: organizing a model,
messaging entry points, tools, sessions, and automation capabilities
into an assistant that users can delegate tasks to through everyday
interactions.

For Carlo's dinner, the user might not need to open a dedicated website
and re-enter preferences and budget every time. A personal Agent can use
available context, within its permissions, to help find options and
return decisions that need confirmation.

In DevOps, a similar Agent could serve as an everyday work interface:
summarize Jenkins failures, retrieve GitHub changes, look up tickets,
produce an initial root-cause analysis, and perform selected repetitive
actions within its authorized scope.

OpenClaw is a concrete example of this direction, not a new engineering
discipline in itself and not a mandatory architecture for every Agent
system. It illustrates how an Agent can evolve from a one-off chat
interface into a persistent assistant connected to tools and workflows.

Persistent operation brings security requirements of its own:
authentication for messaging channels, tool permissions, credential
management, prompt-injection defenses, auditing, and approval gates. The
more convenient and connected a personal Agent becomes, the more
important its security boundaries are.

## 12. Agentic Engineering: Assemble the Pieces into a Deliverable System

Each approach discussed so far addresses a different question:

-   Prompt Engineering: How should the task be expressed?
-   Context Engineering: What can the model see?
-   Spec-Driven Development: What counts as success?
-   Agent Engineering: How can it take action?
-   MCP: How can it connect to external tools and data?
-   Harness Engineering: Where are the action boundaries?
-   Loop Engineering: How should it adapt after failure?
-   Evaluation Engineering: How can the result be verified?
-   Skills: How can specialist workflows be reused?
-   Personal Agent systems: How can Agents operate in ongoing personal
    or work contexts?

Agentic Engineering can be understood as designing, implementing,
testing, and operating an AI system that combines these capabilities to
complete real tasks.

A complete dinner workflow for Carlo could be:

1.  Read and validate his preferences.
2.  Turn budget and ingredient restrictions into acceptance criteria.
3.  Query menus through controlled tools.
4.  Use an appropriate Skill to follow the selection process.
5.  Compare candidates using returned data.
6.  Retry within limits when a candidate fails.
7.  Independently verify ingredients and total price.
8.  Present the choice, evidence, and uncertainty to Carlo.
9.  Place the order after authorization.
10. Check the actual order status and record the result.

A Jenkins remediation workflow could follow a similar pattern:

``` text
Jenkins failure event
        ↓
Collect logs, code changes, and build context
        ↓
Diagnose root cause against the specification
        ↓
Propose and apply a minimal fix in a controlled environment
        ↓
Run tests, security checks, and regression validation
        ↓
Use feedback for bounded retries
        ↓
Independently evaluate the result
        ↓
Produce a change summary, evidence, and residual risks
        ↓
Submit or request human approval according to policy
        ↓
Record the result and monitor
```

The point is not to turn every component into a separate Agent or to
make every task fully autonomous. A simple task may need only one model
call. A complex task may combine tools, Skills, workflows, sub-agents,
and evaluation mechanisms.

The architecture should match the task's complexity, failure cost, and
risk.

## 13. How Do These Technologies Fit into the Timeline?

The timeline below is not a strict invention chronology. It highlights
representative developments and shifts in engineering focus.

  -----------------------------------------------------------------------
  Period                  Representative          Main problem addressed
                          technologies and        
                          practices               
  ----------------------- ----------------------- -----------------------
  2022--2023              Structured prompts,     Improve instruction
                          Few-shot,               following, multi-step
                          Chain-of-Thought,       reasoning, and the
                          ReAct, early tool-use   connection between
                          practices               reasoning and action

  2023--2024              RAG, vector search,     Supply external
                          long context, function  knowledge and let
                          calling, Agent          models execute
                          frameworks              multi-step tasks
                                                  through tools

  2024--2025              MCP, structured         Standardize tool
                          outputs, workflow       integration and
                          orchestration,          strengthen output
                          evaluation and          formats, execution
                          guardrail practices     boundaries, and
                                                  verification

  2025--2026              Agent Skills, personal  Reuse specialist
                          Agents, Harness         workflows and make
                          Engineering, end-to-end Agents more controlled
                          Agent system design     and maintainable in
                                                  real environments
  -----------------------------------------------------------------------

A few dates are especially useful landmarks:

-   **2022:** Chain-of-Thought and ReAct research demonstrated the
    potential of multi-step reasoning and combining reasoning with
    action.
-   **November 2024:** Anthropic publicly introduced MCP, promoting
    standardized connections between AI applications and external tools
    and data.
-   **October 2025:** Anthropic introduced Agent Skills, using
    directories of instructions and resources that can be loaded when
    needed.
-   **Late 2025 to 2026:** Personal Agents and more complete Agent
    engineering practices attracted increasing attention, with execution
    boundaries, reusable skills, and reliability becoming important
    system-design concerns.

Avoid a common misconception: these technologies were not all invented
in the years shown. RAG, workflows, testing, access control, and
evaluation all have earlier histories. The table describes
representative developments and growing areas of attention in modern LLM
applications, not the original invention date of every technique.

## 14. The Engineer's Role: From Performing Every Step to Designing Reliable Collaboration

In a traditional Jenkins incident, an engineer might personally read the
logs, inspect code, diagnose the cause, edit files, run tests, rerun the
Pipeline, and verify the result.

With an Agent, some of those steps can be automated. The engineer's
responsibilities do not simply disappear; they shift toward system
design and accountability.

Engineers need to decide:

1.  **Which tasks are suitable for automation?** Repetitive,
    well-bounded, verifiable tasks are often better candidates.
    High-risk tasks need stricter controls.
2.  **What context should the Agent access?** Which sources are
    trustworthy, which data may be stale, and what must remain private?
3.  **What counts as success?** Specifications, tests, and acceptance
    criteria must make the goal explicit.
4.  **What actions may the Agent perform?** Permissions, isolation,
    approvals, auditing, and stop conditions should be designed in
    advance.
5.  **How can the result be proven reliable?** Do not rely solely on the
    model's self-report; verify it with independent evidence.
6.  **How should the system improve over time?** Use failure records,
    evaluation sets, operational metrics, and human feedback to identify
    systematic weaknesses.

Engineers are increasingly becoming designers of AI workflows, authors
of constraints, and verifiers of results---not merely operators who
perform every step manually.

## 15. Conclusion: From "Answer Well" to "Act Correctly---and Prove It"

At first, we asked AI:

> Carlo is Italian. Guess what kind of pizza he likes.

The model could produce a plausible guess.

Then we gave it Carlo's actual preferences, explicit budget and
ingredient restrictions, access to real menus, and a process for
comparing candidates and adapting to feedback.

Finally, we required it not only to find a suitable pizza, but also to
act within its authorization and provide reliable evidence that the
result met the requirements.

The Jenkins story follows the same pattern. AI moves from explaining
error logs to gathering context, executing fixes, running tests,
adapting to feedback, and delivering verifiable results within
controlled boundaries.

Prompt Engineering, Context Engineering, Spec-Driven Development, Agent
Engineering, MCP, Harness Engineering, Loop Engineering, Evaluation
Engineering, Skills, and personal Agent systems are not mutually
exclusive steps in a single progression. They are capabilities and
practices that can be combined to build reliable AI systems.

**As AI moves from answering questions to executing tasks, engineering
shifts from "How do we make it say something better?" to "How do we make
it act correctly, keep it under control, and prove that it did the job
right?"**

------------------------------------------------------------------------

## References

1.  Wei et al., *Chain-of-Thought Prompting Elicits Reasoning in Large
    Language Models* (2022): https://arxiv.org/abs/2201.11903
2.  Google Research, *ReAct: Synergizing Reasoning and Acting in
    Language Models* (2022):
    https://research.google/blog/react-synergizing-reasoning-and-acting-in-language-models/
3.  Anthropic, *Introducing the Model Context Protocol* (2024-11-25):
    https://www.anthropic.com/news/model-context-protocol
4.  Anthropic, *Introducing Agent Skills* (2025-10-16):
    https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
5.  OpenClaw, *Introducing OpenClaw* (2026-01-29):
    https://openclaw.ai/blog/introducing-openclaw
