# Gemini Decisions API：实施计划

> 依据[已确认的设计](./2026-11-21-gemini-decisions-default-and-multimodal-design.md)。这是可追踪的待办清单，不代表功能已经实现。任务 ID 稳定，可复制到 issue tracker；每项完成后勾选并补充 PR/commit 链接。

## 目标

让 Gemini Decisions API 成为通用 decision layer 的默认主 provider，并通过统一批量协议将共享上下文、多问题和媒体输入能力接入 prompt-eval、QA advisory 与显式 CLI 检查。

## 完成条件

- `auto` 默认顺序为 Google → OpenAI → MiniMax；显式 provider/model override 仍有效，fallback 只跨服务故障且只尝试支持输入类型的 provider。
- 旧 `decide()` 调用及现有单题 provider 行为保持兼容；新 `decideMany()` 可按 ID 稳定映射部分/缺失结果。
- Google 一次请求支持共享文本与图片、音频、视频、PDF 输入，最多 1,000 个问题；OpenAI 原生批量文本，MiniMax 批量文本适配器按题调用。
- prompt-eval 的 rubric axes 和 QA report findings 各使用一个共享上下文批次；QA 的确定性分级和 gate 完全不受建议答案影响。
- `video decision inspect --request <yaml>` 支持多题和本地媒体文件，输出可机器读取；日志不包含媒体内容或 base64。
- 文档、provider 配置和 CLI 帮助一致；相关单测、包级检查及全仓 build 通过；不依赖 live/付费 API 验证。

## 范围与不变量

- 媒体只由用户显式调用 `inspect` 发送；文件路径相对请求 YAML 解析，发给 provider 前读取并附 MIME。第一版支持 PDF，不承诺 Office 文档或任意远程 URI。
- 一个 batch 的所有题共享同一份 input；批次不是多文件独立分类器。question ID 必须唯一。
- Google 输入上限以 API 文档为准：客户端校验 1,000 题；API 对内容/token 的限制以服务端响应为准，不静默截断媒体或上下文。
- 业务调用失败继续原有确定性/人工流程；结果只作评估或 advisory，不触发发布、渲染、拦截等副作用。
- 日志记录请求摘要、输入类型/MIME、文件名和摘要哈希、题目 ID、答案、provider/model、错误及批次级 usage/latency；绝不记录原始媒体字节、base64 或完整合同/音频/视频内容。

## 任务清单

### A. 合约与 provider 路由

- [x] **GD-01｜批量决策合约** `P0`
  - 依赖：无
  - 涉及：`packages/llm/src/decision/contract.ts`、`packages/llm/src/decision/index.ts`、`packages/llm/src/index.ts`、对应 contract tests。
  - 实施：定义 `DecisionInputPart`、`DecisionBatchQuestion`、`DecisionBatchRequest`、按题 `DecisionBatchAnswer` 与批次级 `DecisionBatchResult`；提供唯一 ID 和题数验证。`decide()` 保持原签名；新增 `decideMany()`。
  - 验收：旧类型和调用无需修改；空批次、重复 ID、非法题型被本地拒绝；batch answer 顺序/ID 定义清楚；usage 只出现于批次元数据一次。

- [x] **GD-02｜能力声明与默认路由** `P0`
  - 依赖：GD-01
  - 涉及：`packages/llm/src/decision/runtime.ts`、provider implementations、`runtime.test.ts`。
  - 实施：默认链改为 Google → OpenAI → MiniMax；provider 暴露支持的输入类型和 batch 能力；按请求类型过滤候选。显式选择维持 pinned 行为。fallback 仅在 unavailable/service error 时发生，答案无效/缺题不切 provider。
  - 验收：测试默认顺序、key 缺失跳过、text/media 能力过滤、服务错误 fallback、无效答案停止、显式 provider 不切换、model override 保留。

### B. Provider adapters 与共享调用

- [x] **GD-03｜Google 原生批量及多模态** `P0`
  - 依赖：GD-01、GD-02
  - 涉及：`packages/llm/src/decision/google.ts`、`google.test.ts`。
  - 实施：把内容块转换为 Decisions API 输入；所有问题合并到一次 `/v1beta/decisions` 请求；响应按 question ID 校验并映射为标准值；单题 `decide()` 走 batch wrapper。拒绝超过 1,000 题；错误摘要不含媒体内容。
  - 验收：mock fetch 断言每批一次 HTTP 请求；覆盖 text+image/audio/video/PDF 序列化、所有题型、乱序响应、缺失/无效 ID、部分答案、超限拒绝和服务错误。

- [x] **GD-04｜OpenAI 与 MiniMax batch adapter** `P1`
  - 依赖：GD-01、GD-02
  - 涉及：`packages/llm/src/decision/openai.ts`、`minimax.ts` 及其测试。
  - 实施：OpenAI 将文本问题提交为一批并按 ID 解析；MiniMax 对文本问题逐题调用现有实现，聚合按题结果和批次级总 usage/latency。两者遇到媒体请求时不得将媒体转成文本或伪装为已处理。
  - 验收：OpenAI batch 单次请求且 ID 映射正确；MiniMax 答案可部分成功并逐题保留错误；非文本输入在发请求前明确拒绝。

