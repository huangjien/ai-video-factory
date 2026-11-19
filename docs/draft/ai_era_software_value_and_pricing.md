# What Should Customers Pay for in the AI Era?

## From software access to delegated work and verified outcomes

### Executive thesis

AI is changing software from something humans operate into something
that increasingly performs work on their behalf. That shift challenges
the traditional economics of software.

The central question is no longer simply how many people use a product,
how many licences a company needs, or how many API calls it consumes. It
is increasingly how much valuable work the software can reliably
perform.

**The most practical unit of value for AI-native software is verified
work completed, measured by its contribution to business outcomes.**

This is not a claim that every software product should immediately adopt
outcome-based pricing. It is a framework for understanding how pricing
should evolve as software takes on more responsibility for execution.

------------------------------------------------------------------------

## 1. The fundamental shift: from selling tools to selling work

Traditional software generally provides tools that people use to produce
results.

### Traditional software: humans operate software

1.  A person supplies the objective, domain knowledge and judgement.
2.  The person operates the software.
3.  The software provides functionality, information and automation.
4.  The person remains responsible for turning those capabilities into a
    business result.

Examples include:

-   Salesforce providing CRM functionality for sales teams.
-   Jira providing project and issue-management capabilities.
-   Jenkins providing CI/CD automation infrastructure.
-   Photoshop providing image-editing tools.

Customers primarily purchase access to capabilities. Their employees
supply much of the effort required to use those capabilities.

### AI-native software: software performs work

The emerging model is different:

1.  A person defines an objective, constraints and permissions.
2.  An AI agent plans and executes a workflow.
3.  The agent uses tools, accesses business systems and makes bounded
    decisions.
4.  The system verifies the result and escalates exceptions when
    necessary.

Examples include:

-   A sales agent researching prospects and preparing qualified leads.
-   A project agent identifying overdue work, contacting owners and
    updating project status.
-   A DevOps agent investigating pipeline failures, identifying root
    causes and executing approved remediation.
-   An image-generation agent producing finished marketing assets.

The customer is increasingly purchasing not just functionality, but work
performed on their behalf.

This changes the value proposition: the product increasingly includes
part of the labour that previously sat outside the software.

------------------------------------------------------------------------

## 2. Why traditional pricing models become problematic

Existing software pricing models measure different things:

  -----------------------------------------------------------------------
  Pricing model           What the customer pays  Potential problem in
                          for                     the AI era
  ----------------------- ----------------------- -----------------------
  Per seat                Number of human users   Fewer people may
                                                  supervise more agents

  Per licence             Access to functionality Functionality can
                                                  become easier to
                                                  reproduce

  Per usage               Requests, API calls or  Measures consumption,
                          tokens                  not necessarily value

  Per compute             CPU, GPU or             Measures production
                          infrastructure          cost, not customer
                                                  benefit

  Per task                Number of tasks         Tasks can vary greatly
                          processed               in complexity and value

  Outcome-based           Results achieved        Attribution and quality
                                                  can be difficult to
                                                  establish
  -----------------------------------------------------------------------

Consider a company with 100 employees using a customer-support platform.
After introducing AI agents, 20 employees may be sufficient to supervise
a system that handles much of the routine support workload.

If the vendor charges only per seat, its revenue could fall sharply even
though the customer receives more value from the product.

This creates a structural tension:

**The more successfully AI reduces the number of humans needed to
operate software, the less suitable seat-based pricing becomes as the
primary measure of value.**

Seat pricing will not disappear. It may remain useful for human-facing
interfaces, governance and collaboration. But it becomes a weaker proxy
for the amount of work a product performs.

------------------------------------------------------------------------

## 3. Five possible units of value

There is no single pricing unit suitable for every AI product. Five
candidates are particularly important.

### 3.1 Completed work

This is the most practical starting point.

Customers pay for successfully completed work rather than for every
internal action taken by the software.

  Industry               Possible unit of value
  ---------------------- ------------------------------------------------
  Customer support       Resolved support case
  Software development   Completed and accepted development task
  DevOps                 Diagnosed and successfully remediated incident
  Recruitment            Qualified candidate delivered
  Accounting             Invoice processed and reconciled
  Legal                  Contract reviewed against agreed requirements
  Marketing              Approved marketing asset produced

The distinction between an attempted task and a completed task matters.

For example:

-   An agent starts investigating a Jenkins failure: no completed value
    yet.
-   It identifies a likely root cause: partial value.
-   It provides a validated fix: more value.
-   The pipeline passes after the fix and the change is verified: a
    defensible completion event.

A pricing unit should reflect the product's actual promise. If the
product promises incident resolution, merely opening an investigation
should not count as a resolved incident.

