# Backlog 功能：开发计划

> 基于已确认的 [Backlog 功能设计](./2026-11-18-backlog-feature-design.md)。本文是可执行任务清单；任务 ID 稳定，可直接复制到 issue tracker。此计划不代表任务已经实现。

## 目标

把散落的选题点子沉淀为 `backlog.yaml` 单一人工源，提供 add/pick/harvest 闭环：从 backlog 取选题直接进入 `video draft`，成稿后自动回链项目。

## 完成条件

- `video backlog add/list/approve/drop/reset` 全部可用；`backlog.yaml` 缺失时自动初始化，损坏时快速失败不重写。
- `video draft --from-backlog <id>` 成功后条目带 `drafted` 戳 + `project` 回链；失败回退状态；`content` 作为补充上下文进入 drafter prompt。
- `video backlog harvest` 首跑能从 `docs/plans/2026-11-18-military-ai-topic-backlog-design.md` 导入 5 条军事/AI 选题为 `proposed`，去重不重复追加。
- `video backlog stats` 按 source 输出命中率（draft/rendered/published 三档）。
- `video backlog schedule --install` 生成周度 launchd plist 并可 `--status/--remove`。
- 新增代码路径均有伴随单测；`pnpm build` 全绿。

## 边界与实施原则

- `backlog.yaml` 是唯一存储状态；分数、排序、统计一律运行时派生，不写回该文件。
- 不建新包：逻辑集中在 `packages/cli/src/backlog-*.ts`；LLM 调用复用 `packages/llm` 客户端。
- 确定性逻辑（状态机、打分分量、join）留在代码；LLM 只承担 harvest 抽取与 `--judge` 排名两处真实语言判断。
- draft 的 ask 协议与计费路径不动；`--from-backlog` 只贡献 topic 与 content 上下文。
- 重叠预检是警告不是硬闸（`--force` 可越过）——预检关键词含 content，避免长笔记点子漏检。
- launchd 环境遵循仓库 headless 惯例（`VIDEO_ASK=off`），日志写 `runs/`。

## 任务清单

### A. 存储与命令基础

- [ ] **BL-01｜backlog 存储层** `P0`
  - 依赖：无
  - 涉及：`packages/cli/src/backlog-store.ts`（新文件）。
  - 实施：schema `backlog/1` 的读/校验/初始化/写回；slug id 生成（日期+主题词，稳定不复用）；状态机 `proposed→idea→drafting→drafted|dropped` 的转换守卫；损坏 YAML 报路径+行号。
  - 验收：单测覆盖 init/读/写/非法转换拒绝/slug 稳定性。

- [ ] **BL-02｜backlog 基础命令 + 重叠预检** `P0`
  - 依赖：BL-01
  - 涉及：`packages/cli/src/backlog-command.ts`、`packages/cli/src/index.ts`（命令注册）。
  - 实施：`add/list/approve/drop/reset`；关键词抽取（topic+note+anchors+content，CJK bigram+锚点词）扫描 `projects/*/article.md`；命中警告列项目，`--force` 越过；`list` 默认隐藏 dropped、`--json` 输出。
  - 验收：fixture projects 下预检 warn/force 行为有单测；命令注册后 `video backlog --help` 可见全部子命令。

- [ ] **BL-03｜`video draft --from-backlog` 闭环** `P0`
  - 依赖：BL-02
  - 涉及：`packages/cli/src/draft-command.ts`、drafter prompt 组装处（`packages/draft/`）。
  - 实施：加载条目（拒绝 `proposed`，`--force` 越过）→ 置 `drafting` → 常规 draft（ask 协议不动），`content` 注入 drafter 补充上下文 → 成功回填 `drafted`/`project`/`drafted_at`，失败回退状态；遗留 `drafting` 警告 + `reset` 逃生。
  - 验收：`--fake` 集成测试断言状态戳与回链；prompt 组装单测断言 content 进入上下文。

### B. 来源与派生层

