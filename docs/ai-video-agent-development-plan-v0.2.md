# AI 视频 Agent：改进版开发设计与实施计划

> 版本：v0.2  
> 更新时间：2026-10-02  
> 状态：Architecture / Implementation Plan  
> 目标：基于 Agent + Skills + Remotion + iart，构建一个支持 Storyboard → Scene → Motion Graphics / Hand-drawn Animation → Automated Editing → MP4 的 AI 视频生产系统。
>
> 核心原则：**Agent-first、Human-in-the-loop、结构化中间表示、确定性渲染、可局部修改、可恢复。**

---

# 1. 项目目标

构建一个自己的 AI-assisted video production system。

系统不是简单地：

```text
Prompt → AI Video Model → MP4
```

而是：

```text
Idea / Script
      ↓
Story
      ↓
Storyboard
      ↓
Scene Specification
      ↓
Visual / Motion Generation
      ↓
Remotion Composition
      ↓
Preview
      ↓
Human Review
      ↓
Final Render
      ↓
MP4
```

系统需要重点支持：

- 中文视频
- 英文视频
- 两种语言可以分别作为独立项目
- Explainer video
- Whiteboard animation
- Hand-drawn animation
- Diagram animation
- Motion graphics
- 简单角色/图形动画
- Narration
- Captions
- 自动剪辑
- Human-in-the-loop
- 单 Scene 局部修改
- 自动重新渲染
- 项目可恢复
- 后续可扩展到更复杂的 AI video generation

---

# 2. 核心架构决策

## 2.1 Remotion：核心 Video Runtime

Remotion 负责：

- Video composition
- Timeline
- Frame rendering
- Audio
- Captions
- Preview
- Final rendering
- Media composition
- React-based scene implementation

Remotion 是系统的 **deterministic rendering runtime**。

它不是负责“决定视频应该怎么设计”，而是负责把结构化 Scene 和 Animation 可靠地渲染成视频。

---

## 2.2 iart：Video / Motion Intelligence Layer

iart 不作为系统底层 renderer。

iart 的职责是：

- Motion design principles
- Storyboard / explainer workflow
- Whiteboard animation
- Diagram animation
- Artistic Canvas animation
- Timing
- Easing
- Composition
- Visual direction
- Motion art direction
- Beat synchronization

可以把它理解为：

```text
iart = Design / Motion Intelligence
Remotion = Rendering Runtime
```

---

# 3. 第一阶段 Skill Stack

第一阶段只安装 4 个主要 Skill Pack。

## 3.1 Remotion Skills

```bash
npx skills add remotion-dev/skills
```

重点使用：

```text
remotion-best-practices
remotion-create
remotion-studio
remotion-render
remotion-captions
remotion-multimedia
remotion-interactivity
```

---

## 3.2 iart Motion Design

```bash
npx skills add iart-ai/motion-design-skills
```

重点使用：

```text
animation-principles
motion-art-direction
shot-composition
color-motion
beat-sync-editing
remotion-video
```

职责：

```text
Scene
  ↓
Motion Design
  ↓
timing
easing
composition
camera
transition
pacing
```

---

## 3.3 iart Explainer Video

```bash
npx skills add iart-ai/explainer-video-skills
```

重点使用：

```text
explainer-video
whiteboard-animation
diagram-animation
wrapped-video
```

负责：

```text
Script
  ↓
Storyboard
  ↓
Scene
  ↓
Narration
  ↓
Captions
  ↓
Editing
```

---

## 3.4 iart JavaScript / Canvas Animation

```bash
npx skills add iart-ai/javascript-animation-skills
```

用于真正的 frame-by-frame artistic animation：

```text
JavaScript
   ↓
Canvas
   ↓
Frame-by-frame drawing
   ↓
Animation
```

适合：

- Hand-drawn ink
- Doodle
- Picture-book
- Marker drawing
- Engraving
- Artistic transitions
- Procedural illustrations

---

# 4. 第二阶段可选 Skills

这些不要在 MVP 中全部安装。

## 4.1 ToBeWin HandDraw

用途：

```text
Structured whiteboard
SVG drawing
Draw/write/move/rotate/scale/fade/highlight
```

它作为 specialized renderer，而不是平台基础设施。

---

## 4.2 muthuishere hand-drawn-diagrams

用途：

```text
Natural language
      ↓
Excalidraw
      ↓
.excalidraw
      ↓
animated SVG
```

适合：

- Architecture diagram
- DevOps workflow
- MCP architecture
- Sequence diagram
- Flowchart
- Mind map