**Strength:** Relatively concrete, auditable and easier to contract
around than broad business outcomes.

**Limitation:** Tasks differ in complexity and importance. A simple
request and a critical production incident should not necessarily carry
the same price.

### 3.2 Human effort saved

A second approach is to charge according to the amount of human effort
avoided or redeployed.

Consider a company processing 10,000 invoices each month:

-   Before AI: five minutes of human work per invoice, or approximately
    833 hours.
-   After AI: one minute of human review per invoice, or approximately
    167 hours.
-   Difference: approximately 666 hours of human effort.

This can be a useful measure of productivity improvement.

However, hours saved are not automatically equivalent to cash saved.
Employees may use the recovered time for other productive work rather
than being removed from the payroll.

This model is most useful when labour savings can be measured or when
the organisation has an agreed method for valuing increased capacity.

### 3.3 Business outcomes

This is the most ambitious model.

Instead of charging for work performed, the vendor charges for results
that matter to the business.

Examples:

-   Sales software: qualified opportunities or revenue generated.
-   Fraud detection: financial losses prevented.
-   Logistics software: delivery costs reduced.
-   DevOps software: production downtime reduced.
-   Customer-support software: customer retention improved.

Suppose two sales agents produce the following results:

  Metric                  Agent A   Agent B
  --------------------- --------- ---------
  Prospects contacted      10,000     2,000
  Qualified leads             100       300
  Actual sales                  5        60

Charging per contact rewards Agent A, even though Agent B produces
substantially better results.

Charging for qualified leads or attributable sales better reflects the
customer's objective.

The difficulty is attribution. Revenue may depend on pricing, product
quality, sales staff, market conditions and other factors outside the
agent's control.

Outcome-based pricing therefore requires agreed definitions, baselines
and attribution rules.

### 3.4 Reliability and responsibility

AI-native software may take responsibility for execution, not merely
provide recommendations.

Customers consequently care about:

-   Accuracy and completion rates.
-   Availability and response time.
-   Security and compliance.
-   Recovery from failures.
-   Auditability and traceability.
-   Human escalation when necessary.
-   The ability to operate within defined permissions.

Consider two DevOps agents:

  Capability                   Agent A     Agent B
  ---------------------------- ----------- ----------
  Diagnoses incidents          Yes         Yes
  Executes remediation         Sometimes   Yes
  Verifies remediation         No          Yes
  Handles failed remediation   No          Yes
  Maintains an audit trail     Partial     Complete

Even if both agents diagnose the same number of incidents, Agent B
provides a stronger operational capability.

This suggests a distinct commercial proposition: customers may pay for a
capability delivered under measurable service levels.

Examples include:

-   Defined availability.
-   Agreed response and recovery times.
-   Minimum diagnostic-quality thresholds.
-   Controlled remediation permissions.
-   Escalation and rollback procedures.
-   Audit and compliance guarantees.

Reliability is not merely an implementation detail when software is
entrusted with operational work. It is part of the product.

### 3.5 Delegated capacity

Customers may also buy the capacity to delegate a defined volume of
work.

Examples:

-   10,000 support cases per month.
-   500 software-development tasks per month.
-   1,000 infrastructure investigations per month.
-   50,000 invoices processed per month.

This resembles capacity-based pricing, but the capacity is expressed in
business work rather than technical resources.

It offers predictable budgets and is easier to procure than a fully
variable outcome-based contract.

Its main challenge is defining comparable units. One support case may
take seconds, while another may require extensive investigation and
several system interactions.

A tiered model based on task categories or complexity can help.

------------------------------------------------------------------------

## 4. Value is not the same as cost

This distinction is central to AI economics.

There are two separate questions:

1.  How much does it cost the vendor to deliver the work?
2.  How much is the completed work worth to the customer?

Consider an AI agent investigating a production incident. It:

-   Consumes 100,000 input tokens.
-   Generates 10,000 output tokens.
-   Calls 15 tools.
-   Performs 30 internal processing steps.
-   Runs for three minutes.

These figures describe the cost and mechanics of delivery. They do not
establish the value delivered.

Perhaps the incident is resolved in three minutes, preventing
substantial business disruption. Alternatively, the agent consumes
similar resources and produces an incorrect diagnosis.

The production cost may be similar while the business value is radically
different.

### Vendor economics

The vendor needs to understand and optimise:

-   Model inference and token costs.
-   Tool and API consumption.
-   Compute and infrastructure.
-   Engineering and maintenance.
-   Human review and escalation.
-   Failure recovery.

### Customer economics

The customer cares about:

-   Work completed.
-   Labour saved or redeployed.
-   Revenue generated.
-   Risk reduced.
-   Time to completion.
-   Operational reliability.
-   Quality and correctness.

