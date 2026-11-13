# 从军事 Mission Command 到 AI Agent：重新思考 Agent 的设计

## 引言

军事领域的 **Mission Command（任务式指挥）** 不仅可以用来类比 AI
Agent，也可以为 Agent Architecture 提供一套有价值的设计思想。

两者面对的问题有相似之处：

-   环境复杂，信息不完整。
-   执行过程中经常出现无法预先预测的情况。
-   中央指挥者无法掌握所有现场信息。
-   执行单元需要根据实际情况自主判断。
-   自主行动必须受到共同目标、规则和权限的约束。
-   最终必须对任务结果负责。

传统软件程序通常由开发者预先定义执行路径。Agent
则更多是由开发者定义目标、约束和可用能力，再由 Agent
根据上下文决定具体行动。

因此，Agent Engineering 的一个核心问题是：

> 如何在不完全控制 Agent
> 每一步行为的情况下，仍然能够保证整个系统按照预期目标运行？

Mission Command 提供了一个重要思路：

> 不要试图控制执行单元的每一个动作，而应该让它理解任务意图、明确成功目标、遵守行动边界，并对最终结果负责。

------------------------------------------------------------------------

## 一、军事 Mission Command 的核心思想

### 1. 传统命令式指挥

在传统命令式指挥模式中，上级通常规定任务目标和具体行动方式，下级按照命令执行。

``` mermaid
flowchart TD
    A["Commander<br/>决定做什么、怎么做"] --> B["Subordinate Unit<br/>按照命令执行"]
    B --> C["Execution<br/>执行预先规定的步骤"]
```

这种模式适合环境稳定、行动路径明确的任务，但在复杂环境下可能出现问题。

例如，上级命令一个单位在指定时间抵达某个地点，中途却发生道路坍塌。执行单位可能需要停止行动、报告情况并等待新的命令。

### 2. Mission Command：任务式指挥

Mission Command
更强调：上级明确任务意图、目标和边界，下级根据现场情况选择实现方式。

``` mermaid
flowchart TD
    A["Commander's Intent<br/>为什么执行、希望实现什么"] --> B["Delegated Authority<br/>明确规则、边界和自主权限"]
    B --> C["Autonomous Execution<br/>根据现场情况选择行动方式"]
    C --> D["Mission Assessment<br/>检查任务结果"]
    D --> E{"任务是否完成？"}
    E -->|否| C
    E -->|是| F["报告结果"]
```

核心变化是：

> **从控制行动过程，转向控制行动意图和结果。**

这不是取消上下级关系，而是重新分配决策权。下级仍然必须遵守上级意图、规则和授权边界。

------------------------------------------------------------------------

## 二、把 Mission Command 转换成 Agent Design

一个 Agent 的设计至少需要明确六个维度：

1.  **Purpose：为什么执行？**
2.  **Goal：最终实现什么？**
3.  **Constraints：哪些事情不可妥协？**
4.  **Autonomy：可以自主到什么程度？**
5.  **Evaluation：如何判断是否完成？**
6.  **Termination：什么时候停止？**

这些维度可以与 Mission Command 的概念建立对应关系。

  --------------------------------------------------------------------------------
  Mission Command         AI Agent Design         设计意义
  ----------------------- ----------------------- --------------------------------
  Commander's Intent      Purpose + Goal          理解任务意图

  Mission Orders          Task Specification      明确任务要求

  Rules of Engagement     Constraints /           定义不可逾越的边界
                          Guardrails              

  Delegated Authority     Autonomy / Permissions  定义自主决策权限

  Mutual Trust            Calibrated Trust        根据能力和验证结果确定信任程度

  Shared Understanding    Context / Shared Memory 共享必要的任务上下文

  Disciplined Initiative  Autonomous Reasoning    在授权范围内主动决策

  Risk Acceptance         Risk Policy             明确风险容忍度

  Mission Assessment      Evaluation              验证任务执行效果
  --------------------------------------------------------------------------------

军事 Mission Command
并不是简单地告诉下级"自己想办法"。它建立在能力、信任、共同理解和纪律之上。

同样，不能因为 AI Agent
能够调用工具，就认为它已经具备可靠的自主行动能力。Agent 还必须具备：

-   对任务的正确理解。
-   对自身能力的正确认识。
-   对行动权限的准确判断。
-   对执行结果的验证能力。

------------------------------------------------------------------------

