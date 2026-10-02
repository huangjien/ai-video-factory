# AI Video Agent — Design & Traceable Task Plan (v0.2 review)

> 版本：v0.2-D1（对 `ai-video-agent-development-plan-v0.2.md` 的实施设计与任务分解）
> 日期：2026-10-02
> 状态：**待评审（for review）**
> 基线代码库：本仓库 `ai-video-factory`（18 packages，v0.3 已完成）
>
> 可追溯性标记：
> - **§N** = v0.2 计划文档章节
> - **A/B/C/D-n** = 2026-09-30 代码评审发现编号（A=工作流门禁，B=音视频正确性，C=LLM 层，D=渲染细节）
> - **AD-n** = 本文架构决策编号
> - **T-n.n** = 任务编号（含验收标准 / 依赖 / 工作量）

---

## 0. 结论先行（TL;DR）

1. **v0.2 计划约 70% 的能力在本仓库已存在**：自有中间表示（`@vf/vdsl`）、确定性渲染（Remotion+FFmpeg）、10 态状态机 + 人工审批门禁（本周已修复为真实门禁）、TTS/BGM/SFX/混音、字幕、多 Agent（research/script/storyboard/review/youtube）、run 审计、CLI。
2. **真正的增量只有 5 块**：Scene 级隔离渲染与局部重渲（核心）、Schema v0.2 扩展（animation/asset/camera/renderer 抽象）、QA Agent、Scene 版本化、iart/Skills 集成适配层。
3. **建议"演进本仓库"而不是按 §32 新建 video-agent 仓库**（AD-1）——两套布局几乎一一对应，新建等于重写已验证的渲染/工作流/凭安全链路。
4. 计划文档有 8 处与现实或自身矛盾的地方，见 §3 逐条修正。
5. 总量估算：**23–34 人日**（计划 §31 自估 20–31 人日，量级一致；Phase 1 低估，见 §3.5）。

---

## 1. 现状映射（计划 ↔ 代码库）

| 计划章节 | 计划要求 | 本仓库现状 | 判定 |
|---|---|---|---|
| §6 自有中间表示 | Project/Scene/Assets/Animations/Audio/Timeline schema | `@vf/vdsl`：storyboard.yaml → vdsl.yaml → RenderPlan（zod 严格校验、行号报错、确定性编译器） | **存在，需扩展**（T1.1/T1.2） |
| §2.1 Remotion 运行时 | composition/timeline/audio/final | `@vf/video-renderer`：bundle→render→faststart；webpack 缓存已治理 | **存在** |
| §9 Renderer 抽象 | `svg/canvas/excalidraw/remotion` | 仅 Remotion 组件注册表（10 组件 + 5 动画原语 + REGISTRY） | **缺失**（T1.2/T4.3/T7.1） |
| §10 Animation schema | 时间轴模型 9 类动画 | `animation.entrance` 存在但渲染端未消费；transition 被硬编码 18 帧交叉淡化覆盖（D 类发现） | **部分/失联**（T1.5） |
| §12–13 Agent 编制 | Director/Script/Storyboard/Visual/Motion/Render/QA | 已有 research/script/storyboard/review/youtube/audio-plan/draft；Render=CLI；缺 Director/Motion/Visual/QA | **部分**（T2.4/T4.2/T6.x） |
| §14 三个人工检查点 | storyboard/scene/final | storyboard 门禁 + final 门禁**已真实生效**（A1 修复后）；scene 级 checkpoint 缺 | **部分**（T1.3/T3.1） |
| §25 Resume | 可恢复、不重跑 | `vf resume` 是空操作（评审发现）；make 幂等跳过已存在产物 | **部分**（T2.2） |
| §26 Scene 版本化 | v1/v2/approved、restore | 无 | **缺失**（T3.1） |
| §27 低清草稿渲染 | 960×540@15 | 无（只有全量 1080p30） | **缺失**（T1.6） |
| §28 QA | render-report + contact-sheet + 自动检查 | 无 QA 包 | **缺失**（T6.x） |
| §30 状态机 | 14 态 + reject 循环 | `@vf/workflow` 10 态 + per-stage checkpoint（A1 修复后门禁真实） | **存在，需扩展**（T2.1） |
| §31 Phase 5 音频 | narration/BGM/SFX/ducking/timing | `@vf/tts`+`@vf/audio-assets`+`@vf/audio-mix`（ducking/fade/adelay 均已实现） | **已存在**（仅修 D 类混音缺陷） |
| §31 Phase 6 字幕 | SRT/VTT/burn-in/样式 | SRT 生成存在但**渲染端从未绘制**（B 类发现）；VTT 在 `@vf/youtube` | **部分**（T1.4/T5.2） |
| §16 MVP-1 范围 | 30–60s explainer | 端到端链路已能产出（draft/make 流） | **基本存在** |
| §23 非 MCP-first、CLI/文件系统 | bin/video + slash command | `bin/video` + `.opencode/command/video.md` 已有 | **存在** |
| §34 Git-friendly | 每项目 git | 项目目录天然 git-friendly；integration 测试已 git-init | **存在**（可选自动提交 T3.4） |