The vendor should optimise delivery costs while pricing primarily around
the value delivered.

Tokens, API calls and compute remain important. They are often
appropriate measures for internal cost management and for infrastructure
products. They are not, by themselves, reliable measures of business
value.

------------------------------------------------------------------------

## 5. A possible evolution of software pricing

Software pricing may evolve through several overlapping stages:

  -----------------------------------------------------------------------
  Stage                   Primary pricing basis   Example
  ----------------------- ----------------------- -----------------------
  Access-based            Access to functionality €50 per user per month

  Usage-based             Resources consumed      €0.01 per API request

  Task-based              Work processed or       €0.10 per processed
                          completed               invoice

  Outcome-based           Results achieved        €10 per qualified lead

  Capability-based        Operational capability  Managed incident
                          and service levels      detection and
                                                  remediation
  -----------------------------------------------------------------------

These models will coexist. Not every software product should adopt
outcome-based pricing.

A database remains infrastructure. Charging for storage, compute and
throughput can make sense.

A database-maintenance agent that independently diagnoses and resolves
performance problems is different. Its value may be better represented
by completed maintenance work or operational guarantees.

The pricing model should correspond to the actual value proposition.

------------------------------------------------------------------------

## 6. Implications for SaaS companies

The shift has consequences beyond pricing.

### 6.1 Seat-based revenue becomes vulnerable

If one employee can supervise many agents, the number of human users
becomes increasingly disconnected from the volume of work performed.

Traditional SaaS vendors may see seat counts decline even while
customers derive more value from their products.

They will need to consider pricing based on workflows, transactions,
delegated capacity or outcomes.

### 6.2 Functionality becomes less differentiated

Historically, software companies competed through features:

-   Better dashboards.
-   More integrations.
-   More configuration options.
-   Better workflow builders.
-   More sophisticated reporting.

AI makes it easier to reproduce many individual capabilities.

Competitive advantage may shift towards:

-   Proprietary and high-quality data.
-   Deep workflow integration.
-   Reliable execution.
-   Domain-specific knowledge.
-   Access to business systems.
-   Trust, security and compliance.
-   Demonstrable outcomes.

A company that merely provides an interface to a general-purpose AI
model may struggle to maintain pricing power.

### 6.3 Software companies may become service companies

Consider a traditional accounting software vendor.

Its business model is to sell accounting software to accountants.

An AI-native competitor could instead offer:

> We will process and reconcile your invoices, manage exceptions and
> provide completed monthly accounts.

The first sells software. The second sells an accounting operation.

The boundary between software vendors and service providers becomes
increasingly blurred. This is often described as the shift from SaaS to
**service-as-software**.

### 6.4 Vendors become more accountable for execution

When customers buy tools, they are responsible for operating those
tools.

When customers delegate work, they expect the software provider to take
greater responsibility for execution.

This changes contractual relationships, liability, service-level
agreements and customer expectations.

An agent cannot simply report that it attempted a task if the product
promises a completed result.

It needs to demonstrate that the task was completed correctly, or
explain why it could not complete it.

------------------------------------------------------------------------

## 7. A practical model: pay for verified work, with outcome-based incentives

Pure outcome-based pricing is attractive, but it is not always
practical.

It creates several problems:

-   Business outcomes may not be attributable to the software.
-   Tasks differ in complexity.
-   Customers and vendors may disagree about completion.
-   Revenue becomes unpredictable.
-   Vendors may be exposed to risks outside their control.

A hybrid model is likely to be more commercially sustainable.

### 1. Platform fee

Covers infrastructure, integrations, security, governance and baseline
availability.

This provides predictable recurring revenue.

### 2. Completed-work fee

Charges for successfully completed and verifiable tasks.

This scales revenue with actual work delivered.

### 3. Outcome incentive

Adds a performance component when agreed business outcomes are achieved.

This aligns vendor and customer incentives where attribution is
feasible.

### 4. Assurance or SLA fee

Covers reliability, compliance, availability, operational support and
defined service commitments.

This monetises trust and accountability.

### Example: AI-powered DevOps platform

  Component                Possible pricing basis
  ------------------------ ------------------------------------
  Platform                 Monthly subscription
  Incident investigation   Per verified investigation
  Automated remediation    Per successfully resolved incident
  Business impact          Optional performance incentive
  Enterprise assurance     SLA and compliance package

This model is more closely aligned with the value delivered than
charging for every token or agent invocation.

------------------------------------------------------------------------

## 8. The engineering challenge: what counts as completed work?

Defining the pricing unit is not merely a commercial exercise. It is
also an engineering problem.

Consider a customer-support agent:

