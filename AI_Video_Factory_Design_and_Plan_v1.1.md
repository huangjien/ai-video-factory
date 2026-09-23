# AI Video Factory

## 基于 Pi + MiniMax + GLM + Remotion 的低成本、可持续 AI 视频生产系统

**文档版本：v1.1-draft**\
**状态：设计评审稿（Draft for Review）**\
**目标：建立一个长期可演进、低成本、Human-in-the-Loop 的 AI
视频生产系统**

---

## 1. 文档目的

本文档定义一个面向技术类、AI 类、知识类 YouTube 视频的自动化生产系统。

系统目标不是"一键生成视频"，而是建立一个可控、可审查、可修改、可持续演进的生产流水线：

```text
Topic
  ↓
Research
  ↓
Script
  ↓
Storyboard
  ↓
Visual Design
  ↓
Render
  ↓
Review
  ↓
Final Video
```

其中人在关键节点拥有明确的：

- 查看权
- 修改权
- 批准权
- 驳回权
- 回退权
- 重做权

AI 负责提高生产效率，但不取代关键创作决策。

---

# 2. 核心设计原则

## 2.1 AI 不直接生成最终视频

采用：

```text
AI
 ↓
Structured Content
 ↓
Video DSL
 ↓
Remotion
 ↓
FFmpeg
 ↓
MP4
```

而不是：

```text
Prompt
 ↓
AI Video Generator
 ↓
MP4
```

这样可以保证：

- 可重复
- 可修改
- 可版本控制
- 可局部重渲染
- 可更换 AI 模型
- 可持续积累组件
- 可支持中文和英文
- 可支持未来不同视频平台

---

## 2.2 人在回路（Human-in-the-Loop）是核心机制

第一版不追求全自动。

核心流程：

```text
AI Generate
     ↓
Human Review
     ↓
Approve / Edit / Reject
     ↓
Next Stage
```

而不是：

```text
AI → AI → AI → Final
```

尤其是以下内容必须保留人工决策：

1.  主题定位
2.  Research 范围
3.  核心观点
4.  Script
5.  Storyboard
6.  视觉风格
7.  Final Review
8.  Publish

---

# 3. 产品定位

## 3.1 产品名称

暂定：

**AI Video Factory**

内部项目名：

```text
video-agent
```

---

## 3.2 目标用户

第一阶段主要为个人创作者使用。

重点场景：

- AI 技术解释
- 软件工程
- DevOps
- AI Agent
- LLM
- MCP
- Coding Agent
- 新技术介绍
- 技术教程
- 知识类视频

---

# 4. 技术栈

层 技术

---

Agent Orchestrator Pi
Agent Pi Agent
Subagent Pi Subagent
Skills Pi Skills
Primary AI MiniMax Coding Plan
Secondary AI GLM Coding Plan
Language TypeScript
Video UI React
Motion React + SVG
Video Engine Remotion
Encoding FFmpeg
Data Format YAML / JSON
Content Markdown
Version Control Git
Preview Remotion Studio
Optional Final Edit DaVinci Resolve Free

---

# 5. 明确不采用的技术

第一阶段不使用：

- Ollama
- 本地 LLM
- MCP
- Vector Database
- Supabase
- Electron
- Web Dashboard
- Cloud Rendering
- Full Timeline Editor
- AI Video Generation 作为核心渲染方案

这些技术可以在后续阶段加入，但不能增加第一版系统的复杂度。

---

# 6. AI Provider Strategy

系统必须做到 Model Agnostic。

不要把 MiniMax 或 GLM 写死在业务逻辑中。

建议：

```yaml
models:
  research:
    primary: glm
    fallback: minimax

  script:
    primary: minimax
    fallback: glm

  storyboard:
    primary: minimax
    fallback: glm

  visual:
    primary: minimax
    fallback: glm

  review:
    primary: glm
    fallback: minimax
```

最终允许：

```text
MiniMax
GLM
Claude
GPT
Gemini
其他模型
```

自由替换。

---

# 7. 总体架构

```text
                         USER
                           │
                           ▼
                    ┌─────────────┐
                    │     PI      │
                    │  DIRECTOR   │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       Researcher       Writer       Storyboarder
            │              │              │
            └──────────────┼──────────────┘
                           │
                           ▼
                         VDSL
                           │
                           ▼
                    Visual Designer
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
        Components       Images       AI Video
             │             │             │
             └─────────────┼─────────────┘
                           │
                           ▼
                        Remotion
                           │
                           ▼
                         FFmpeg
                           │
                           ▼
                       PREVIEW
                           │
                           ▼
                      Review Agent
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                   FIX           PASS
                    │             │
                    └─────►       ▼
                              FINAL
```

---

# 8. Human-in-the-Loop 设计