它应该被定位为：

```text
Diagram Asset Generator
```

而不是 Video Runtime。

---

## 4.3 Excalimate

暂不作为核心依赖。

原因：

- 能力范围很大
- 已经是完整 Excalidraw animation application
- AI integration 与 MCP 有较强关系
- 容易把自己的 Video Agent 与第三方完整产品耦合

后续可以作为：

```text
Optional Excalidraw Renderer
```

进行评估。

---

# 5. 总体系统架构

```text
                         USER
                           │
                           ▼
                  ┌────────────────┐
                  │   Video Agent  │
                  └───────┬────────┘
                          │
                          ▼
                  ┌────────────────┐
                  │    Planner     │
                  │                │
                  │ Script         │
                  │ Storyboard     │
                  │ Scene Plan     │
                  └───────┬────────┘
                          │
                          ▼
                ┌────────────────────┐
                │  HUMAN REVIEW #1   │
                │      Storyboard    │
                └─────────┬──────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │   iart Motion Skills    │
              │                         │
              │ Timing                  │
              │ Composition             │
              │ Art Direction           │
              │ Motion Principles       │
              └────────────┬────────────┘
                           │
                           ▼
                    Scene Builder
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
          SVG/React     Canvas JS     Excalidraw
           Scene         Scene          Asset
             │             │             │
             └─────────────┼─────────────┘
                           │
                           ▼
                    ┌────────────┐
                    │  Remotion  │
                    │            │
                    │ Composition│
                    │ Timeline   │
                    │ Audio      │
                    │ Captions   │
                    └─────┬──────┘
                          │
                          ▼
                ┌────────────────────┐
                │  HUMAN REVIEW #2   │
                │ Scene / Preview    │
                └─────────┬──────────┘
                          │
                          ▼
                    Final Render
                          │
                          ▼
                         MP4
                          │
                          ▼
                ┌────────────────────┐
                │  HUMAN REVIEW #3   │
                │      Final         │
                └────────────────────┘
```

---

# 6. 最重要设计：自己的中间表示

不要让 Video Agent 直接依赖 iart Skill 的内部格式。

应该建立自己的稳定 schema。

建议核心对象：

```text
Project
 ├── Script
 ├── Storyboard
 ├── Scenes
 ├── Assets
 ├── Animations
 ├── Audio
 ├── Captions
 ├── Timeline
 └── RenderConfig
```

---

# 7. Project Schema

示意：

```json
{
  "id": "video-001",
  "title": "How MCP Works",
  "language": "en",
  "resolution": "1920x1080",
  "fps": 30,
  "duration": 120,
  "scenes": [],
  "assets": [],
  "audio": [],
  "captions": [],
  "timeline": []
}
```

---

# 8. Scene Schema

每个 Scene 必须可以独立修改和重新渲染。

```json
{
  "id": "scene-07",
  "start": 42.5,
  "duration": 6.0,
  "purpose": "Explain MCP request flow",
  "narration": "...",
  "visual": {
    "type": "diagram",
    "renderer": "svg"
  },
  "assets": [],
  "animations": [],
  "camera": {},
  "transition": {}
}
```

关键原则：

> **Scene 是最重要的可编辑单元。**

用户说：

> “第 7 个 Scene 的箭头太快。”

系统应该只修改：

```text
scene-07
  └── animation-arrow-02
```

而不是重新生成整个视频。

---

# 9. Visual Renderer Abstraction

不要让 Agent 直接决定调用哪个第三方 Skill。

建立自己的抽象：

```typescript
type VisualRenderer =
  | "remotion"
  | "svg"
  | "canvas"
  | "excalidraw";
```

然后：

```text
visualType = "diagram"
    ↓
SVG / Excalidraw

visualType = "whiteboard"
    ↓
SVG / Remotion

visualType = "handdrawn"
    ↓
Canvas

visualType = "motion-graphics"
    ↓
Remotion
```

这样以后可以替换 Skill，而不会破坏整个系统。

---

# 10. Animation Schema

建议统一使用时间轴模型。

```json
{
  "id": "arrow-01",
  "target": "arrow-01",
  "type": "draw",
  "start": 1.2,
  "duration": 0.8,
  "easing": "easeInOut"
}
```

支持的第一批 animation：

```text
draw
write
fade
move
scale
rotate
highlight
morph
camera
```

后续：

```text
spring
path-follow
particle
mask
blur
glow
parallax
```

---

# 11. Asset Schema