## 三、Agent 不应该只接收 Task，而应该接收 Mission

这是最重要的设计转变之一。

### 1. Task-oriented Prompt

传统的任务描述可能是：

``` text
Task:
Analyze the Jenkins pipeline failure.

Instructions:
1. Read the logs.
2. Identify the error.
3. Suggest a solution.
```

这种 Prompt
规定了要做什么，以及大致怎么做，但没有充分描述任务背后的意图、成功标准和行动边界。

### 2. Mission-oriented Brief

采用 Mission Command 思想，可以改为：

``` yaml
mission:
  purpose: >
    Restore CI/CD availability and minimize
    disruption to software delivery.

  objective: >
    Identify the root cause of the Jenkins pipeline
    failure and provide a verified recovery plan.

  success_criteria:
    - Identify the failed pipeline stage.
    - Determine the root cause or document
      the remaining uncertainty.
    - Identify the responsible component or team.
    - Provide an actionable recovery plan.

  constraints:
    hard:
      - Never expose credentials or secrets.
      - Never modify production configuration
        without authorization.
      - Never claim success without verification.
      - Preserve diagnostic evidence.
    soft:
      - Prefer reversible changes.
      - Minimize service disruption.

  authority:
    allowed:
      - Read Jenkins logs.
      - Inspect pipeline configuration.
      - Search GitHub issues.
      - Analyze recent commits.
      - Generate troubleshooting recommendations.

    requires_approval:
      - Modify production pipeline configuration.
      - Restart production services.
      - Trigger production deployments.

    prohibited:
      - Delete production data.
      - Expose credentials.

  evaluation:
    - Verify findings against pipeline logs.
    - Check whether the proposed solution
      addresses the identified root cause.
    - Report confidence and unresolved questions.

  termination:
    success:
      - Root cause and recovery plan are verified.
    stop_conditions:
      - Required information is unavailable.
      - Investigation budget is exhausted.
      - Further action requires authorization.
```

这份 Mission Brief 有六个重要特点：

1.  Agent 知道为什么要执行任务。
2.  Agent 知道最终需要交付什么。
3.  Agent 知道哪些事情不能做。
4.  Agent 知道自己拥有哪些权限。
5.  Agent 知道如何验证工作成果。
6.  Agent 知道什么时候应该停止。

更重要的是，没有规定 Agent 必须先读取哪个日志，再查询哪个 GitHub
Issue，最后调用哪个工具。它可以根据实际情况选择调查路径。

这就是从 **Task-oriented Agent** 向 **Mission-oriented Agent** 的转变。

------------------------------------------------------------------------

## 四、Agent Architecture：从 Workflow 转向 Mission-oriented Architecture

### 1. Workflow-oriented Agent

``` mermaid
flowchart TD
    A["User Request"] --> B["LLM"]
    B --> C["Predefined Workflow"]
    C --> D["Step 1: Read Logs"]
    D --> E["Step 2: Analyze"]
    E --> F["Step 3: Report"]
    F --> G["Output"]
```

特点：

-   执行路径相对固定。
-   每一步都有预先定义的逻辑。
-   比较容易测试和控制。
-   遇到预期之外的情况时，灵活性有限。

这并不是错误的架构。对于确定性强、步骤稳定的任务，Workflow 往往更可靠。

### 2. Mission-oriented Agent

``` mermaid
flowchart TD
    A["Mission Brief<br/>Purpose · Goal · Constraints · Authority"] --> B["Agent Runtime<br/>Context · Planning · Reasoning · Policy Enforcement"]
    B --> C["Observe<br/>获取信息、检查环境"]
    C --> D["Orient<br/>理解上下文、更新判断"]
    D --> E["Decide<br/>选择下一步行动"]
    E --> F["Act<br/>调用工具、执行操作"]
    F --> G["Evaluate<br/>验证结果、更新状态"]
    G --> H{"任务完成？"}
    H -->|否，继续调查| C
    H -->|是| I["Mission Assessment<br/>报告结果"]
    H -->|需要审批| J["Human Approval"]
    J -->|批准| F
    J -->|拒绝或修改| K["停止或重新规划"]
```

这里的动态执行循环可以概括为：

**Observe → Orient → Decide → Act → Evaluate**

它与 OODA Loop（Observe, Orient, Decide, Act）有一定关联。Mission
Command 定义任务意图和行动边界；OODA Loop 则可以帮助设计 Agent
的动态决策过程。两者互补，但不是同一个概念。