---

## 2. 架构决策记录（AD）

### AD-1 — 演进本仓库，不新建 video-agent 仓库（对应 §32）
计划 §32 的 `packages/{schema,agent,storyboard,motion,renderer,remotion,assets,audio,captions,qa}` 与现有 `packages/{vdsl,agent-*,video-renderer,video-components,tts,audio-*,...}` 一一对应。新建仓库需要迁移：已验证的渲染管线、凭据安全测试链、状态机与审批门禁、混音引擎。**决策：在本仓库内以包别名/文档别名对齐 §32 命名**（如 `@vf/vdsl` 即 schema、`@vf/qa` 新建），`skills/` 顶层目录新增。
*否决项：greenfield——重写成本 ≈ 已沉没并验证的 20+ 人日，且引入回归风险。*

### AD-2 — Scene 是渲染与状态的最小单元（§8/Principle 1，本计划最大工程项）
现状：整条 storyboard 编译为一个 RenderPlan → 单 composition 一次渲染。目标：`renderScene(sceneId)` 逐场景渲染 + concat 合成全片；场景文件成为 checkpoint/版本化/局部重渲的载体。
*影响：renderer 入口、make 幂等判定（按 scene 文件脏检）、QA、版本化全部受益。*

### AD-3 — vdsl.yaml 必须先变成真实产物（§6 + 评审 A4）
计划把自有 IR 放在系统核心，但现状 `vdsl/vdsl.yaml` 是永远为空的 stub（编译器 `write()` 无人调用，渲染实际读 storyboard.yaml）。**这是 T1.1，是一切 Scene 级功能的前置**——Scene 隔离、版本化、QA 都需要一个真实落盘的 IR。

### AD-4 — 状态机演进，不重建（§30 + 评审 A1）
保留 `@vf/workflow` 10 态 + per-stage checkpoint 模型；计划 §30 的 14 态中 SCRIPT_READY/STORYBOARD_READY 等用 `current_stage` 表达即可；reject 循环补 GENERATING→WAITING_REVIEW 边（今日已加）。**两级状态**：项目级（现有）+ Scene 级（新增，T3.1），scene reject 不再拖整片。

### AD-5 — iart 是适配层，不是依赖（§2.2/Principle 4）
新建 `packages/motion`（IartSkillAdapter）：核心 schema 不出现任何 iart 概念；skill 缺失时 adapter 降级为内置运动启发式（timing/easing 默认表），Phase 0 验证其可用性（外部存在性仅有弱证据，见 §6 来源）。

### AD-6 — MVP-1 直接用真实 TTS（偏离 §16 的"narration placeholder"）
`@vf/tts`（EdgeTTS+时间戳）与混音已存在且经 B1 修复；placeholder 反而要新代码。**决策：MVP-1 含真实 narration+captions**，计划 §18（MVP-2）中的 "automatic narration timing" 对应 T5.1 的审计项。

### AD-7 — 字幕/转场修复并入 Scene Engine，不单开阶段（§16 + B/D 类发现）
Captions 从未渲染、转场硬编码——这两个缺陷使 §16 MVP-1 的验收（captions 可用）不可能达成，故并入 Phase 1 验收，而非拖到 Phase 6。