```json
{
  "id": "asset-architecture-01",
  "type": "svg",
  "source": "generated",
  "path": "assets/architecture-01.svg",
  "metadata": {
    "editable": true,
    "handDrawn": true
  }
}
```

Asset 类型：

```text
svg
png
jpg
webp
excalidraw
canvas
audio
video
font
```

---

# 12. Agent 架构

不要让一个 Agent 做全部事情。

建议：

```text
Video Director Agent
        │
        ├── Script Agent
        │
        ├── Storyboard Agent
        │
        ├── Visual Design Agent
        │
        ├── Motion Agent
        │
        ├── Audio Agent
        │
        ├── Caption Agent
        │
        ├── Render Agent
        │
        └── QA Agent
```

---

# 13. Agent Responsibilities

## Video Director Agent

负责：

- 理解用户目标
- 管理整个 workflow
- 调度 subagents
- 保存状态
- 请求 Human Review

不直接生成复杂动画。

---

## Script Agent

负责：

- Topic analysis
- Script
- Narration
- Scene boundaries

输出：

```text
script.md
script.json
```

---

## Storyboard Agent

负责：

- Scene sequence
- Visual intent
- Narration timing
- Camera intent
- Transition intent

输出：

```text
storyboard.json
```

---

## Visual Design Agent

决定：

```text
SVG
Canvas
Excalidraw
Image
Video
```

并产生 Asset Specification。

---

## Motion Agent

使用 iart motion-design principles。

负责：

- Timing
- Easing
- Camera
- Transition
- Visual rhythm
- Motion hierarchy

---

## Render Agent

只负责：

```text
Scene Spec
   ↓
Remotion
   ↓
Preview / MP4
```

---

## QA Agent

必须自动检查：

```text
Audio sync
Caption sync
Missing assets
Out-of-bounds elements
Blank frames
Scene duration
Frame rate
Render errors
Unexpected overlaps
```

---

# 14. Human-in-the-loop

三个关键 checkpoint。

## Checkpoint 1 — Storyboard

用户可以修改：

- Scene 顺序
- Script
- Narration
- Visual style
- Duration
- Scene importance

没有批准：

```text
不要进入完整 rendering。
```

---

## Checkpoint 2 — Scene Preview

用户可以：

```text
Approve
Reject
Edit
Regenerate
```

例如：

```text
“箭头慢一点”
“这个图不要手绘”
“字体大 20%”
“Scene 4 缩短到 5 秒”
“把这个图换成 Excalidraw”
```

Agent 只修改相关 Scene。

---

## Checkpoint 3 — Final Video

用户检查：

- pacing
- narration
- captions
- audio
- transitions
- visual consistency
- scene order

批准后：

```text
final.mp4
```

---

# 15. Project Directory

建议：

```text
video-project/
│
├── project.json
│
├── script/
│   ├── script.md
│   └── narration.json
│
├── storyboard/
│   ├── storyboard.json
│   └── storyboard.md
│
├── scenes/
│   ├── scene-001.json
│   ├── scene-002.json
│   └── scene-003.json
│
├── assets/
│   ├── svg/
│   ├── images/
│   ├── audio/
│   ├── fonts/
│   └── excalidraw/
│
├── animation/
│   └── animation.json
│
├── remotion/
│   ├── src/
│   ├── Root.tsx
│   └── compositions/
│
├── previews/
│   ├── storyboard/
│   ├── scenes/
│   └── contact-sheet/
│
├── renders/
│   ├── draft/
│   └── final/
│
├── qa/
│   ├── render-report.json
│   └── sync-report.json
│
└── README.md
```

---

# 16. MVP Scope

不要第一版就做完整 AI video platform。

## MVP-1

目标：

> 从一个简单 Script 生成 30–60 秒 explainer video。

支持：

- English
- Chinese
- 1920×1080
- 30 FPS
- SVG
- Text
- Simple shapes
- Whiteboard drawing
- Basic motion
- Narration placeholder
- Captions
- Remotion rendering

不做：

- AI video generation
- Character consistency
- Complex 3D
- Multi-camera
- Advanced lip-sync

---

# 17. MVP-1 Example

用户输入：

```text
Explain how an MCP server works in 45 seconds.
```

Agent：

```text
Script
  ↓
5 scenes
  ↓
Storyboard
  ↓
Human Review
  ↓
Scene generation
  ↓
Remotion preview
  ↓
Human Review
  ↓
MP4
```

示例 Scene：