- [x] **GD-05｜共享批量 consult 与安全日志** `P1`
  - 依赖：GD-03、GD-04
  - 涉及：`packages/llm/src/decision/consult.ts`、decision exports 与测试。
  - 实施：新增 `consultDecisionMany()`，返回每题规范化结果及 batch metadata；日志 helper 按题写答案但仅保留一次 usage/latency 归属，媒体只保留 MIME、文件标识和摘要哈希。旧 `consultDecision()` 保持原行为。
  - 验收：批次抛错/部分缺答/部分成功均不 throw；日志中没有 input 文本、媒体 bytes 或 base64；单题旧日志兼容。

### C. Decision surfaces

- [x] **GD-06｜Prompt-eval rubric 批量评分** `P1`
  - 依赖：GD-05
  - 涉及：`packages/cli/src/eval-decision.ts`、`eval-decision.test.ts`。
  - 实施：将截断至 12,000 字符的 output 作为共享 input，每个 axis 生成独立 `score` question；一次 consult 后按 axis 组装现有返回结构。批次失败仍让 chat judge 基线正常产出。
  - 验收：多 axis 只调用 batch 一次；axis 与答案 ID 一一对应；空 axes 不调用；失败逐轴有 error 且 eval 不失败。

- [x] **GD-07｜QA report findings 批量 advisory** `P1`
  - 依赖：GD-05
  - 涉及：`packages/qa/src/qa-decision.ts`、`qa-decision.test.ts`。
  - 实施：将 report/finding 摘要作为一个共享输入，每个 finding 用稳定、唯一 ID 对应 triage 问题；映射回 finding 并生成现有 advisory rows。保持原始 finding level、deterministic gates 和 report verdict 不变。
  - 验收：多 finding 一次 batch；零 finding 不调用；答案按 finding ID 回填；批次失败不修改 deterministic 输出；日志继续含 state digest，不含完整 report/media。

### D. 显式多模态 CLI 与文档

- [x] **GD-08｜`video decision inspect`** `P1`
  - 依赖：GD-05
  - 涉及：新增 `packages/cli/src/decision-inspect.ts`、`packages/cli/src/decision-bench.ts`（`registerDecision`）或 CLI index、对应 tests。
  - 实施：用仓库现有 YAML parser 读 `--request`；验证 input/questions；相对 YAML 路径解析本地文件；检测/校验 MIME；将 bytes 交给 decision provider；支持 `--json` 稳定输出 answers、错误、confidence 与 batch metadata。默认输出不打印原始 input。
  - 验收：text-only 与 PDF/media fixture、路径相对解析、无文件/未知 MIME/重复 ID/超 1,000 题在网络调用前失败；JSON schema 有测试；帮助文本显示子命令。

- [x] **GD-09｜运行手册与决策策略同步** `P1`
  - 依赖：GD-02、GD-06、GD-07、GD-08
  - 涉及：`docs/v0.11-decision-provider-plan.md` §15、`packages/prompts/decisions/POLICY.md`、`.agents/skills/video/references/cli-and-runtime.md`、CLI usage 文档（如有生成版同步）。
  - 实施：将默认 provider 更新为 Google → OpenAI → MiniMax；记录 capability/fallback 规则、inspect YAML 示例、媒体隐私边界和 advisory-only 语义；删除 OpenAI 为默认链的旧描述。
  - 验收：仓库搜索不再有相互矛盾的 default 描述；命令参数与实现一致；链接到 Gemini API 文档。

### E. 集成验证

- [x] **GD-10｜端到端回归与交付记录** `P0`
  - 依赖：GD-01 至 GD-09
  - 涉及：受影响 packages 的测试与 build；本计划状态/变更记录。
  - 实施：跑 decision provider、CLI eval、QA advisory、inspect 的定向测试，再跑 `pnpm build`；只使用 mock provider/fetch，不发付费请求。修复回归并记录命令和结果。
  - 验收：全部目标测试和 build 通过；CLI inspect 有一份可复用的 text-only 示例请求；GD-01..GD-10 状态更新并链接实现 commit/PR。

## 依赖关系

```text
GD-01 → GD-02 → GD-03 ─┐
                  GD-04 ─┴→ GD-05 → GD-06 ─┐
                                     GD-07 ├→ GD-09 → GD-10
                                     GD-08 ┘
```

GD-03 与 GD-04 可并行；GD-06、GD-07、GD-08 可在 GD-05 完成后并行。GD-09 需等接口与 CLI 字段冻结后更新。

## 状态记录

- **计划状态：** GD-01..GD-10 已完成
- **已完成：** 批量合约与 adapter、Gemini 默认路由、prompt-eval/QA 批量接入、`decision inspect`、策略和 CLI 文档同步。
- **可复用示例：** [`docs/examples/decision-inspect-text.yaml`](../examples/decision-inspect-text.yaml)
- **当前阻塞：** 无
- **最近更新：** 2026-11-21
- **执行记录：** `env -u GEMINI_API_KEY -u OPENAI_API_KEY -u MINIMAX_API_KEY pnpm vitest run --coverage.enabled=false ...`（10 个 decision 相关测试文件，123 项通过）；`env -u GEMINI_API_KEY -u OPENAI_API_KEY -u MINIMAX_API_KEY pnpm build` 通过；CLI `decision inspect --help` smoke 通过；变更文件 Prettier 检查通过。最终验证没有调用外部 API。首次测试时发现旧 QA fallback 测试会读取环境中的 Gemini key；它已改为无 key 测试。第一次测试过程中该测试可能发出过一次真实 Gemini 请求。