### AD-8 — 预览分级渲染（§27）
`vf preview --draft`：960×540@15（同一 composition，参数化 width/fps）；批准后 1080p30 走 `vf final`。不做第二条渲染路径。

---

## 3. 对 v0.2 计划文档的修正（评审意见，逐条可追溯）

1. **§32 仓库布局与现状重复**（→AD-1）：建议改写为"映射表"而不是新建指令。
2. **§24 CLI 命令自相矛盾**：正文同时出现 `video-agent build scene` 与 `video-agent build`；且 10 个动词中 7 个与现有 `vf` 动词语义重复。修正：保留 `vf` 二进制，新增 `scene/qa/export/studio` 四个动词，其余映射（表见 T2.4）。
3. **§30 状态机缺失败/阻塞路径**：14 态没有 FAILED/BLOCKED，长渲染必须可标失败可重试（现有 10 态已有）。修正：两级状态模型（AD-4）。
4. **§16 与 §18 白板动画归属矛盾**：MVP-1 含 "Whiteboard drawing"，MVP-2 又加 "Hand-drawn whiteboard"。修正：MVP-1=SVG 线描（draw 动画），MVP-2=Canvas 手绘笔触（T4.4）。
5. **§31 Phase 1 工作量低估**：3–5 天无法覆盖 Scene 隔离渲染 + concat 音画对齐 + 幂等脏检（历史经验：仅 faststart/缓存治理就消耗过数日）。修正为 **5–8 人日**（T1.3/T1.4/T1.5）。
6. **§25 resume 状态块建议用 JSON**：与现有 `state.yaml`/`runs/*.yaml` 双标准。修正：沿用 YAML（AD-1 同理）。
7. **§3.2–3.4 iart 技能包存在性未证实**：`remotion-dev/skills` 已证实存在；`iart-ai/*` 仅有第三方目录收录的弱证据。修正：P0 设验证门禁 + 内置启发式降级（AD-5）。
8. **§28 QA 依赖尚未存在的 Scene 隔离**：blank-frame/scene-boundary 检查需要逐场景产物。修正：QA 排在 Phase 1 之后（依赖表已体现）。

---

## 4. 目标架构（增量视图）

```text
                        ┌────────────────────────────┐
   计划 §5 总架构  →     │  vf CLI / bin/video /studio │  ← Director 编排 (T2.4)
                        └──────────────┬─────────────┘
                                       │
        ┌──────────────┬───────────────┼────────────────┬─────────────┐
        ▼              ▼               ▼                ▼             ▼
   Script/Story    Motion Agent     Visual Design    Render Agent   QA Agent
   (已有 agents)   (T4.2, iart      (T4.3/T7.1       (T1.3 逐场景   (T6.x, 新包
                    adapter T4.1)    渲染器抽象)       + concat)      @vf/qa)
        │              │               │                │             │
        └──────────────┴───────┬───────┴────────────────┴─────────────┘
                               ▼
                 vdsl.yaml v0.2（真实落盘，T1.1/T1.2）
                               ▼
          scenes/scene-NNN.mp4（隔离产物 + 版本化 T3.1）
                               ▼
                 Remotion composition（captions T1.4 / transitions T1.5）
                               ▼
            三级人工门禁：approve storyboard → approve scene(s) → approve final
                               ▼
                          final.mp4 + QA 报告
```

---

## 5. 任务分解（可追溯）

> 约定：每个任务含 **验收标准（可测试）**、**依赖**、**工作量（人日）**、**追溯（§/发现号/AD）**。
> 汇总：P0: 2–3d · P1: 7–10d · P2: 4–6d · P3: 3–4d · P4: 4–6d · P5: 1–2d · P6: 2–3d · P7: 4–6d → **合计 23–34 人日**。