## 8.1 核心思想

每个阶段都有一个明确的：

```text
Checkpoint
```

Checkpoint 是人工与 Agent 之间的正式边界。

---

## 8.2 Checkpoint 类型

定义：

```text
AUTO
REVIEW
APPROVE
EDIT
REJECT
ROLLBACK
```

### AUTO

Agent 可以直接继续。

适用于：

- 文件格式转换
- 字幕生成
- 音频转换
- Render
- 校验
- 临时预览

---

### REVIEW

AI 生成结果后暂停。

用户查看：

```text
result
issues
changes
```

然后决定：

```text
Approve
Edit
Reject
```

---

### APPROVE

明确批准当前阶段结果。

批准后：

```text
stage.status = approved
```

并允许进入下一阶段。

---

### EDIT

用户直接修改生成文件。

例如：

```text
script.zh-CN.md
```

用户修改后：

```text
/video continue
```

Agent 从修改后的版本继续。

---

### REJECT

当前结果不接受。

用户可以：

```text
Regenerate
Change instructions
Go back
```

---

### ROLLBACK

返回之前的 checkpoint。

例如：

```text
Storyboard
    ↓
Render
    ↓
Review
    ↓
发现结构问题
    ↓
Rollback
    ↓
Storyboard
```

而不是重新从 Research 开始。

---

# 9. 推荐 Human Checkpoint

## Checkpoint 0 --- Project Brief

用户输入：

```text
Topic
Target audience
Language
Approx duration
Style
```

AI 生成：

```text
project brief
```

### 用户必须确认

```text
[Approve]
[Edit]
[Regenerate]
```

---

# 10. Checkpoint 1 --- Research

Agent 输出：

```text
research.md
sources.yaml
claims.yaml
```

用户检查：

- 事实
- 数据
- 来源
- 研究范围
- 是否遗漏关键内容
- 是否加入不需要的信息

### 用户操作

```text
Approve Research
Edit Research
Ask for More Research
Reject
```

只有 Approve 后才能进入 Script。

---

# 11. Checkpoint 2 --- Story Direction

这是一个新增的关键人工节点。

Research 完成后，不应该直接写长脚本。

先由 Agent 提出：

```text
核心观点
视频结构
叙事路线
Hook
主要 Example
结论
```

例如：

```text
核心问题：
为什么 AI 需要 Memory？

主线：
AI 为什么会忘记
→ Memory 是什么
→ Short-term vs Long-term
→ Agent Memory
→ 实际案例
→ 设计原则
```

用户在这里进行**内容方向调整**。

这是最值得人工介入的地方之一。

---

# 12. Checkpoint 3 --- Script

Agent 生成：

```text
script.zh-CN.md
```

用户检查：

- 内容是否准确
- 叙事是否自然
- 节奏
- Hook
- 技术深度
- 是否符合目标观众
- 是否有冗余

### 用户可以：

```text
Approve
Edit
Ask Agent to Rewrite Section
Regenerate
Rollback
```

---

# 13. Checkpoint 4 --- Storyboard

Agent 将 Script 转成：

```text
storyboard.yaml
```

用户查看：

```text
Scene 01
Scene 02
Scene 03
...
```

关键是让用户可以修改：

```text
Scene duration
Visual type
Narration
Caption
Animation
Transition
```

例如：

```yaml
scene-07:
  duration: 8

  visual:
    type: flowchart

  animation:
    entrance: sequential
```

用户可以直接改：

```yaml
visual:
  type: comparison
```

然后继续。

---

# 14. Checkpoint 5 --- Visual Design

这是第二个非常重要的创作节点。

Agent 产生：

```text
visual-plan.yaml
```

例如：

```yaml
scene-01:
  component: Title

scene-02:
  component: Problem

scene-03:
  component: FlowChart

scene-04:
  component: AgentLoop
```

用户可以调整：

```text
component
layout
color
animation
asset
```

只有视觉设计确认后才进入 Render。

---

# 15. Checkpoint 6 --- Preview

Render：

```text
preview.mp4
```

用户观看。

这里不要只让 Reviewer Agent 决定。

必须有人看最终视频。

---

# 16. Checkpoint 7 --- Review

同时运行：

```text
AI Reviewer
+
Human Reviewer
```

AI Review：

```text
fact
timing
readability
visual
audio
subtitle
```

Human Review：

```text
整体观感
叙事
节奏
风格
是否愿意发布
```

---

# 17. Checkpoint 8 --- Final Approval

最终：

```text
final.mp4
```

但仍然需要：

```text
Human Final Approval
```

之后才允许：

```text
publish
```

---

# 18. Human-in-the-Loop 状态机

定义：