### 3. 两种架构的关系

  任务类型                推荐方式
  ----------------------- -----------------------------------
  固定格式的数据转换      Workflow
  固定步骤的 CI/CD 流程   Workflow
  Jenkins 故障调查        Mission-oriented Agent
  跨系统故障 RCA          Mission-oriented Agent
  多团队问题协调          Multi-agent Mission
  生产环境自动修复        Mission-oriented Agent + 严格审批

> **Workflow 规定确定性流程，Mission-oriented Agent 处理不确定性。**

实际系统通常需要两者组合，而不是相互取代。

------------------------------------------------------------------------

## 五、Multi-Agent System：把军队组织结构引入 Agent 协作

当系统包含多个 Agent 时，就会遇到与大型组织相似的问题：

-   谁决定总体目标？
-   谁负责分配任务？
-   子 Agent 是否可以自主决定执行方式？
-   不同 Agent 如何共享信息？
-   如何处理任务冲突？
-   谁对最终结果负责？

可以参考军队组织思想，建立分层、授权、可协作的 Agent 体系。

### 1. 一种分层组织结构

``` mermaid
flowchart TD
    S["Strategic Agent<br/>战略层：理解整体目标、制定 Mission"]
    C["Mission Coordinator<br/>任务层：拆解 Mission、分配职责、协调依赖"]

    S --> C

    C --> J["Jenkins Agent<br/>Pipeline 分析"]
    C --> G["GitHub Agent<br/>代码与提交分析"]
    C --> A["Azure Agent<br/>基础设施分析"]

    J --> E["Evaluation / Review Agent<br/>独立验证证据、结果和约束符合性"]
    G --> E
    A --> E

    E --> R["Coordinator 汇总结果"]
    R --> O["Mission Outcome"]
```

职责可以这样划分：

-   **Strategic Agent：** 确定总体目标、优先级和 Mission。
-   **Mission Coordinator：** 拆解任务、分配职责、协调依赖。
-   **Specialist Agents：** 在各自专业领域内自主调查和执行。
-   **Evaluation Agent：** 独立检查证据、结果和约束符合性。

Strategic Agent 不应该管理所有执行细节，Coordinator 也不应该替代每个专业
Agent 的判断。

### 2. 避免每个 Agent 都成为一个管理层

一个常见的架构陷阱是过度嵌套：

``` mermaid
flowchart TD
    M["Main Agent"]
    M --> A["Manager Agent A"]
    M --> B["Manager Agent B"]
    A --> A1["Worker Agent A1"]
    A --> A2["Worker Agent A2"]
    B --> B1["Worker Agent B1"]
    B --> B2["Worker Agent B2"]
```

这可能产生：

-   过多的 Agent-to-Agent 通信。
-   上下文重复传递。
-   多次 LLM 调用。
-   决策延迟。
-   Manager Agent 成为瓶颈。
-   职责重叠和责任不清。

组织层级应该服务于协调，而不是为了层级本身而存在。

建议：

-   只有确实需要协调多个任务的地方才设置 Coordinator。
-   专业 Agent 应直接完成职责范围内的工作。
-   可以并行的任务不必串行等待。
-   简单任务不必经过多层 Agent。
-   Agent 之间通过明确的任务协议直接协作。

### 3. 根据任务复杂度动态组织 Agent

简单任务可以直接交给专业 Agent：

``` mermaid
flowchart TD
    U["User"] --> J["Jenkins Agent"]
    J --> R["Result"]
```

复杂任务则动态组建执行团队：

``` mermaid
flowchart TD
    U["User"] --> C["Mission Coordinator"]
    C --> J["Jenkins Agent"]
    C --> G["GitHub Agent"]
    C --> A["Azure Agent"]
    C --> N["Network Agent"]
    J --> E["Evaluation Agent"]
    G --> E
    A --> E
    N --> E
    E --> R["Final Result"]
```

这可以称为 **Dynamic Agent Organization（动态 Agent 组织）**。

更现实的方案是保留稳定的专业 Agent 和权限体系，根据 Mission
动态组建执行团队；只在需要协调的地方创建
Coordinator，任务完成后释放临时协调关系。

------------------------------------------------------------------------

## 六、Agent 的自主权应该如何设计？

Mission Command 中一个非常重要的概念是 **Delegated Authority（授权）**。