```text
Scene 1
MCP = Model Context Protocol

Scene 2
AI Agent
    ↓
MCP Client

Scene 3
MCP Client
    ↓
MCP Server

Scene 4
MCP Server
 ├── GitHub
 ├── Jenkins
 └── Database

Scene 5
Agent receives structured result
```

---

# 18. MVP-2

加入：

- iart motion-design
- Better transitions
- Hand-drawn whiteboard
- Diagram animation
- Canvas hand-drawn animation
- Automatic narration timing
- Audio ducking
- Caption synchronization
- Contact sheet preview

---

# 19. MVP-3

加入：

- Excalidraw assets
- Character assets
- Reusable visual components
- Brand templates
- Multiple aspect ratios

支持：

```text
16:9
9:16
1:1
```

---

# 20. MVP-4

加入：

- AI image generation
- AI video clips
- Character consistency
- Background generation
- Automatic B-roll
- Advanced sound design

此阶段才考虑引入外部 AI media APIs。

---

# 21. Cost Strategy

第一阶段尽量：

```text
LLM
  ↓
MiniMax / GLM Coding Plan
```

用于：

- Planning
- Coding
- Storyboard
- Agent reasoning

视频渲染：

```text
Remotion
+
Chromium
+
FFmpeg
```

本地执行。

这样：

```text
LLM cost ≈ existing subscription
Rendering cost ≈ local compute
```

不需要一开始购买视频生成 API。

---

# 22. 为什么暂时不使用 Ollama

本项目不依赖本地 Ollama。

原因：

- 用户已经有 MiniMax Coding Plan
- 用户已经有 GLM Coding Plan
- 本地模型不是当前项目的瓶颈
- Video rendering 本身应该保持 deterministic
- LLM orchestration 与 rendering 应该解耦

以后可以增加：

```text
Local LLM Provider
```

但不是 MVP requirement。

---

# 23. Pi / OpenClaw 集成策略

第一阶段不要把系统设计成 MCP-first。

优先：

```text
Agent
Subagent
Skill
Filesystem
CLI
```

例如：

```text
pi
 │
 ├── video-director agent
 │
 ├── storyboard skill
 │
 ├── motion skill
 │
 ├── remotion skill
 │
 └── render skill
```

Skill 通过：

```text
SKILL.md
scripts/
references/
templates/
```

提供能力。

以后如果需要跨应用调用，再考虑 MCP。

---

# 24. CLI 设计

建议最终提供：

```bash
video-agent init my-video
video-agent script
video-agent storyboard
video-agent review storyboard
video-agent build scene
video-agent preview
video-agent review scene
video-agent render
video-agent qa
video-agent export
```

完整流程：

```bash
video-agent init
video-agent script
video-agent storyboard
video-agent review storyboard
video-agent build
video-agent preview
video-agent review scene
video-agent render
video-agent qa
video-agent export
```

---

# 25. Recovery / Resume

这是必须设计的功能。

每一个阶段写入：

```json
{
  "status": "approved",
  "version": 3,
  "updatedAt": "...",
  "approvedBy": "human"
}
```

如果 Agent 中途失败：

```text
resume
```

而不是：

```text
restart everything
```

---

# 26. Versioning

Scene 必须支持版本：

```text
scene-007
 ├── v1
 ├── v2
 ├── v3
 └── approved
```

用户可以：

```text
restore scene-007 v2
```

这样非常适合 Human-in-the-loop。

---

# 27. Render Strategy

开发阶段：

```text
low resolution
preview render
```

例如：

```text
960×540
15 FPS
```

用户批准之后：

```text
1920×1080
30 FPS
```

这样可以显著减少迭代时间。

---

# 28. QA Strategy

每次 render 后自动生成：

```text
render-report.json
```

检查：

```text
✓ duration
✓ FPS
✓ resolution
✓ audio track
✓ caption timing
✓ blank frames
✓ scene boundaries
✓ asset availability
✓ render errors
```

还应该生成：

```text
contact-sheet.png
```

供 Agent 和 Human 快速检查整个视频。

---

# 29. 关键架构原则

## Principle 1

**Scene 是最小可编辑单元。**

---

## Principle 2

**第三方 Skill 不能成为核心数据模型。**

---

## Principle 3

**Remotion 是 renderer，不是 planner。**

---

## Principle 4

**iart 是 motion/video expertise，不是系统数据库。**

---

## Principle 5

**Agent 产生 structured specification，而不是直接产生最终 MP4。**

---

## Principle 6

**任何长流程都必须可以 resume。**

---

## Principle 7