```text
DRAFT
  ↓
GENERATED
  ↓
WAITING_REVIEW
  ↓
  ├── APPROVED ───────► NEXT
  │
  ├── EDIT ───────────► EDITING
  │                       ↓
  │                    REVIEW
  │
  ├── REGENERATE ─────► GENERATING
  │                       ↓
  │                    REVIEW
  │
  └── ROLLBACK ───────► PREVIOUS_CHECKPOINT
```

项目状态：

```yaml
status: waiting_review

current_stage: storyboard

checkpoint:
  id: storyboard-v3
  status: waiting_review
```

## 18.1 正式状态定义

项目状态只能从以下集合中选择：

```text
DRAFT          尚未开始当前阶段
GENERATING     Agent 或工具正在执行
VALIDATING     正在校验输出
WAITING_REVIEW 等待人工决定
EDITING        人工正在修改输入或输出
APPROVED       当前阶段已批准
FINAL_APPROVED 最终视频已批准，可进入发布流程
FAILED         当前执行失败，可重试
BLOCKED        缺少输入、权限或人工决定，无法继续
ROLLED_BACK    工作状态已回退
```

合法转换：

```text
DRAFT → GENERATING → VALIDATING → WAITING_REVIEW
                              ├→ FAILED → GENERATING
                              └→ BLOCKED
WAITING_REVIEW → APPROVED → NEXT_STAGE
WAITING_REVIEW → EDITING → VALIDATING
WAITING_REVIEW → GENERATING       (regenerate)
WAITING_REVIEW → ROLLED_BACK      (rollback)
```

每次状态转换必须记录 `run_id`、操作者、时间、输入 commit、输出 commit 和原因。重复执行同一个 `run_id` 必须是幂等的，不得重复生成或重复扣费。

## 18.2 回滚与依赖失效

回滚只改变 active workflow state，不删除 Git 历史、不覆盖已有输出。回滚前必须显示目标 checkpoint、将失效的阶段和需要重新执行的动作，并要求人工确认。

阶段依赖规则：

```yaml
dependencies:
  brief:
    invalidates:
      [research, direction, script, storyboard, visual, captions, render]
  research:
    invalidates: [direction, script, storyboard, visual, captions, render]
  direction:
    invalidates: [script, storyboard, visual, captions, render]
  script:
    invalidates: [storyboard, visual, captions, render]
  storyboard:
    invalidates: [visual, captions, render]
  visual:
    invalidates: [render]
```

只有受影响的下游阶段需要重新执行。未受影响的资产继续复用，但在新的运行记录中必须记录其来源 commit。

---

# 19. 不应该自动通过的阶段

以下阶段默认：

```text
Human Approval Required
```

```text
Project Brief
Research
Story Direction
Script
Storyboard
Visual Direction
Final Video
```

---

# 20. 可以自动通过的阶段

以下可以默认 AUTO：

```text
YAML validation
Type checking
Asset validation
Audio conversion
Subtitle formatting
Preview rendering
Temporary encoding
File organization
Git status
```

---

# 21. VDSL

VDSL：

> Video Description Language

是系统最重要的中间层。

---

## 21.1 Scene Schema

VDSL 是可执行渲染输入，不是自然语言脚本，也不是用户的主要编辑格式。

职责边界：

```text
Script       负责说什么
Storyboard   负责每个 Scene 表达什么
Visual Plan  负责选择组件、布局和素材
VDSL         负责描述如何执行渲染
Remotion     负责实际渲染
```

第一版只支持一个项目级 VDSL 文件。VDSL 必须带 schema 版本，所有时长统一使用秒，渲染器在内部转换为帧。

```yaml
schema_version: "0.1"

project:
  id: ai-cot
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

style:
  theme: dark-tech

scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
      audio: assets/audio/scene-01.wav
    visual:
      component: Title
      props:
        text: "AI Agent 为什么需要 Memory？"
    animation:
      entrance: fade
      emphasis: none
      exit: none
    captions:
      source: narration
      text: "AI Agent 为什么需要 Memory？"
    transition:
      in: fade
      out: cut
```

VDSL 校验规则：

- `schema_version`、`project`、`scenes` 必须存在。
- Scene ID 在项目内必须唯一，`duration` 必须大于 0。
- `visual.component` 必须注册在组件目录中。
- 所有引用的音频、图片、字体和代码文件必须存在。
- Scene 总时长、音频时长和字幕时间范围必须可校验；不一致时阻止 Final Render。
- 未知字段默认报错，避免 Agent 静默生成无效配置。
- Schema 变化必须通过迁移工具升级，不允许渲染器隐式猜测旧格式。

VDSL 与源文件的转换关系：

```text
script.zh-CN.md
        ↓
storyboard.yaml
        ↓
visual-plan.yaml
        ↓
vdsl.yaml
        ↓
validate → compile → render
```