很多 Agent 项目会定义可以使用哪些 Tools、访问哪些
APIs、读取哪些数据，但这并不等于定义了它可以自主决定什么。

例如，Agent 有 Jenkins Restart API
的访问权限，不代表它应该在任何情况下自主重启 Jenkins。

建议把 Agent 权限分成四个维度：

  权限类型                含义               示例
  ----------------------- ------------------ -------------------
  Information Authority   可以获取什么信息   读取 Jenkins 日志
  Decision Authority      可以自主决定什么   判断故障责任组件
  Execution Authority     可以执行什么操作   创建 GitHub Issue
  Approval Authority      哪些操作需要批准   重启生产 Jenkins

### 1. 自主程度分级

以下是一个可用于工程设计的建议模型，并非通用行业标准。

  等级   名称                    能力
  ------ ----------------------- ----------------------------------------
  L0     Observe                 读取数据、分析日志，不执行变更
  L1     Recommend               分析、规划和提出方案，实际操作由人完成
  L2     Execute with Approval   准备操作，获得授权后执行
  L3     Autonomous Execution    在明确授权范围内自主执行、验证和恢复

``` mermaid
flowchart TD
    L0["L0 Observe<br/>只观察"] --> L1["L1 Recommend<br/>提出建议"]
    L1 --> L2["L2 Execute with Approval<br/>审批后执行"]
    L2 --> L3["L3 Autonomous Execution<br/>授权范围内自主执行"]
```

### 2. DevOps 操作权限示例

  操作                  建议权限
  --------------------- --------------------------------
  查询 Jenkins 日志     L3
  分析 Pipeline 失败    L3
  搜索 GitHub Issues    L3
  创建普通 Issue        有明确规则时可 L3
  修改非生产 Pipeline   L2 或按变更策略授权 L3
  重启生产 Jenkins      L2
  删除生产数据库数据    禁止或采用极严格的人工审批流程

最重要的原则是：

> **Agent 的自主权应该按操作和资源授权，而不是给 Agent 一个笼统的 Admin
> 权限。**

例如，允许 Jenkins Agent
重启某个测试环境实例，并不代表它可以重启整个生产 Jenkins 集群。

权限必须能够由 Runtime 强制执行，而不能只依赖 Prompt 中的文字约定。

------------------------------------------------------------------------

## 七、Mission Brief：Agent 的标准输入协议

如果将上述思想落实到工程设计，建议建立统一的 **Agent Mission Brief**。

它相当于军事组织中的 Mission Orders，是 Runtime
可以读取、验证和执行的结构化任务定义。

  字段               说明
  ------------------ -------------------------
  Mission ID         唯一任务标识
  Purpose            为什么执行
  Objective          最终希望实现什么
  Success Criteria   如何判断成功
  Context            已知背景和相关信息
  Constraints        不可违反的规则
  Authority          可使用的工具和自主权限
  Resources          可用资源和预算
  Dependencies       依赖的其他 Agent 或任务
  Evaluation         验收和验证方式
  Termination        停止条件

### Mission Brief 示例

``` yaml
mission:
  id: "devops-incident-001"

  purpose: >
    Restore CI/CD availability and minimize
    disruption to software delivery.

  objective: >
    Investigate the Jenkins pipeline failure
    and deliver a verified recovery plan.

  success_criteria:
    - Failure stage identified
    - Root cause established or uncertainty documented
    - Responsible component identified
    - Recovery plan verified

  context:
    environment: production
    service: jenkins
    priority: P1

  constraints:
    hard:
      - Never expose credentials
      - Never delete production data
      - Never bypass security controls
    soft:
      - Prefer reversible changes
      - Minimize service disruption

  authority:
    information:
      - read_jenkins_logs
      - read_github_repositories
      - inspect_azure_resources

    decisions:
      - identify_root_cause
      - classify_incident
      - recommend_recovery

    execution:
      - create_github_issue

    approval_required:
      - modify_production_pipeline
      - restart_production_service
      - deploy_to_production

  resources:
    max_llm_calls: 30
    max_execution_time_minutes: 15

  dependencies:
    - github-agent
    - azure-agent

  evaluation:
    - verify_findings_against_logs
    - cross_check_recent_commits
    - validate_recovery_plan

  termination:
    success:
      - recovery_plan_verified
    failure:
      - insufficient_evidence
      - execution_budget_exceeded
      - human_approval_required
```

