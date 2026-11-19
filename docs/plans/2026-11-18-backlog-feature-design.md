# Backlog 功能设计（2026-11-18）

把「好点子」沉淀为一条可管理的选题流水线：存进 backlog、从中取材生成新视频。设计经两轮评审确认（数据模型+CLI → 打分/调度/统计/错误/测试），另确认 `content` 长字段作为草稿上下文。

## 目标与约束

- 存储：仓库根 `backlog.yaml`，唯一人工可编辑源；分数与统计均为派生，不落盘。
- CLI：`video backlog` 子命令族，逻辑全部放 `packages/cli/src/backlog-*.ts`（对齐 `draft-command.ts` 模式，不建新包）。
- 取材：`video draft --from-backlog <id>` 全链路集成——草稿成功后回写 `drafted` + 项目 id。
- 来源：手动 `add` + `harvest` 子命令（LLM 抽取 `docs/plans/`、`learnings/` 候选选题，默认 `proposed` 状态待人批准）。
- 深度：全功能——确定性优先级打分 + 可选 LLM 评审排序、launchd 周度自动 harvest、成片命中率统计。
- `content` 可选长字段（YAML block scalar，不限长）：既作人工参考，也随 `--from-backlog` 作为补充上下文进入 drafter prompt。

## 数据模型

```yaml
schema: backlog/1
ideas:
  - id: "2026-11-18-ceasefire-freeze"     # 稳定 slug，不复用
    topic: "为什么停火线能冻结几十年"
    note: "停火≠和平：监督机制、利益冻结…"
    anchors: ["板门店停战协定", "克什米尔 LoC"]   # 可选研究锚点
    content: |                            # 可选，长度不限
      （长笔记/头脑风暴全文…）
    status: proposed   # proposed → idea → drafting → drafted | dropped
    project: null      # 草稿成功后回填 <project-id>
    source: manual     # manual | harvest:<relpath>
    created: "2026-11-18"
    drafting_at: null  # 进入 drafting 的时间 — 卡死检测（>24h 警告）
    drop_reason: null  # `video backlog drop --reason` 的原因
    drafted_at: null
```

## CLI 表面

| 命令 | 行为 |
|---|---|
| `video backlog add "<topic>" [--note --anchor --content-file --lang]` | 生成 id，状态 `idea`；**重叠预检**：关键词（topic+note+anchors+content）扫描 `projects/*/article.md`，命中则警告并列出项目，`--force` 覆盖 |
| `video backlog list [--status] [--json]` | 按分数排序；默认隐藏 `dropped` |
| `video backlog approve <id>` / `drop <id> [--reason]` / `reset <id>` | proposed→idea / →dropped / 卡死 `drafting` 的人工逃生口 |
| `video backlog harvest [--dry-run] [--paths docs/plans,learnings]` | 每个候选文档一次 LLM 抽取调用 → 追加 `proposed` 条目（按 id/topic 去重） |
| `video backlog score [--judge]` | 重算排序（默认确定性分量；`--judge` 一次批量 LLM 排名，缓存于 `runs/backlog-judge-<hash>.yaml`） |
| `video backlog stats [--json]` | 派生 join：idea.project → `projects/<id>/`（article 存在 / final-mixed.mp4 / BV id / youtube），按 source 出命中率 |
| `video backlog schedule --install\|--remove\|--status` | 写/卸 `~/Library/LaunchAgents/com.aivideofactory.backlog-harvest.plist`：周度 headless harvest（`VIDEO_ASK=off`），日志进 `runs/` |
| `video draft --from-backlog <id> [--force]` | 见下 |

## Pick 流程

`video draft --from-backlog <id>`：拒绝 `proposed` 条目（`--force` 越过）→ 置 `drafting` → 常规 draft 走原流程（ask 协议不动），topic 传条目 `topic`，`content` 作为补充上下文注入 drafter prompt → 成功：`drafted` + `project` 回填 + `drafted_at`；失败：状态回退（`runs/` 记录保留）。撞上遗留 `drafting` 条目时警告并提供 `reset`。

## 打分

排序 = 确定性分量加权和：recency、完整度（note/anchors/content）、重叠清洁度（预检命中数）、status。分支规则全部在代码里；LLM 只做「哪个点子最值得做」这一真实判断（`--judge` 批量排名，缓存键 = 开放条目 ids+topics 哈希，条目不变不重判）。

## 错误处理

- `backlog.yaml` 缺失 → 写命令自动初始化 schema 头；读命令报空。
- YAML 损坏 → 带路径+行号快速失败，绝不自动重写。
- harvest LLM 输出不可解析 → 不加条目，原文转储 `runs/`，exit 1（对齐仓库「响亮降级」惯例）。
- 并发：单用户 read-modify-write，last-writer-wins（同 `state.yaml` 惯例）。

## 测试

状态机转换与 slug id；重叠预检 warn/`--force`（fixture projects）；`--from-backlog --fake` 集成（drafted 戳 + 项目回链 + content 进入 prompt 的单测）；harvest mock LLM（含首跑导入军事/AI 五选题验收）；score/stats fixture；plist 生成。