`storyboard.yaml` 和 `visual-plan.yaml` 仍然保留，便于人工审阅；只有通过编译和校验的 `vdsl.yaml` 才能进入渲染。

---

# 22. Visual Types

第一版：

```text
title
text
image
code
terminal
browser
diagram
flowchart
timeline
comparison
quote
statistic
callout
split-screen
```

AI 技术类：

```text
neural-network
agent-loop
token-animation
attention
embedding-space
vector-search
rag
memory
tool-call
context-window
model-comparison
```

---

# 23. Motion Components

```text
components/
├── Title.tsx
├── Subtitle.tsx
├── Paragraph.tsx
├── Quote.tsx
├── CodeBlock.tsx
├── Terminal.tsx
├── Browser.tsx
├── Image.tsx
├── SplitScreen.tsx
├── Comparison.tsx
├── Timeline.tsx
├── FlowChart.tsx
├── NetworkGraph.tsx
├── Statistic.tsx
├── ProgressBar.tsx
├── Callout.tsx
├── AgentLoop.tsx
├── TokenAnimation.tsx
├── RAG.tsx
├── Memory.tsx
└── EndCard.tsx
```

---

# 24. Animation Primitives

第一版：

```text
fade
slide
scale
draw
typewriter
blur
reveal
zoom
wipe
counter
highlight
```

---

# 25. Style System

```yaml
style:
  typography:
    title:
    subtitle:
    body:
    code:

  colors:
    background:
    primary:
    secondary:
    accent:
    warning:
    success:

  spacing:
    unit: 8

  animation:
    defaultEasing:
```

Style 由项目统一控制，而不是由每个 Agent 自由发挥。

---

# 26. 中文 / 英文架构

语言是项目级配置：

```yaml
language: zh-CN
```

或者：

```yaml
language: en-US
```

不要要求一个视频同时包含中文和英文。

---

## 26.1 推荐结构

Storyboard 与语言无关：

```yaml
scene:
  concept:
    id: agent-memory

  visual:
    type: memory

  narration:
    zh-CN: >
      AI Agent 为什么需要 Memory？

    en-US: >
      Why do AI agents need memory?
```

因此：

```text
                Storyboard
                     │
             ┌───────┴───────┐
             ▼               ▼
          zh-CN             en-US
             │               │
             ▼               ▼
         Voice zh         Voice en
             │               │
             ▼               ▼
        Video zh          Video en
```

视觉内容可以复用。

---

# 27. Research Agent

输入：

```text
topic
audience
language
duration
```

输出：

```text
research/
├── research.md
├── sources.yaml
└── claims.yaml
```

Research Agent 不负责决定最终观点。

它负责：

- 收集信息
- 区分事实和观点
- 记录来源
- 标记不确定信息
- 提供不同解释
- 提出需要人工确认的事实

---

# 28. Script Agent

输入：

```text
research
story direction
```

输出：

```text
script.zh-CN.md
```

必须遵循：

```text
Hook
Problem
Explanation
Example
Comparison
Implication
Conclusion
```

但结构由用户和 Agent 共同调整。

---

# 29. Storyboard Agent

输入：

```text
approved script
```

输出：

```text
storyboard.yaml
```

Storyboard Agent 不允许：

- 修改核心事实
- 私自增加重要观点
- 改变已批准的核心叙事方向

如果发现 Script 无法有效视觉化，应提出：

```text
Storyboard Issue
```

而不是自行修改内容。

---

# 30. Visual Agent

负责：

```text
visual component selection
layout
animation
asset requirement
```

例如：

```yaml
scene-10:
  visual:
    component: FlowChart

  props:
    direction: left-to-right

  animation:
    type: sequential
```

---

# 31. Review Agent

Review 分为：

```text
Content Review
Visual Review
Technical Review
```

---

## Content Review

检查：

```text
accuracy
logic
unsupported claims
contradictions
repetition
```

---

## Visual Review

检查：

```text
readability
density
pacing
visual hierarchy
caption length
```

---

## Technical Review

检查：

```text
resolution
fps
audio
subtitle
missing assets
render errors
```

---

# 32. Agent 不应该拥有最终决定权

Review Agent 输出：

```yaml
status: revise
```

但不能直接：

```text
publish
```

Final Publish 永远需要 Human Approval。

---

# 33. 项目目录

```text
video-agent/
│
├── .pi/
│   ├── agents/
│   ├── skills/
│   └── extensions/
│
├── packages/
│   ├── vdsl/
│   ├── video-components/
│   ├── video-renderer/
│   └── media/
│
├── templates/
│   ├── youtube-tech/
│   ├── explainer/
│   └── tutorial/
│
└── projects/
    └── ai-cot/
```