### Mission Brief 与软件组件的映射

  Mission Brief 字段    建议负责的组件
  --------------------- -----------------------------------
  Purpose / Objective   Agent Instructions / Task Context
  Context               Context Manager / Memory
  Constraints           Policy Engine / Guardrails
  Authority             Tool Registry / Permission System
  Resources             Runtime / Budget Controller
  Success Criteria      Evaluator
  Termination           Orchestrator
  Dependencies          Mission Coordinator

关键区别在于：Mission Brief 不只是
Prompt。它应该是运行时可以读取、验证和执行的结构化任务定义。

例如：

-   `constraints` 应由 Policy Engine 强制执行。
-   `authority` 应由 Tool Permission System 强制执行。
-   `resources` 应由 Runtime 监控。
-   `success_criteria` 应交给 Evaluator 验证。
-   `termination` 应由 Orchestrator 控制。

------------------------------------------------------------------------

## 八、Agent Engineering 中还需要解决的三个问题

### 1. 如何建立 Agent 之间的信任？

军事组织中的 Mutual Trust 来自训练、经验和长期协作。

AI Agent 不应该因为模型表现得很有自信，就获得更高权限。

建议建立基于能力和验证结果的信任机制：

  信任依据              评估方式
  --------------------- --------------------
  Task Competence       历史任务成功率
  Tool Reliability      工具调用成功率
  Result Accuracy       结果准确率
  Policy Compliance     规则遵守情况
  Recovery Capability   错误检测和恢复能力

权限升级应该经过明确的策略审核，而不是由模型自行决定。

### 2. 如何避免多个 Agent 产生冲突？

例如：

-   Jenkins Agent 建议重启 Jenkins。
-   Azure Agent 认为问题来自网络。
-   Security Agent 禁止在当前时间窗口进行服务重启。

需要明确的冲突处理机制：

1.  安全和硬性约束优先。
2.  任务负责人负责协调。
3.  专业 Agent 提供证据和建议，而不是无限争夺决策权。
4.  超出授权范围时交给人类决策。
5.  所有重要决策保留审计记录。

关键不是让 Coordinator
永远做出正确判断，而是确保冲突能够被发现、处理和追踪。

### 3. Agent 是否应该拥有自己的 Mission？

答案是肯定的，但必须区分两种情况：

-   **Assigned Mission：** 上级分配的任务。
-   **Self-generated Sub-mission：** Agent 为实现目标自行生成的子任务。

例如，Jenkins Agent 接到调查 Pipeline
失败的任务后，可以自行创建一个子任务：检查最近一次代码提交。

Agent 可以自主产生子任务，但这些子任务必须：

-   服务于原始 Mission。
-   不突破原始约束。
-   不超过授权权限。
-   不超出资源预算。
-   能够追溯到原始任务。

``` mermaid
flowchart TD
    R["Root Mission"]
    R --> A["Sub-mission A"]
    R --> B["Sub-mission B"]
    A --> A1["Task A1"]
    A --> A2["Task A2"]
    B --> B1["Task B1"]
    B --> B2["Task B2"]
```

每个子任务都应该继承父 Mission 的硬性约束和权限上限。子 Agent
不能通过创建新的 Sub-mission 来绕过父任务限制。

------------------------------------------------------------------------

## 九、Agent 时代还需要 Manager Agent 吗？

传统企业和军队采用层级结构，是因为人类个体的管理能力、信息处理能力和沟通能力存在限制。

AI Agent 具有不同特点：

-   可以并行处理多个任务。
-   可以快速读取大量信息。
-   可以通过标准化接口共享结构化数据。
-   可以根据任务动态创建子任务。
-   可以通过程序进行权限控制和结果验证。

这意味着未来的 Agent 组织可能不再需要传统意义上的固定管理层级。

可以探索三种组织模式。

### 模式 A：Hierarchical Agents

``` mermaid
flowchart TD
    S["Strategic Agent"] --> C["Coordinator"]
    C --> A["Agent A"]
    C --> B["Agent B"]
    C --> D["Agent C"]
```

适合目标集中、职责明确、需要统一协调的任务。

### 模式 B：Flat Agent Teams

``` mermaid
flowchart TD
    A["Agent A"] <--> B["Agent B"]
    B <--> C["Agent C"]
    A <--> C
    A <--> D["Shared Context"]
    B <--> D
    C <--> D
```