### Phase 0 — 基线与 Spike（2–3 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T0.1 | 提交现有未提交基线：A1+A5 门禁修复、B1 叙事修复、webpack 缓存修复、pnpm 12.8.1 升级 | A1/A5/B1 | — | `git commit` 完成；`pnpm test` 全绿（当前 377 通过）；CI 通过 | 0.5 |
| T0.2 | 安装并盘点技能包：`npx skills add remotion-dev/skills`；尝试 iart-ai 三个包 | §3, AD-5 | — | `skills/INVENTORY.md` 列出每个 skill 的能力摘要；iart 不可得则记录并启用降级路线 | 0.5 |
| T0.3 | Remotion Studio 接入 | §32 apps/studio | T0.1 | `vf studio` 启动 Remotion Studio 并加载现有 composition；README 记录 | 0.5 |
| T0.4 | Spike：手写一个 scene spec → 渲染 5s 960×540 MP4（走现有 renderer） | §31 Ph0 | T0.1 | examples/spike/ 产出 mp4；ffprobe 验证分辨率/帧率/时长 | 1–1.5 |

### Phase 1 — Schema v0.2 与 Scene 引擎（7–10 天）★核心

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T1.1 | vdsl.yaml 变为真实产物：compile 落盘；preview/final 优先读 vdsl.yaml（storyboard 较新时才重编译）；run 记录不再虚报 input | §6, A4, AD-3 | T0.1 | make 后 `vdsl/vdsl.yaml` 非空；删除 storyboard 也能从 vdsl.yaml 渲染；round-trip 字节级稳定（现有测试扩展） | 1–1.5 |
| T1.2 | VDSL schema v0.2：scene 增加 `visual.renderer`（remotion\|svg\|canvas\|excalidraw）、`animations[]`（§10 时间轴模型，首批 9 类）、`assets[]`（§11）、`camera`、`transition{type,in,out}`；迁移与向后兼容 | §7–11, §9 | T1.1 | zod schema + 行号报错 + fixture 测试；**旧 storyboard 全部原样通过**（back-compat 测试） | 2 |
| T1.3 | Scene 隔离渲染：`renderScene(id)` → `scenes/scene-NNN.mp4`；全片=concat；make 按 scene 脏检增量重渲 | §8, Principle 1, AD-2 | T1.2 | 仅改 scene-007 时 `make --dry-run` 只列 scene-007；单独渲染时长与 scene duration 误差 ≤1 帧 | 3 |
| T1.4 | 字幕真实渲染：composition 内 caption 轨（CJK wrap 保留）；SRT 时间轴改用实测音频时长 | §16, B3, AD-7 | T1.3, B1 | 随机抽帧含字幕像素（still 帧断言）；字幕起止与 ffprobe 实测场景音频对齐（±0.1s） | 1.5 |
| T1.5 | 转场接线：per-scene `transition` 被 Root 消费；`cut` 无淡化；淡入窗口来自 spec；删除 opacity-0 全量渲染浪费 | §10, D-发现, AD-7 | T1.2 | 帧数学单元测试；`transition: cut` 的相邻场景首帧 opacity=1 | 1 |
| T1.6 | 草稿渲染档：`vf preview --draft`（960×540@15） | §27, AD-8 | T1.3 | 基准项目草稿渲染耗时 < 全量 40%；`final` 仍 1080p30 | 0.5 |

### Phase 2 — Agent 工作流扩展（4–6 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T2.1 | LLM 可靠性包：fallback 转发修正（primary 的 model id 不再发给 fallback）、chat 路径按文档实现 3 次退避重试、缺 API key 触发 fallback、prompt_hash 哈希真实消息 | C1/C2/C3, §21 | T0.1 | FakeProvider 单测：quota→fallback 成功；503→重试后成功；缺 key→fallback；hash 随消息变化 | 1.5 |
| T2.2 | 状态机阶段扩展：script/storyboard/audio 全部 checkpoint 化并可与门禁联动 | §30, AD-4 | T0.1 | machine 测试：approve script 前无法 build 场景；stage 列表扩展向后兼容 | 1 |
| T2.3 | 真实 resume：`vf resume` 读取 lastSuccessfulStage + 重跑其后阶段（fix 空操作） | §25, A-发现 | T2.2 | 集成测试：中途 kill 后 resume 完成，approved 阶段不重跑（run 记录数不增） | 1 |
| T2.4 | 真实 rollback：恢复 checkpoint 版本 + 用现有 `stagesInvalidatedBy` 标记下游失效并重跑 | §25/§30, A3 | T3.1 | 集成：改 storyboard → rollback → audio/preview 标 invalidated 并重渲染，storyboard 恢复旧版 | 1–1.5 |
| T2.5 | Director 编排：`vf produce`（或扩展 make）按 §40 顺序驱动全流程，三次门禁停靠；CLI 动词映射表写入 docs/workflow.md | §5/§24/§39 | T1.3, T2.3 | e2e 脚本：init→script→storyboard→**停**→build→preview→**停**→final→**停**→export | 1.5 |