---

# 34. 单视频项目

```text
projects/ai-cot/
│
├── project.yaml
│
├── brief/
│   └── brief.md
│
├── research/
│   ├── research.md
│   ├── sources.yaml
│   └── claims.yaml
│
├── direction/
│   └── story-direction.md
│
├── script/
│   ├── script.zh-CN.md
│   └── script.en-US.md
│
├── storyboard/
│   └── storyboard.yaml
│
├── visual/
│   └── visual-plan.yaml
│
├── vdsl/
│   └── vdsl.yaml
│
├── assets/
│   ├── images/
│   ├── video/
│   ├── audio/
│   ├── screenshots/
│   └── fonts/
│
├── captions/
│   ├── zh-CN.srt
│   └── en-US.srt
│
├── src/
│   ├── Root.tsx
│   ├── scenes/
│   └── components/
│
├── review/
│   ├── content-review.yaml
│   ├── visual-review.yaml
│   └── technical-review.yaml
│
├── checkpoints/
│   ├── brief.yaml
│   ├── research.yaml
│   ├── direction.yaml
│   ├── script.yaml
│   ├── storyboard.yaml
│   ├── visual.yaml
│   └── final.yaml
│
├── runs/
│   └── <run-id>.yaml
│
└── output/
    ├── preview.mp4
    └── final.mp4
```

---

# 35. Checkpoint 文件

每个 checkpoint 保存：

```yaml
id: storyboard-v3

stage: storyboard

status: approved

created_at:

approved_at:

input_commit:

output_commit:

human_changes:

notes:
```

这样 Git + Checkpoint 就形成完整的审查历史。

---

# 36. Git Workflow

每个重要阶段可以建立 commit：

```text
project-init
research-v1
research-approved
script-v1
script-approved
storyboard-v1
storyboard-approved
visual-v1
preview-v1
review-v1
final-v1
```

如果用户修改 Script：

```text
script-v2
```

不会覆盖历史版本。

---

# 37. Human Edit

人工编辑应该尽可能简单。

例如：

```text
Agent:
Script generated.

[Open Editor]
[Approve]
[Regenerate]
```

点击：

```text
Open Editor
```

调用系统默认编辑器。

Mac：

```bash
open script.zh-CN.md
```

Windows：

```bash
start script.zh-CN.md
```

Linux：

```bash
xdg-open script.zh-CN.md
```

用户编辑完成后返回 Pi：

```text
/video continue
```

系统重新读取文件。

---

# 38. 不做自己的编辑器

第一版不要开发：

```text
Markdown editor
Timeline editor
Script editor
```

使用操作系统默认编辑器即可。

未来如果需要，再加入 GUI。

---

# 39. Pi Commands

第一版：

```text
/video new
/video status
/video research
/video direction
/video script
/video storyboard
/video visual
/video preview
/video render
/video review
/video approve
/video reject
/video rollback
/video open
/video continue
/video final
```

---

# 40. `/video status`

应该显示：

```text
AI Video Factory

Project: ai-cot
Language: zh-CN

✓ Brief
✓ Research
✓ Story Direction
✓ Script
✓ Storyboard
● Visual Review
○ Render
○ Final Review

Current checkpoint:
visual-v2

Status:
WAITING_FOR_HUMAN_REVIEW
```

这是 Human-in-the-loop 的核心 UX。

---

# 41. `/video approve`

例如：

```text
/video approve
```

系统：

```text
Checkpoint visual-v2 approved.

Next stage:
Render

Continue? [Y/n]
```

这里可以自动继续，但仍然显示即将执行的动作。

---

# 42. `/video reject`

```text
/video reject
```

然后：

```text
Why?

1. Wrong visual
2. Wrong pacing
3. Wrong style
4. Missing information
5. Other
```

用户选择后：

```text
Reviewer feedback
```

保存到：

```text
checkpoints/visual.yaml
```

供下一轮 Agent 使用。

---

# 43. `/video rollback`

例如：

```text
/video rollback storyboard-v2
```

系统显示：

```text
This will reset working state to:

storyboard-v2

Current changes will remain in Git
but active workflow state will be rolled back.

Continue? [y/N]
```

需要人工确认。

---

# 44. AI 自动修改的边界

AI 可以自动修改：

```text
caption
animation
spacing
minor wording
timing
```

但不能未经确认修改：

```text
core thesis
approved facts
story direction
major script structure
approved visual style
```

---

# 45. Cost Strategy

由于已经拥有：

```text
MiniMax Coding Plan
GLM Coding Plan
```

不使用本地 LLM。

成本主要来自：

```text
LLM usage
TTS（核心功能不要求；edge-tts 可选）
Image generation
AI video generation
```

目标：