**Human Review 必须是 workflow state，而不是聊天中的一句“请确认”。**

---

# 30. 建议的状态机

```text
DRAFT
  ↓
SCRIPT_READY
  ↓
STORYBOARD_READY
  ↓
WAITING_FOR_STORYBOARD_REVIEW
  ↓
STORYBOARD_APPROVED
  ↓
SCENES_GENERATED
  ↓
PREVIEW_READY
  ↓
WAITING_FOR_SCENE_REVIEW
  ↓
SCENES_APPROVED
  ↓
FINAL_RENDERING
  ↓
QA
  ↓
WAITING_FOR_FINAL_REVIEW
  ↓
APPROVED
  ↓
EXPORTED
```

如果用户 Reject：

```text
REJECTED
   ↓
EDITING
   ↓
PREVIEW_READY
```

---

# 31. 开发 Roadmap

## Phase 0 — Spike

时间：1–2 天

目标：

```text
Remotion
+
一个 Scene
+
SVG
+
简单 animation
+
MP4
```

成功标准：

```text
Agent 可以创建一个可运行的 Remotion project，
并成功生成 MP4。
```

---

## Phase 1 — Scene Engine

时间：3–5 天

实现：

- project.json
- scene.json
- asset.json
- animation.json
- Remotion composition
- scene renderer
- preview

成功标准：

```text
修改 scene-003
不会影响 scene-001/002/004。
```

---

## Phase 2 — Agent Workflow

时间：3–5 天

实现：

- Director Agent
- Script Agent
- Storyboard Agent
- Motion Agent
- Render Agent
- QA Agent

---

## Phase 3 — Human Review

时间：2–4 天

实现：

```text
Storyboard review
Scene review
Final review
```

必须保存：

```text
approval state
version
comments
timestamp
```

---

## Phase 4 — iart Integration

时间：3–5 天

加入：

```text
motion-design
explainer-video
whiteboard
diagram
javascript-animation
```

建立自己的 adapter：

```text
IartSkillAdapter
```

不要直接把 iart API/文件结构暴露给核心 Agent。

---

## Phase 5 — Audio

时间：3–5 天

加入：

```text
Narration
BGM
SFX
ducking
audio timing
```

---

## Phase 6 — Captions

时间：2–3 天

支持：

```text
SRT
VTT
burn-in captions
styled captions
```

---

## Phase 7 — Specialized Assets

时间：3–5 天

加入：

```text
Excalidraw
HandDraw DSL
```

作为 optional renderers。

---

# 32. 第一版 Repository

建议：

```text
video-agent/
│
├── apps/
│   ├── cli/
│   └── studio/
│
├── packages/
│   ├── schema/
│   ├── agent/
│   ├── storyboard/
│   ├── motion/
│   ├── renderer/
│   ├── remotion/
│   ├── assets/
│   ├── audio/
│   ├── captions/
│   └── qa/
│
├── skills/
│   ├── video-director/
│   ├── storyboard/
│   ├── motion-design/
│   ├── scene-builder/
│   ├── remotion/
│   └── qa/
│
├── examples/
│   ├── mcp-explainer/
│   └── devops-explainer/
│
└── docs/
    ├── architecture.md
    ├── schema.md
    ├── skills.md
    └── workflow.md
```

---

# 33. 技术栈建议

## Core

```text
TypeScript
Node.js
pnpm
```

## Agent

优先兼容：

```text
Pi
OpenClaw
Codex
Claude Code
GitHub Copilot
```

Agent 层不要绑定某一个 LLM。

---

## Video

```text
Remotion
React
TypeScript
Chromium
FFmpeg
```

---

## Visual

```text
SVG
Canvas 2D
Excalidraw
```

---

## Storage

MVP：

```text
Filesystem + Git
```

后续：

```text
PostgreSQL / Supabase
```

---

# 34. Git Strategy

每一个视频项目都应该是 Git-friendly。

例如：

```text
git init
git add .
git commit -m "storyboard approved"
```

用户修改 Scene：

```text
git commit -m "adjust scene 7 arrow timing"
```

这样天然拥有：

- version history
- rollback
- branch
- experiment
- review

---

# 35. 第一批 Demo

不要一开始做长视频。

建议做 3 个 Demo。

## Demo 1 — MCP Explainer

```text
45 sec
5 scenes
diagram + whiteboard
```

验证：

```text
Storyboard
Diagram
Motion
Remotion
Captions
```

---

## Demo 2 — AI Concept

```text
60 sec
hand-drawn
Canvas
```

验证：