1.  It receives a support ticket.
2.  It reads and classifies the ticket.
3.  It searches historical cases.
4.  It identifies a likely solution.
5.  It sends a response.
6.  The customer confirms whether the solution worked.
7.  The ticket is closed.

At which step should the vendor charge?

If the product promises ticket resolution, charging when the ticket is
received or when a response is sent may not reflect the promised value.
A verified resolution is a more defensible event.

But edge cases matter:

-   What if the customer never responds?
-   What if the ticket is closed automatically?
-   What if the proposed solution is correct but the customer does not
    implement it?
-   What if the same issue creates multiple tickets?
-   What if a human must intervene?
-   What if the agent makes an error that requires rework?

An AI-native pricing model therefore needs a measurable definition of
successful work.

At minimum, it should specify:

-   **Task definition:** What work was delegated?
-   **Completion condition:** What state constitutes completion?
-   **Quality threshold:** What level of correctness is required?
-   **Verification:** How is completion established?
-   **Exception handling:** What happens when the agent cannot complete
    the task?
-   **Attribution:** Which results can reasonably be credited to the
    software?
-   **Rework policy:** How are failed or repeated attempts treated?

There should also be a distinction between work that was attempted,
completed, verified and accepted.

This is one reason evaluation, observability, audit trails and workflow
state management become commercially important AI infrastructure.

------------------------------------------------------------------------

## 9. The deeper question: what is the ultimate unit of value?

Completed tasks are a useful commercial measure, but they are still an
intermediate outcome.

Businesses do not want more tasks completed simply for the sake of
completing tasks.

An organisation does not want 10,000 invoices processed merely because
invoice processing is available. It wants lower operating costs, faster
financial reporting, fewer errors and better cash-flow visibility.

Likewise, a DevOps team does not want 1,000 incidents investigated. It
wants less downtime, faster recovery, fewer recurring failures and more
reliable production environments.

This suggests a hierarchy of value:

1.  **Software execution:** Agent actions, tool calls, tokens and
    compute.
2.  **Completed work:** Tasks, workflows, transactions and deliverables.
3.  **Verified outcomes:** Resolved incidents, reconciled accounts,
    recovered revenue.
4.  **Business value:** Profitability, productivity, risk reduction and
    competitive advantage.

Moving up this hierarchy brings pricing closer to the customer's
economic interests. It also makes measurement and attribution more
difficult.

That is why **verified completed work is a practical commercial unit
today, while business outcomes are the ultimate target.**

------------------------------------------------------------------------

## 10. Conclusion

The transition to AI-native software requires a different way of
thinking about value.

Five propositions summarise the argument:

1.  **Stop pricing primarily around human access.** The number of
    employees using software is becoming a weaker proxy for the value it
    delivers.
2.  **Stop confusing consumption with value.** Tokens, API calls,
    compute and agent interactions are production costs, not necessarily
    customer value.
3.  **Start pricing around delegated work.** Customers should
    increasingly pay for tasks, workflows and responsibilities that
    software successfully performs.
4.  **Move towards outcome-based incentives.** Where outcomes can be
    measured and attributed, vendors should participate in the value
    they create.
5.  **Make reliability part of the product.** When software performs
    work autonomously, correctness, accountability and verification
    become essential parts of what customers purchase.

### The proposed unit of value

> **Verified work delivered, measured by its contribution to business
> outcomes.**

Customers should not primarily pay for how much software they use, how
many tokens AI consumes or how many actions an agent performs. They
should pay for useful work that gets done, the quality with which it is
done and the business value it creates.

There is a deeper implication.

In the traditional software economy, the product was software, and the
customer supplied the labour to turn it into value.

In the AI economy, the product increasingly includes the labour itself.

**We may be moving from a software economy to an execution economy.**

The most important question for a software company may no longer be:

*How many people use our product?*

It may instead be:

*How much valuable work can customers confidently delegate to us?*

------------------------------------------------------------------------

## Questions for further review

The argument raises several questions that deserve further examination:

1.  **Does every category of software need a new pricing model?**
    Infrastructure, developer tools, systems of record and autonomous
    agents may require different approaches.
2.  **Who defines successful completion?** The vendor, the customer or
    an independently measurable system?
3.  **How should vendors price work with very different levels of
    complexity and risk?**
4.  **How should liability be allocated when an autonomous agent makes a
    harmful decision?**
5.  **Will customers prefer predictable capacity subscriptions over
    variable outcome-based contracts?**
6.  **Could the strongest AI vendors become managed service providers
    rather than traditional software vendors?**
7.  **If agents increasingly purchase services and invoke other agents,
    what becomes the unit of value in an agent-to-agent economy?**

These questions are important because the transition is not simply a
change in billing mechanics. It is a change in what software companies
promise, what customers purchase and who is accountable for getting work
done.