```text
普通技术视频：
约 $2–10 / finished video

特殊 AI Video / 大量生成素材：
约 $5–20+
```

实际成本取决于模型调用量和媒体生成量。

---

# 46. 不把成本优化放在第一优先级

优化顺序：

```text
Correctness
   ↓
Controllability
   ↓
Repeatability
   ↓
Quality
   ↓
Automation
   ↓
Cost optimization
```

而不是：

```text
Cost
 ↓
Everything else
```

因为你已经有两个 Coding Plan，第一阶段更应该优化生产流程。

---

# 47. 第一 Benchmark

第一条视频：

# 《AI 思维链有什么用？》

目标：

```text
Duration: 8–10 min
Scenes: 20–35
Language: zh-CN
```

以后再生成：

```text
en-US
```

---

# 48. Benchmark 内容要求

至少覆盖：

```text
Title
Hook
Concept
Diagram
Flowchart
Code
Comparison
AI architecture
Animation
Caption
Voice
Subtitle
Review
```

这样一条视频就可以验证整个系统。

---

# 49. Phase 0 --- Foundation

**目标：1 天**

建立：

```text
video-agent
```

安装：

```text
Node.js
TypeScript
Remotion
FFmpeg
Pi
```

建立 Git repository。

创建最小 Remotion 项目。

---

# 50. Phase 1 --- Motion Engine

**目标：2--3 天**

实现：

```text
Title
Text
Image
Code
Diagram
FlowChart
Comparison
Timeline
```

实现：

```text
fade
slide
scale
draw
typewriter
```

验收：

```text
storyboard.yaml
       ↓
Remotion
       ↓
30-second.mp4
```

---

# 51. Phase 2 --- VDSL

**目标：2--3 天**

实现：

```text
schema
validator
parser
compiler
```

命令：

```bash
video validate storyboard.yaml
```

---

# 52. Phase 3 --- Human Checkpoint Engine

**目标：2--3 天**

这是新版计划中优先级提高的一部分。

实现：

```text
checkpoint
approval
reject
edit
rollback
resume
```

必须先于大量 Agent 自动化。

---

# 53. Phase 4 --- Storyboard Agent

**目标：2--3 天**

实现：

```text
Script
 ↓
Storyboard Agent
 ↓
Storyboard
 ↓
Human Approval
 ↓
Render
```

---

# 54. Phase 5 --- Research + Script

**目标：3--5 天**

实现：

```text
Topic
 ↓
Research
 ↓
Human Approval
 ↓
Story Direction
 ↓
Human Approval
 ↓
Script
 ↓
Human Approval
```

---

# 55. Phase 6 --- Voice + Subtitle

**目标：2--4 天**

实现：

```text
Script
 ↓
TTS
 ↓
Audio
 ↓
Timestamp
 ↓
Subtitle
```

---

# 56. Phase 7 --- Review Agent

**目标：3--5 天**

实现：

```text
Content Review
Visual Review
Technical Review
```

并与 Human Review 合并。

---

# 57. Phase 8 --- Pi Extension

**目标：3--5 天**

把：

```text
Agents
Skills
Workflow
Checkpoint Engine
CLI
```

包装为：

```text
/video
```

---

# 58. Phase 9 --- YouTube Automation

后续：

```text
YouTube title
Description
Chapters
Thumbnail
Shorts
```

---

# 59. Phase 10 --- Advanced Media

最后才加入：

```text
AI Images
AI Video
Cloud Rendering
Advanced Audio
```

---

# 60. 里程碑

## M1

```text
YAML → MP4
```

## M2

```text
Script → Storyboard → MP4
```

## M3

```text
Topic → Research → Script → Storyboard → MP4
```

## M4

```text
Human-in-the-loop full workflow
```

## M5

```text
中文 + 英文
```

## M6

```text
Review + revision loop
```

## M7

```text
YouTube package
```

---

# 61. MVP 定义

MVP 不应该是：

> "一个能自动生成视频的 AI。"

MVP 应该是：

> **一个能够让人通过结构化文件控制 Storyboard → VDSL → Render，并在关键阶段暂停、回滚和恢复的技术视频生产系统。**

MVP 成功标准：

```text
Storyboard
 ↓
VDSL Validate
 ↓
Render
 ↓
[Human]
 ↓
Final MP4
```

---

# 62. v0.1 明确范围

v0.1 的目标不是覆盖完整生产链，而是稳定完成一条可重复的视频路径：

```text
手工 Topic
   ↓
手工 Research / Script
   ↓
手工 Storyboard
   ↓
VDSL 校验
   ↓
Remotion Render
   ↓
人工 Preview Review
   ↓
可复现的 MP4
```

v0.1 必须完成：