```text
iart JavaScript Animation
```

---

## Demo 3 — DevOps Architecture

```text
90 sec
Excalidraw
SVG
Motion graphics
```

验证：

```text
Diagram
Camera
Transitions
Timeline
```

---

# 36. Definition of Done — MVP

MVP 不应该以“能生成 MP4”为完成标准。

必须同时满足：

```text
[ ] Agent 可以从 script 创建 storyboard
[ ] Storyboard 可以人工修改
[ ] Scene 可以独立生成
[ ] Scene 可以独立 preview
[ ] Scene 可以独立修改
[ ] 不需要重新生成整个视频
[ ] Remotion 可以 render
[ ] iart motion skills 可以参与设计
[ ] Whiteboard animation 可用
[ ] Canvas hand-drawn animation 可用
[ ] Captions 可用
[ ] Audio 可用
[ ] QA 自动检查
[ ] Render 失败可以 resume
[ ] Git 可以记录版本
[ ] Human approval 是持久化状态
```

---

# 37. 最终目标架构

最终系统不是：

```text
AI → Video
```

而应该是：

```text
                    ┌─────────────────┐
                    │    User Idea    │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │  Video Director │
                    └────────┬────────┘
                             ↓
                    ┌─────────────────┐
                    │    Storyboard   │
                    └────────┬────────┘
                             ↓
                       HUMAN REVIEW
                             ↓
                    ┌─────────────────┐
                    │  Scene Planner  │
                    └────────┬────────┘
                             ↓
                  ┌──────────┼──────────┐
                  ↓          ↓          ↓
                SVG       Canvas    Excalidraw
                  │          │          │
                  └──────────┼──────────┘
                             ↓
                    ┌─────────────────┐
                    │    Remotion     │
                    │     Runtime     │
                    └────────┬────────┘
                             ↓
                       Scene Preview
                             ↓
                       HUMAN REVIEW
                             ↓
                       Final Render
                             ↓
                            QA
                             ↓
                       HUMAN REVIEW
                             ↓
                           MP4
```

---

# 38. 最终技术决策

### Core

```text
TypeScript
Node.js
pnpm
Remotion
React
FFmpeg
Git
```

### Agent

```text
Director
Script
Storyboard
Visual
Motion
Render
QA
```

### Skills

```text
Remotion Skills
iart Motion Design
iart Explainer Video
iart JavaScript Animation
```

### Optional

```text
ToBeWin HandDraw
muthu hand-drawn-diagrams
Excalimate
```

### 不作为 MVP requirement

```text
Ollama
MCP
AI video generation API
3D
Lip-sync
Character consistency
```

---

# 39. 最重要的产品设计原则

最终要达到的用户体验是：

```text
User:
“做一个 60 秒的视频，解释 MCP。”

Agent:
“我生成了 7 个 scenes，请审核 storyboard。”

User:
“Scene 4 太复杂，拆成两个。”

Agent:
“已拆分为 Scene 4 和 Scene 5。”

User:
“批准。”

Agent:
“Preview 已生成。”

User:
“Scene 5 的箭头慢一点，文字大一点。”

Agent:
“只修改 Scene 5，正在重新 preview。”

User:
“批准。”

Agent:
“正在生成最终 1080p 视频。”

Agent:
“QA 完成，视频已生成。”
```

而不是：

```text
User:
做一个 MCP 视频。

Agent:
生成 MP4。

User:
不喜欢。

Agent:
重新生成整个 MP4。
```

**前者才是这个项目真正应该解决的问题。**

---

# 40. 下一步执行顺序

实际开发建议严格按以下顺序：

```text
1. Install Remotion Skills
2. Install iart motion-design
3. Install iart explainer-video
4. Install iart javascript-animation
5. Create video-agent repository
6. Define project.json
7. Define scene.json
8. Define asset.json
9. Define animation.json
10. Create first Remotion composition
11. Build Scene Renderer
12. Build Storyboard Agent
13. Add Human Review #1
14. Add Motion Agent
15. Add Scene Preview
16. Add Human Review #2
17. Add Final Render
18. Add QA Agent
19. Add Audio
20. Add Captions
21. Add Canvas hand-drawn
22. Add optional Excalidraw
23. Add Git/versioning
24. Build MCP Explainer demo
25. Build DevOps Explainer demo
```

**MVP 的关键不是“生成更多类型的视频”，而是先证明一个 Scene 可以被 Agent 结构化生成、被人修改、被单独重新渲染，并最终可靠地组合成 MP4。**