### Phase 3 — 评审持久化与版本化（3–4 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T3.1 | Scene 版本化：`scenes/scene-NNN/v{N}.json` + approved 指针 + `vf scene restore` | §26, Principle 1 | T1.3 | 编辑 scene-007 产生 v2；restore v1 后仅该场景重渲；checkpoint 记录版本号 | 1.5 |
| T3.2 | 审批记录增强：checkpoint 保存 comments/timestamp/approver（Principle 7："评审是 workflow state，不是聊天一句话"） | §14 Ph3 | T2.2 | `vf status` 显示带注释的审批历史；yaml schema 测试 | 0.5 |
| T3.3 | Contact sheet + render report（QA 前置件）：每次渲染产出 `qa/contact-sheet.png`、`qa/render-report.json`（时长/帧率/黑帧/场景边界） | §28 | T1.3 | preview 后两文件存在；注入黑帧的坏项目被报告标红 | 1 |
| T3.4 | （可选）阶段通过后自动 git commit（`--git-auto-commit`） | §34 | T2.2 | 批准 storyboard 后仓库出现规范 commit；可关闭 | 0.5 |

### Phase 4 — iart / Motion 集成（4–6 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T4.1 | `packages/motion` IartSkillAdapter：MotionSpec↔skill 调用映射；skill 缺失时降级内置启发式（timing/easing 默认表） | §2.2/§31 Ph4, Principle 4, AD-5 | T0.2, T1.2 | adapter 契约测试（fixture MotionSpec）；拔掉 skill 目录后仍产出合法 MotionSpec | 1.5 |
| T4.2 | Motion Agent：按场景生成 MotionSpec（timing/easing/camera/transition），写回 scene json；重生成不覆盖人工改动（复用 A5 守卫） | §13, §39 对话示例 | T4.1 | MCP-explainer fixture 生成合理 spec；approved 场景拒绝重生成（--force 例外） | 1–1.5 |
| T4.3 | SVG 白板/图表场景类型：`draw/write/highlight` 动画落到 SVG renderer | §3.3, §4.1, §9 | T4.1 | demo：箭头 draw 动画场景 mp4；easing 单测 | 1.5 |
| T4.4 | Canvas 手绘 renderer spike（frame-by-frame，doodle/笔触） | §3.4, §4 MVP-2 | T4.1 | 5s 手绘风 mp4；与 §18 "hand-drawn" 验收对齐 | 1.5 |

### Phase 5 — 音频/字幕收尾（1–2 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T5.1 | 混音缺陷修复：`amix normalize=0`（旁白 −6dB 跳变）、BGM fade 对齐 BGM 时长、`duckerThresholdDb` 线性/ dB 语义修正 | D-发现(混音) | — | 混音单元测试：旁白电平恒定；短 BGM 时 fade 仍发生 | 1 |
| T5.2 | 字幕导出补全：VTT（复用 `chaptersToVtt`）、burn-in 开关、样式参数 | §31 Ph6 | T1.4 | 同项目可产出 .srt/.vtt；styled captions 渲染截图 | 0.5 |

### Phase 6 — QA Agent（2–3 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T6.1 | 新包 `@vf/qa`：audio/caption 同步、缺 asset、越界元素、黑帧、场景边界、时长/帧率检查 → `qa/*.json` | §13 QA, §28 | T3.3, T1.4 | 注入 5 类缺陷的坏项目全部被检出且报告含修复建议 | 1.5 |
| T6.2 | QA 作为导出前门禁：`vf export` 前强制 QA 通过（可 `--force`） | §24, Principle 7 | T6.1 | QA fail 时 export 退出非零并在报告列因 | 0.5 |