```text
TypeScript
React
Remotion
FFmpeg
YAML VDSL
10 个以内的基础 Motion Components
基础 Animation Primitives
schema validation
compile + render
checkpoint 状态机
approve / edit / reject / regenerate / rollback / resume
Git checkpoint 与运行记录
单语言 zh-CN
1920x1080 / 30fps
```

v0.1 暂不要求：

```text
自动 Research
自动 Script
多语言
TTS
自动字幕时间轴
AI 图片
AI Video
自动 Review Agent
Pi Extension
YouTube 发布
云渲染
数据库
Web Dashboard
```

Pi、MiniMax 和 GLM 属于 v0.2 的集成目标。v0.1 可以通过固定的本地输入文件和 CLI 验证完整渲染链，避免外部 API 阻塞核心工程。

TTS 演进策略：

```text
v0.1：edge-tts optional for prototype
v0.2：provider abstraction
```

v0.1 的 `edge-tts` 只作为可选原型工具，不是渲染闭环的硬依赖；生成失败时仍然可以使用预先准备的本地音频完成 benchmark。v0.2 开始通过统一 provider 接口隔离具体 TTS 服务，便于替换 edge-tts、Azure Speech 或其他正式服务。

v0.1 的唯一 benchmark：

```text
一个 30–60 秒、zh-CN、5–8 个 Scene 的技术解释视频
输入：手工 storyboard.yaml
输出：preview.mp4 和 final.mp4
要求：可重复渲染、可回滚、失败可恢复
```

下列内容属于 v0.2 及以后，不得作为 v0.1 的完成条件：

```text
MCP / Ollama / Database / Electron
Cloud rendering / AI Video / YouTube API
Research Agent / Script Agent / Review Agent
TTS / 多语言 / Web Dashboard
```

## 62.1 失败恢复与重试

每次执行都创建一个不可变的 `run_id`。运行记录保存输入 commit、命令、模型或工具版本、输出文件、状态、错误和重试次数。

失败状态：

```text
GENERATING → FAILED → GENERATING
                    └→ BLOCKED
```

恢复规则：

- 校验失败不得自动重试，应返回文件、字段、行号和修复建议。
- 网络或外部工具暂时失败可以重试，默认最多 3 次，并采用递增等待。
- 已成功生成的资产必须复用，不因下游失败而重复生成。
- `/video resume` 从最后一个成功步骤继续；不得从头执行整个项目。
- 同一输入 commit、同一配置和同一 `run_id` 的操作必须幂等。
- 人工解决 `BLOCKED` 状态后，必须显式执行 `resume`。

## 62.2 生成记录与可追溯性

每一次 Agent、脚本或渲染器执行都写入 `runs/`：

```yaml
run_id: render-2026-09-20T120000Z-001
stage: render
status: succeeded
actor: human-or-agent
tool: remotion
tool_version: "x.y.z"
input_commit: abc123
input_files: [vdsl.yaml, visual-plan.yaml]
output_files: [output/preview.mp4]
created_at: 2026-09-20T12:00:00Z
duration_ms: 42000
error: null
```

如果使用外部模型，额外记录：

```yaml
provider: minimax
model: model-id
prompt_hash: sha256:...
tokens:
  input: 0
  output: 0
estimated_cost_usd: 0
```

研究来源、素材来源、字体授权和人工修改也必须可以追溯。敏感凭证不得写入 Git、prompt 记录或运行日志。

## 62.3 测试策略

最低测试集合：

```text
Unit
  VDSL schema validation
  duration / frame conversion
  caption wrapping
  style resolution

Integration
  valid vdsl.yaml → preview.mp4
  invalid VDSL → readable validation error
  failed render → resume from last successful step
  rollback → expected active checkpoint

Regression
  fixed VDSL produces stable scene count, duration, fps and resolution
  registered components render without missing assets
```

每次修改 VDSL、组件或渲染器都必须运行校验、单元测试和 benchmark render。渲染输出不要求二进制完全一致，但必须满足结构和质量验收标准。

## 62.4 v0.1 质量验收标准

功能验收：

- 给定固定输入，可以完成 `validate → compile → render`。
- 输入错误时返回明确的文件、字段和行号。
- 可以 approve、edit、reject、regenerate、rollback、resume。
- 渲染失败后不会丢失已成功的中间产物。
- 回滚不会删除 Git 历史，且只重新执行受依赖影响的下游阶段。

视频验收：

- 输出为 1920x1080、30fps 的 MP4。
- 无黑帧、缺失素材、缺失字体或渲染错误。
- 音频存在时，音频时长与对应 Scene 可校验。
- 字幕位于安全区域，且不溢出画面。
- 所有 Scene 均有唯一 ID，最终视频时长等于 Scene 时长总和。
- 同一输入至少连续成功渲染两次，结果的 Scene 数量、总时长、分辨率和 fps 一致。