- [ ] **BL-04｜harvest 子命令** `P1`
  - 依赖：BL-02
  - 涉及：`packages/cli/src/backlog-harvest.ts`（新文件）、`packages/llm`。
  - 实施：默认扫描 `docs/plans/`+`learnings/`（`--paths` 可改，跳过 index/README），每候选文档一次 LLM 抽取；按 id/topic 去重；追加 `proposed` 条目（source 记 `harvest:<relpath>`，理由进 note）；解析失败转储 `runs/` 并 exit 1；`--dry-run` 只报告。
  - 变更记录（2026-11-19 首次 dry-run 实测）：重叠预检从「命中即跳过」改为「命中写进 proposed 条目的 note，由人工 approve 决定」——旧策略在停用词噪声下丢弃了全部 5 条新选题（77 次误报 skip）。同时抽取端加停用词/虚词过滤，判定改为「同文章 ≥2 词或单一强词」。
  - 验收：mock LLM 单测；首跑真实冒烟——军事/AI 设计文档导入 5 条选题且二次运行零重复。

- [ ] **BL-05｜确定性打分 + 可选 judge 排名** `P1`
  - 依赖：BL-02
  - 涉及：`packages/cli/src/backlog-score.ts`（新文件）。
  - 实施：recency/完整度/重叠清洁度/status 加权和；`list` 默认按分排序；`--judge` 一次批量排名，结果保存在唯一滚动快照 `runs/backlog-judge.yaml`，由覆盖提示输入和路由配置的指纹校验。
  - 验收：分量权重单测（fixture 条目排序稳定）；缓存命中/失效各一测。

- [ ] **BL-06｜stats 派生统计** `P1`
  - 依赖：BL-01
  - 涉及：`packages/cli/src/backlog-stats.ts`（新文件）。
  - 实施：idea.project → `projects/<id>/` 三档 join（`article.md` 存在 / `output/final-mixed.mp4` / bilibili BV id、youtube 元数据）；按 source 出命中率；`--json`。
  - 验收：fixture 项目目录的 join 单测（三档各一例 + 未回链条目）。

- [ ] **BL-07｜schedule launchd 管理** `P1`
  - 依赖：BL-04
  - 涉及：`packages/cli/src/backlog-schedule.ts`（新文件）。
  - 实施：`--install` 解析 `which video` 生成 plist（周度、`VIDEO_ASK=off`、日志进 `runs/backlog-harvest-<date>.yaml`）、`launchctl load`；`--status/--remove` 对称。
  - 验收：plist 内容生成单测（不真 load）；`--status` 在无 plist 时如实报告。

### C. 文档

- [ ] **BL-08｜文档同步** `P1`
  - 依赖：BL-03、BL-04
  - 涉及：`.omp/skills/video/SKILL.md`、`docs/USAGE.md`。
  - 实施：新增 `video backlog` 命令族与 `draft --from-backlog` 的用法段落；版本号随发布流程走（`docs/RELEASES.md`）。
  - 验收：skill 文档含命令表与 pick 流程示例。

### D. 自动生产器（2026-11-19 追加）

- [ ] **BL-09｜`video backlog auto`** `P1`
  - 依赖：BL-04、BL-05、BL-07
  - 涉及：`packages/cli/src/backlog-auto.ts`（新文件）、`backlog-schedule.ts`（`--kind auto`/hourly plist）。
  - 实施：触发条件全满足才开工 — MiniMax 空闲 ≥60 min（minimax provider run record + TTS 音频 + 场景图 mtime，TTS 不写 run record）、Token Plan `general` 桶 5h 与周窗口均 ≥80%（默认，`--min-remaining` 可调）、`runs/backlog-auto.lock` 无活锁（死 pid >3h 接管）、无卡在 `drafting` 的条目。动作：取 judge 榜首 open 条目（无缓存先跑 judge）→ 自动 approve → draft(zh) → make(zh) → translate(en-US) → make(en)。任一阶段失败即停，条目停在 approved-but-unstamped，等人工 resume/reset — 绝不静默烧掉下一个点子。不发布。每次运行写 `runs/backlog-auto-*.yaml`（决定与阶段进 `error` 字段，RunRecord 无自由字段）。`--dry-run` 只评估条件与 would-pick，零写入零花费。
  - 验收：21 个新单测（quota 解析、idle 扫描、锁、逐门槛拒绝、四阶段顺序、sticky-failure、scheduler plist）；真仓 dry-run 冒烟 — 条件满足、would-pick = judge 榜首（玄武门之变）、零写入。