### Phase 7 — 专用渲染器与 Demo（4–6 天）

| ID | 任务 | 追溯 | 依赖 | 验收标准 | 估时 |
|----|------|------|------|----------|------|
| T7.1 | Excalidraw 资产生成器（diagram→.excalidraw→动画 SVG），定位为 asset generator 非 runtime | §4.2 | T1.2 | DevOps 示例图生成 .excalidraw + 动画 svg 场景 | 1.5 |
| T7.2 | Demo 1 — MCP Explainer（45s/5 场景/diagram+whiteboard） | §17/§35 | T1.x, T4.3, T6.1 | §36 DoD 清单逐项打勾；QA 报告全绿 | 1.5 |
| T7.3 | Demo 2 — AI Concept（60s/Canvas 手绘） | §35 | T4.4 | 手绘风格可辨识；beat-sync 生效 | 1 |
| T7.4 | Demo 3 — DevOps Architecture（90s/Excalidraw+motion graphics） | §35 | T7.1 | camera/transition/timeline 生效 | 1 |
| T7.5 | 文档四件套：docs/{architecture,schema,skills,workflow}.md（含本文映射表） | §32 | 全程 | 与代码同步；ARCHITECTURE.md 交叉引用 | 0.5 |

---

## 6. 里程碑与 DoD 映射

| 里程碑 | 任务集 | 对应计划 | 出口标准 |
|---|---|---|---|
| M1（~P0 末，2–3d） | T0.x | §31 Ph0 | spike mp4 + skill 盘点 |
| M2（~P1 末，+7–10d） | T1.x | §16 MVP-1 | **"改 scene-007 只重渲 scene-007"** + captions 真渲染（§36 前 7 项） |
| M3（~P3 末，+7–10d） | T2.x+T3.x | §14/§25/§26 | 三门禁持久化 + resume/rollback 真实 + 版本化 |
| M4（~P6 末，+7–11d） | T4.x+T5.x+T6.x | §18 MVP-2 + QA | iart 参与 + 手绘 + QA 门禁 |
| M5（~P7 末，+4–6d） | T7.x | §35 三个 Demo | DoD 全清单 + docs |

计划 §36 DoD 16 项 → 任务覆盖：`storyboard 可人工修改/Scene 独立生成·预览·修改/T1.3·T3.1`、`captions/audio/T1.4·T5.x`、`QA/T6.1`、`resume/T2.3`、`git 版本/T3.4`、`审批持久化/T3.2`、`whiteboard/T4.3`、`canvas 手绘/T4.4`、`iart 参与/T4.1–4.2`。

---

## 7. 待评审问题（需要你拍板）

1. **AD-1 演进 vs 新仓库**：我强烈建议演进本仓库。若你坚持 §32 新仓库，P1 工作量 ×1.8（迁移渲染/工作流/混音）。
2. **Director 形态**：MVP 用 `vf produce` + 三次终端停靠（非 MCP、非 GUI，符合 §23）。够吗？还是要一个常驻 Director Agent 进程？
3. **iart 缺席的降级**：若 P0 验证 `iart-ai/*` 不可得，Phase 4 用内置运动启发式先落地（T4.1 已含），iart 后补。可接受？
4. **MVP-1 是否含真实 TTS**（AD-6，我建议含）：计划原文是 placeholder，但真实 TTS 已存在。
5. **节奏**：23–34 人日按每周 2–3 天投入 ≈ 2.5–4 个自然月；有无截止日约束需要倒排裁剪（建议保 M2 裁 P7）。
6. **Scene 级状态引入两级模型**（项目 status + scene status）：确认这是你要的心智模型（§39 对话暗示如此）。

---

## 8. 来源

- [Skills CLI（npx skills add）说明](https://gist.github.com) 与 [LobeHub 收录的 remotion-dev/skills](https://lobehub.com) — 证实 `npx skills add remotion-dev/skills` 存在。
- [skillsadd.com 对 iart-ai/motion-design-skills 的收录](https://skillsadd.com) — iart-ai 组织的弱证据（仓库未直接索引到，P0 需验证）。