工程验收：

- benchmark 有完整 Git 历史和运行记录。
- 任意 Final 输出都能追溯到 VDSL、组件版本和输入 commit。
- 测试失败或质量验收失败时，不得进入 `FINAL_APPROVED`。

---

# 63. 长期演进

最终：

```text
                    AI VIDEO FACTORY
                           │
             ┌─────────────┼─────────────┐
             │             │             │
           Content        Visual        Media
             │             │             │
          Research       VDSL         Audio
          Script         Motion       Image
          Story          Components   Video
             │             │             │
             └─────────────┼─────────────┘
                           │
                      Render Engine
                           │
                      Review Engine
                           │
                    Human Approval
                           │
                     Distribution
```

---

# 64. 最重要的长期资产

项目长期积累的核心资产：

## 1. VDSL

AI → Video 的中间语言。

## 2. Motion Component Library

可重复使用的视觉组件。

## 3. Skills

把经验固化为可执行规则。

## 4. Review Rules

把人工经验逐步转化为自动检查。

## 5. Video Templates

不同视频类型的生产模板。

## 6. Project History

通过 Git 保存整个创作过程。

---

# 65. 最终设计原则

整个系统应该始终遵循：

```text
AI generates
Human decides
Code renders
Git remembers
```

更具体：

```text
AI：
Research
Draft
Suggest
Transform
Review

Human：
Direction
Selection
Correction
Approval
Final Decision

Code：
Validate
Render
Encode
Package

Git：
Version
History
Rollback
```

---

# 66. 下一步开发顺序

建议严格按照：

```text
1. Remotion 最小项目
        ↓
2. VDSL
        ↓
3. Motion Components
        ↓
4. Checkpoint Engine
        ↓
5. Storyboard Agent
        ↓
6. Research Agent
        ↓
7. Script Agent
        ↓
8. Voice / Subtitle
        ↓
9. Review Agent
        ↓
10. Pi Extension
        ↓
11. YouTube / Shorts
        ↓
12. AI Image / AI Video
```

**第一阶段不要跳过 Checkpoint Engine。**

因为 Human-in-the-loop 不是一个 UI 功能，而应该是整个 workflow
的基础设施。

---

# 67. Review Questions

本设计进入实现前，建议重点 Review 以下问题：

### A. Agent

- Agent 是否需要继续拆分？
- Director 是否应该是唯一拥有 workflow 控制权的 Agent？
- Research / Script / Storyboard 是否应该完全独立 context？

### B. Human-in-the-loop

- 哪些阶段必须人工批准？
- 哪些阶段可以 AUTO？
- 是否需要"局部批准"，例如只批准 Scene 1--10？
- 是否需要允许用户直接修改 YAML？

### C. VDSL

- Scene Schema 是否足够？
- 是否需要把 Audio / Voice 从 Scene 中独立出来？
- 是否需要 Timeline 层？
- 是否需要支持 reusable Scene Template？

### D. Visual System

- 第一批 Motion Components 是否足够？
- AI 技术视频是否需要专门的 AI visualization DSL？

### E. Language

- 是否需要从第一版开始支持 `zh-CN` + `en-US`？
- 是否采用 language-independent storyboard？

### F. Storage

- Git 是否足够？
- 是否需要保存每次 AI generation 的 prompt / model / token / cost？

### G. Model

- MiniMax / GLM 是否应该由 Agent Role Router 动态选择？
- 是否需要记录每一次模型调用，形成成本和质量统计？

### H. Product

- 第一版是否坚持 Pi TUI？
- 是否暂时完全不做 Electron？
- 是否应该先做 CLI，再做 Pi Extension？

---

# 68. 当前推荐的最终方向

```text
                 HUMAN
                   │
                   ▼
                  PI
                   │
             DIRECTOR AGENT
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
 RESEARCHER      WRITER     STORYBOARDER
      │            │            │
      └────────────┼────────────┘
                   │
              HUMAN CHECKPOINT
                   │
                   ▼
                  VDSL
                   │
             VISUAL DESIGNER
                   │
              HUMAN CHECKPOINT
                   │
                   ▼
               REMOTION
                   │
                 FFMPEG
                   │
                   ▼
                PREVIEW
                   │
                   ▼
             AI REVIEWER
                   │
                   ▼
             HUMAN REVIEW
                   │
             ┌─────┴─────┐
             ▼           ▼
           REVISE       APPROVE
             │           │
             └─────►     ▼
                      FINAL
```

这套架构的目标不是追求"完全自动化"，而是首先建立一个**人可以随时接管、AI
可以随时替换、视频可以重复生成、每一步都有版本记录**的生产系统。