适合专业 Agent
之间可以直接协作、任务依赖较少的场景。需要额外机制处理冲突、共享状态和权限边界。

### 模式 C：Dynamic Agent Organization

``` mermaid
flowchart TD
    M["Mission"] --> P{"分析任务复杂度和依赖"}
    P -->|简单任务| S["直接委派给专业 Agent"]
    P -->|复杂任务| C["创建临时 Coordinator"]
    C --> A["组建专业 Agent 团队"]
    A --> E["执行与评估"]
    S --> E
    E --> R["Mission Result"]
    R --> X["释放临时协调关系"]
```

更值得探索的是动态组织模式，但它不意味着每次任务都重新创造一套组织。较现实的方案是：

-   保留稳定的专业 Agent 和权限体系。
-   根据 Mission 动态组建执行团队。
-   只在需要协调的地方创建 Coordinator。
-   任务完成后释放临时协调关系。
-   由统一 Runtime 管理资源、权限和审计。

------------------------------------------------------------------------

## 十、Agent Design Principles

将军事 Mission Command、扁平化组织和 Agent Engineering
结合，可以总结为八条设计原则：

  ------------------------------------------------------------------------------------
  \#                      原则                    设计要求
  ----------------------- ----------------------- ------------------------------------
  1                       Intent over             定义任务意图，而不是规定每一个动作
                          Instructions            

  2                       Goals over Procedures   以目标和成功标准为核心

  3                       Constraints before      先建立约束，再授予自主权
                          Autonomy                

  4                       Authority near          决策权尽可能靠近执行单元
                          Execution               

  5                       Trust through           用能力评估和验证建立信任
                          Verification            

  6                       Shared Context          共享任务目标、背景和必要信息

  7                       Dynamic Organization    根据任务复杂度组织 Agent

  8                       Accountability through  每个 Agent
                          Evaluation              都必须能够验证自己的任务结果
  ------------------------------------------------------------------------------------

### 需要注意的边界

Mission Command 是一种指挥与组织哲学，而不是一套可以直接复制的软件架构。

军事组织与 AI Agent 并不完全相同：

-   AI Agent 没有人类指挥官的责任意识。
-   Agent 的能力可能随着模型、上下文和工具变化。
-   Agent 之间的信任必须建立在可测量的验证机制上。
-   现实世界的授权和责任最终仍然需要由人类组织承担。

因此，不能仅仅通过 Prompt 告诉 Agent"你可以自主行动"，就认为已经实现了
Mission Command。

必须有 Runtime、Policy Engine、Permission System、Evaluator 和 Audit Log
等机制配合。

------------------------------------------------------------------------

## 十一、结论：Mission-oriented Agent

> **不要把 Agent 设计成一个等待指令的执行器，而应该把它设计成一个接受
> Mission、理解 Intent、拥有明确 Authority，并对 Mission Outcome
> 负责的自主执行单元。**

三个核心支柱：

### Centralized Intent

统一目标、规则、资源和战略方向。

### Decentralized Execution

分散决策、专业协作、自主执行。

### Continuous Evaluation

持续验证、风险控制、结果负责。

这可以概括为：

> **We should manage the mission, not micromanage the agent.**

管理 Mission，而不是事无巨细地管理 Agent。

这可能是从 Workflow Engineering 走向 Agentic Engineering
时，一个重要的思维转变。

------------------------------------------------------------------------

## 延伸研究方向

1.  **Mission Protocol：** 定义标准化 Mission Brief
    Schema、版本控制和任务继承规则。
2.  **Agent Authority Model：**
    建立基于身份、资源、操作和风险等级的细粒度权限体系。
3.  **Mission Runtime：** 实现任务分解、动态调度、预算管理、暂停和恢复。
4.  **Agent Evaluation：** 建立任务级、工具级和策略合规性的评估机制。
5.  **Dynamic Agent Organization：** 研究何时需要
    Coordinator、何时适合扁平协作。
6.  **Human Command Interface：**
    为人类提供任务授权、审批、监督和接管能力。

## 参考概念

-   Mission Command
-   Auftragstaktik
-   Commander's Intent
-   Mission Orders
-   Delegated Authority
-   Disciplined Initiative
-   OODA Loop
-   Multi-Agent Systems
-   Human-in-the-loop
-   Policy Enforcement
-   Agent Evaluation
