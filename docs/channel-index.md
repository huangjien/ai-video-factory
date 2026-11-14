# 频道索引 · Software Architecture & Management

> 系列定位：**用管理学和军事组织当解剖刀，切开软件设计里的老问题。**
> 每支 5–8 分钟，中英双语同步发布，扁平矢量画面 + 固定片头/片尾音乐动机。

## 片单（7 支 · 14 个版本）

| # | 片子 | 一句话定位 | 中文 | English |
|---|---|---|---|---|
| 1 | 把软件团队也看做系统 | 把团队当分布式系统来建模：Dispatcher/Worker、命令链的代价、七种典型故障 | [BV1G7Wk6NEMc](https://www.bilibili.com/video/BV1G7Wk6NEMc) | [E_SRBP2P-3I](https://youtu.be/E_SRBP2P-3I) · [BV19LWk6vEN7](https://www.bilibili.com/video/BV19LWk6vEN7) |
| 2 | 软件架构和实现 | 架构 = 元素 + 关系 + 一切决策之和：复杂性管理、水平分层、垂直划分、演进路线图 | [BV1esWx6sExK](https://www.bilibili.com/video/BV1esWx6sExK) | [M134dbJOPsg](https://youtu.be/M134dbJOPsg) · [BV1v2WK6BEU5](https://www.bilibili.com/video/BV1v2WK6BEU5) |
| 3 | 领域建模，设计软件的骨相 | 一家餐厅停电教我的 DDD：从朴素模型驱动到领域模型、限界上下文、聚合 | [BV1oMWk6gEah](https://www.bilibili.com/video/BV1oMWk6gEah) | [IvZhb30U6Rk](https://youtu.be/IvZhb30U6Rk) · [BV1oMWk6gEzP](https://www.bilibili.com/video/BV1oMWk6gEzP) |
| 4 | 从伍什到班排的历史演变 | 五人与十人沿用了三千年：编制、指挥跨度，以及"兵种分野"之外的另一半 | [BV1TwWD67ESL](https://www.bilibili.com/video/BV1TwWD67ESL) | [wDro6UEv1lw](https://youtu.be/wDro6UEv1lw) · [BV1A3WD63EAp](https://www.bilibili.com/video/BV1A3WD63EAp) |
| 5 | 扁平化组织与任务式指挥 | 向军队学任务式指挥：减的是决策层级，不是组织层级 | [BV1JKWY6DEwL](https://www.bilibili.com/video/BV1JKWY6DEwL) | [yQ_U4VAX2gs](https://youtu.be/yQ_U4VAX2gs) · [BV1M8WY6NEeo](https://www.bilibili.com/video/BV1M8WY6NEeo) |
| 6 | 任务式指挥与 Agent 设计 | 别微操 Agent：把意图、边界、授权和可验证验收写成任务协议 | [BV11xsG6gEm4](https://www.bilibili.com/video/BV11xsG6gEm4) | [L7_ah0zHruI](https://youtu.be/L7_ah0zHruI) · [BV11xsG6gEw2](https://www.bilibili.com/video/BV11xsG6gEw2) |

> 上表各格的中英文链接：英文版的 YouTube 链接见 `docs/channel-sound-system.md` 之外的各项目 `bilibili/PUBLISHED.md`（每支的完整四平台编号都在那里）。

## 观看顺序建议

```
1 把软件团队也看做系统  ← 分布式系统的直觉
2 软件架构和实现        ← 元素、关系、决策
3 领域建模              ← 模型怎么落地（DDD）
4 从伍什到班排          ← 编制史：为什么是 5 和 10
5 扁平化组织与任务式指挥 ← 指挥关系怎么设计
6 任务式指挥与 Agent 设计 ← 同一套思想落到 AI Agent
```

- **只看架构** → 1 → 2 → 3
- **只看团队/组织** → 1 → 4 → 5 → 6
- **只看 AI 工程** → 5 → 6（4 提供军事原理的来龙去脉）

## 互相导流文案（可直接贴进简介）

| 放在 | 文案 |
|---|---|
| 1（团队当系统） | 顺着"命令链为什么会拖慢团队"往下问：架构层面元素和关系怎么定？→ [软件架构和实现]；模型怎么落地？→ [领域建模] |
| 2（架构） | 这一支讲的是"决策之和"。管理侧的另一半（编制与指挥跨度）在 [从伍什到班排]，把组织当分布式系统的版本在 [把软件团队也看做系统] |
| 3（领域建模） | 模型要落在体系里才有意义 → 体系怎么分 → [软件架构和实现]；谁来指挥模型 → [扁平化组织与任务式指挥] |
| 4（伍什到班排） | 编制讲完了，指挥关系还没讲 → [扁平化组织与任务式指挥]；换成 AI 执行单元 → [任务式指挥与 Agent 设计] |
| 5（扁平化） | 军事原理的来龙去脉 → [从伍什到班排]；同一套思想落到 AI Agent → [任务式指挥与 Agent 设计] |
| 6（Agent 设计） | 这一支的军事原理 → [扁平化组织与任务式指挥]；Agent 的"系统"视角 → [把软件团队也看做系统] |

## 制作规范（本系列共用的硬约束）

| 项 | 约定 |
|---|---|
| 画面 | flat-vector，深蓝 #16213E / 石板蓝 #4A6FA5 / 暖琥珀 #E8A33D / 米白 #F4F1EA 四色锁板；**画面里绝不出现可读文字**（图像模型渲染汉字与拉丁字母只会产出乱码），所有可读信息交给 Pillow 横幅、字幕或 YouTube 章节 |
| 数量 | 数字只由旁白承担；画面不声明"几个"（图像模型数不准） |
| 组件 | 除首场景 Title、收尾金句卡 BigIdea、个别 QuoteBlock 外，所有场景走 `AnimatedIllustration`——`visual:` 里出现触发词会让场景被劫持成几何组件、丢掉画面 |
| 字幕 | 中文烧旁白、英文烧短标签（`captions_source: caption`）；故事板级上限是 4 行 × 24 单位 |
| 声音 | 片头 12s + 正文（按题材族选曲）+ 片尾 12s 的同一动机，见 `docs/channel-sound-system.md` |
| 评分 | 草稿评分（8 维 24 指标）≥ 90 为 A；A 档稿不跑 `video revise`（它会往 `visual:` 注入排版规格，导致全片重出图），改为手工采纳评审的实质意见 |
| 独立可看 | 每支片子独立成立，三定律：①开场是具体场景/事实，不是抽象二分；②借用的概念在首次使用的那一场用一句白话定义，出处排在定义之后；③片名承诺的概念在前两场内被兑现。跨集引用（"上一集"）视为缺陷。新片用 `video draft … --channel-profile software-architecture-series` 自动带上这些规则 |
