# AI Video Factory：FLUX.2 Klein 视觉资产与自动化视频生产设计及开发计划

> **⚠️ SUPERSEDED (2026-10-16).** This is a pre-implementation greenfield
> design that no longer matches the repo: it plans as unbuilt the system
> that shipped through v0.7.1, its "不使用 LoRA" constraint contradicts the
> shipped LoRA support (`packages/media-generators/src/lora-config.ts`), and
> its PostgreSQL/Next.js architecture was never adopted. The living design
> lineage is `docs/AI_Video_Factory_Design_and_Plan_v1.1.md` (canonical) →
> `docs/v0.5-local-image-generation-plan.md` (flux) → … →
> `docs/v0.8-visual-guardrails-plan.md` (which also adopted this doc's four
> good unimplemented ideas: keyframe review, Visual Bible, cost gates
> [later removed], stale propagation). Kept for historical context only —
> do NOT treat its constraints as binding.

-   **文档状态**：Review Draft v1.1
-   **日期**：2026-10-16
-   **目标**：构建可持续演进、低成本、支持人工审核的 AI 视频生产系统
-   **核心工作流**：Storyboard → Visual Assets → Motion Graphics / Video
    Generation → Automated Editing → Review
-   **内容语言**：中文或英文，每个项目选择一种主要语言
-   **已确认约束**：不使用 Ollama；不使用 ComfyUI；不使用
    LoRA；允许少量按量付费；采用 MiniMax / GLM
    进行规划和文本任务；FLUX.2 Klein 用于静态图像生成；Pillow
    用于图像处理

------------------------------------------------------------------------

## 1. 执行摘要

本项目建设一个模块化的 **AI Video
Factory**，把主题、文章或创意转化为可审核、可追踪、可重复执行的成片。

核心原则是：**LLM 负责规划和文本推理，FLUX.2 Klein
负责静态图像生成，Pillow 负责确定性图像处理，Remotion 负责时间轴与
motion graphics，FFmpeg
负责音视频组装；视频生成服务只用于确实需要连续运动的镜头。**

项目不依赖 ComfyUI，也不使用 LoRA。图像生成通过直接调用 FLUX.2 Klein
所支持的推理运行时、命令行、Python 接口或托管 API 完成。具体运行时必须在
Phase 0 验证后确定，不预先假设某个接口一定兼容目标模型版本。

系统需要保留脚本、分镜、提示词、生成参数、图像、视频、审批记录和渲染结果的版本。关键步骤必须由用户审核；未经批准，不得批量触发昂贵的生成任务。对已批准的产物，系统不得静默覆盖。

## 2. 目标与非目标

### 2.1 目标

1.  从主题、文章或资料生成结构化视频项目。
2.  支持中文和英文视频生产，按项目选择语言。
3.  用 FLUX.2 Klein 生成角色/地点参考图、分镜关键帧、静态镜头和缩略图。
4.  用 Pillow
    处理图片：尺寸标准化、裁切、合成、联系表、缩略图和文件校验。
5.  用 Remotion 生成字幕、标题、图表、标注、转场和时间轴动画。
6.  用 FFmpeg 完成音视频合成、编码、格式转换和技术检查。
7.  通过统一 Provider 接口隔离 LLM、图像生成、视频生成、TTS 和存储实现。
8.  在脚本、分镜、视觉风格、关键帧、预算、预览和最终成片等节点提供人工审核。
9.  支持版本管理、选择性重跑、任务恢复、取消、成本估算和产物归档。
10. 通过镜头分类减少不必要的视频模型调用。

### 2.2 第一阶段不做

-   不使用 ComfyUI。
-   不使用 LoRA。
-   不使用 Ollama 或其他本地 LLM 作为规划模型。
-   不训练或微调基础模型。
-   不要求每个镜头都生成 AI 视频。
-   不在 MVP 阶段构建复杂的多租户 SaaS、计费或团队权限系统。
-   不让 Agent 直接覆盖已批准的脚本、分镜、关键帧或成片。
-   不假设 Coding Plan 自动包含可用于自建生产服务的 API 权限。
-   不在未验证的情况下承诺 FLUX.2 Klein
    在指定硬件或运行时上的速度、显存/内存要求或输出质量。

## 3. 产品工作流

``` text
Create Project
    ↓
Source Material / Research
    ↓ [Human Checkpoint: approve source and angle]
Script Draft
    ↓ [Human Checkpoint: edit / approve]
Storyboard and Shot List
    ↓ [Human Checkpoint: approve shot plan]
Visual Bible (characters, locations, style)
    ↓ [Human Checkpoint: approve visual direction]
Generate Representative Keyframes with FLUX.2 Klein
    ↓
Pillow Processing + Contact Sheet
    ↓ [Human Checkpoint: compare / regenerate / approve]
Classify Shots: Static / Motion Graphics / AI Video / Hybrid
    ↓ [Human Checkpoint: approve cost estimate]
Generate Selected Video Clips + Narration / Audio
    ↓
Compose with Remotion + FFmpeg
    ↓ [Human Checkpoint: review rough cut]
Final Render + QA
    ↓ [Human Checkpoint: final approval]
Export / Publish / Archive
```

每个审核点都必须支持： - **Approve**：批准当前版本并冻结该版本。 -
**Edit**：编辑结构化内容并重新验证。 -
**Reject**：拒绝结果并记录原因。 -
**Regenerate**：只重新生成指定范围。 - **Rollback**：回到先前版本。 -
**Resume**：从最近成功且仍有效的阶段继续。

## 4. 系统架构

### 4.1 逻辑架构

``` text
Web UI / CLI
    │
    ▼
Project API + Workflow Orchestrator
    ├── Project / Version / Approval Manager
    ├── Cost Estimator + Job Queue
    ├── LLM Provider
    │     ├── MiniMax adapter
    │     └── GLM adapter
    ├── Image Provider
    │     └── FLUX.2 Klein Runtime Adapter
    │           ├── Supported direct CLI / Python runtime
    │           └── Optional hosted inference API
    ├── Image Processing Worker
    │     └── Python + Pillow
    ├── Video Provider interface
    │     └── First provider selected after API and cost validation
    ├── TTS / Music / SFX Provider interfaces
    ├── Renderer
    │     ├── Remotion
    │     └── FFmpeg / ffprobe
    └── Artifact Store + Metadata DB + Run Logs
```

### 4.2 设计原则

-   **Provider abstraction**：业务逻辑不直接依赖单个厂商 SDK。
-   **Artifact-first**：每阶段产物保存为文件，记录元数据、哈希、版本和来源。
-   **Deterministic
    rendering**：固定输入、依赖版本和配置，尽量获得可重复的渲染结果。
-   **Approval as state
    transition**：审批是工作流状态和版本冻结操作，不只是 UI 标记。
-   **Idempotent
    jobs**：相同输入和配置不重复支付昂贵的生成成本，除非用户明确要求。
-   **Cost-aware orchestration**：先生成代表性预览，批准后再批量生成。
-   **No silent
    overwrite**：新结果写入新版本，批准内容只能经显式变更流程替换。
-   **Runtime isolation**：FLUX.2 Klein 的具体运行方式封装在 Image
    Provider 内，不能渗透到分镜、项目或渲染业务逻辑。

## 5. 技术选型建议

  -------------------------------------------------------------------------------------------------------
  层                      建议                                   说明
  ----------------------- -------------------------------------- ----------------------------------------
  编排服务                TypeScript / Node.js                   与 Next.js、React 和 Remotion 生态一致

  Web UI                  Next.js + React                        项目、编辑器、资产预览、审批和运行记录

  数据库                  PostgreSQL                             项目、版本、任务、审批、Provider
                                                                 调用和成本记录

  文件存储                本地工作目录起步，抽象为对象存储接口   媒体文件与元数据分离

  LLM                     MiniMax / GLM adapters                 用于脚本、分镜、提示词、QA
                                                                 建议和任务规划

  图像模型                FLUX.2 Klein                           通过已验证的直接推理运行时或托管 API
                                                                 调用

  图像处理                Python + Pillow                        图像规范化、contact sheet、检查和合成

  Motion graphics         Remotion + React + SVG                 字幕、标题、图表、标注、动画和时间轴

  音视频处理              FFmpeg / ffprobe                       编码、合成、格式检测和媒体 QA

  视频生成                可插拔 VideoProvider                   先接入一个服务，验证后再扩展

  测试                    Vitest/Jest、pytest、集成测试          按模块语言选择测试框架

  开发部署                Docker Compose（可选）                 用于 API、UI、worker
                                                                 和数据库隔离；不代表图像推理必须容器化
  -------------------------------------------------------------------------------------------------------

**API 使用注意事项：** MiniMax Coding Plan 和 GLM Coding Plan
是否允许通过 API 在自建服务中使用、对应
endpoint、配额和商业使用条件，必须依据各自当前条款核实。不要把网页登录凭据或
Coding Plan 会话当作稳定的生产 API。

## 6. FLUX.2 Klein 直接推理设计

### 6.1 职责范围

FLUX.2 Klein 负责生成静态视觉资产： - 角色参考图、服装和外观参考。 -
地点、道具、背景和风格参考。 - Storyboard frame / shot keyframe。 -
适合静态图配合平移、缩放或图形叠加的叙事镜头。 -
视频封面、章节卡和宣传图。

FLUX.2 Klein
是图像模型，不负责输出时间连续的视频。需要自然连续运动的镜头交由
VideoProvider；解释性动画、标题、图表和静态图运动由 Remotion 处理。

### 6.2 运行时选择策略

图像生成不绑定某个工作流编排 UI。Phase 0 必须验证并选择以下方案之一：

1.  **直接 CLI / Python runtime**：目标运行时能加载选定 FLUX.2 Klein
    版本，支持所需参数，并可从脚本稳定调用。
2.  **托管推理
    API**：服务明确支持所需模型版本，且成本、数据处理条款、地区可用性和输出下载方式符合项目要求。

选择标准： - 明确支持目标 FLUX.2 Klein 模型变体。 -
能以程序化方式提交提示词、尺寸、seed（如支持）和必要的参考图。 -
可以稳定取得生成状态和输出文件。 -
可保存模型版本、运行时版本、参数和错误信息。 -
许可与使用条款适用于预期的内容用途。 -
运行成本、吞吐量、硬件要求和失败恢复方式可接受。

**不得在运行时未验证前硬编码具体 CLI 命令或假设某个 Python
包与目标模型完全兼容。**
将实际命令、依赖版本、模型文件位置和调用参数记录在
`docs/flux-runtime.md`。

### 6.3 内部 Image Provider 接口

``` ts
interface ImageGenerationRequest {
  projectId: string;
  shotId?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  referenceAssetIds?: string[];
  modelId: string;
  runtimeConfigVersion: string;
}

interface ImageGenerationResult {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  outputAssetIds: string[];
  providerMetadata: Record<string, unknown>;
  error?: { code: string; message: string };
}

interface ImageProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  getJob(jobId: string): Promise<ImageGenerationResult>;
  cancelJob?(jobId: string): Promise<void>;
}
```

接口字段可以按所选运行时调整。内部业务模块只能依赖该接口，不直接依赖具体模型包或服务响应格式。

### 6.4 运行时适配器要求

1.  将内部请求转换为目标运行时所需参数。
2.  对命令行调用使用参数数组或安全的进程调用方式，避免把用户提示词拼接进
    shell 命令。
3.  对长时间生成任务提供超时、状态跟踪、取消和失败恢复。
4.  保存模型标识、运行时/依赖版本、提示词、尺寸、seed（如适用）、输出哈希和耗时。
5.  将模型文件路径与输出目录限制在配置允许的范围。
6.  对可重试错误设置有限次数的退避重试；授权失败和参数错误应快速失败。
7.  限制并发，避免内存、显存或服务配额耗尽。
8.  使用环境变量或秘密管理服务保存凭据，不将密钥写入日志、项目文件或版本库。
9.  通过配置区分 `draft`、`preview` 和 `final`
    质量档位（前提是运行时确实支持对应参数）。
10. 为模型运行时提供 smoke test 和契约测试。

### 6.5 Pillow 图像处理阶段

Pillow 负责确定性处理，不替代图像模型的生成能力。

处理步骤： 1. 验证图像可解码、格式正确、尺寸合理。 2. 按项目画幅执行
`fit`、`contain` 或经批准的裁切策略。 3. 统一到合适的 RGB/RGBA
色彩模式。 4. 生成缩略图、contact sheet 和审核预览。 5. 生成 Remotion
使用的中间尺寸版本。 6. 检测空文件、损坏文件、异常宽高比和重复哈希。 7.
保留原始生成资产与处理后资产的关联。 8.
将裁切参数、目标尺寸、输出格式和脚本版本写入 metadata。

建议项目配置： - `aspect_ratio`：`16:9`、`9:16` 或 `1:1`。 -
`resolution_profile`：`draft` / `preview` / `final`。 -
`image_format`：需要无损或透明通道时优先 PNG；一般预览可采用
JPEG/WebP。 - `safe_area`：为字幕和平台 UI 预留的安全区域。 -
`color_profile`：明确色彩处理策略，避免不同阶段产生不必要的偏差。

## 7. 视觉一致性策略（不依赖 LoRA）

视觉一致性由结构化 Visual
Bible、批准的参考资产、提示词模板和人工审核共同管理。

-   创建 Visual
    Bible，描述角色、地点、道具、配色、构图、光照和艺术风格。
-   每个 shot 引用资产 ID 和 Visual Bible
    版本，不只依赖重复的自然语言描述。
-   如果选定的 FLUX.2 Klein
    运行时支持参考图或图像编辑，则将批准的角色/场景参考作为输入；此能力必须在
    Phase 0 实测。
-   为关键角色和地点保存 canonical reference。
-   对不一致的图像标记为 `review_required`，不得自动进入视频生成。
-   Seed 只用于可追踪性；不能保证仅靠 seed 就能跨镜头保持角色一致。
-   不承诺完全自动解决角色一致性；MVP
    应通过参考资产、提示词规范和人工选图控制风险。

## 8. Storyboard 数据模型

每个镜头建议至少包含：

``` json
{
  "shot_id": "S001",
  "scene_id": "SC01",
  "order": 1,
  "purpose": "说明镜头在叙事中的作用",
  "narration": "该镜头对应的旁白",
  "visual_description": "画面中实际可见的内容",
  "camera": {
    "shot_size": "medium",
    "angle": "eye-level",
    "movement": "slow push-in"
  },
  "duration_seconds": 6,
  "aspect_ratio": "16:9",
  "visual_style_id": "VS01",
  "character_refs": ["CHAR01"],
  "location_ref": "LOC01",
  "keyframe_asset_ids": [],
  "motion_strategy": "remotion",
  "video_provider": null,
  "prompt_version": 1,
  "status": "draft",
  "approval": {
    "state": "pending",
    "approved_version": null,
    "review_notes": []
  }
}
```

字段规则： - `motion_strategy` 取
`static_pan_zoom`、`remotion`、`ai_video` 或 `hybrid`。 - 只有
`ai_video` / `hybrid` 镜头默认进入视频生成费用估算。 -
`duration_seconds` 必须与时间轴总时长一致。 - 所有资产 ID
必须引用已登记的资产记录。 - 使用 schema validation
拒绝无效结构，不依赖自然语言推断缺失字段。

## 9. 镜头分类与成本控制

每个镜头先分类，再估算费用并由用户批准。

  --------------------------------------------------------------------------------------------------
  策略              适用场景                             实现                     成本原则
  ----------------- ------------------------------------ ------------------------ ------------------
  Static / Pan-Zoom 概念解释、地图、历史风格画面         FLUX 静态图 + Remotion   优先
                                                         动态效果                 

  Motion Graphics   数据、流程、标题、图表、解释性动画   Remotion + SVG/React     优先

  AI Video          必须有自然运动或复杂动态的镜头       VideoProvider            选择性使用

  Hybrid            静态图、视频片段和图形叠加组合       FLUX +                   有明确收益时采用
                                                         VideoProvider/Remotion   
  --------------------------------------------------------------------------------------------------

成本估算至少展示： - 计划生成的图像数量和估算费用（若有可核实价格）。 -
视频镜头数量、每个镜头时长、候选 Provider 和估算费用。 -
TTS、音乐和其他服务可能产生的费用。 - 重生成缓冲比例，并明确其为估算。 -
价格来源与最后核实日期。

未知价格必须标记为"待核实"，不得编造精确总价。默认先生成代表性预览，批准后再批量执行。

## 10. Human-in-the-loop 审批

### 10.1 必须的审批点

  ------------------------------------------------------------------------------------
  阶段                    审核内容                             未批准时禁止
  ----------------------- ------------------------------------ -----------------------
  Source / Research       资料、主题、受众和事实边界           大规模脚本生成

  Script                  结构、事实、语气、语言和目标时长     锁定分镜

  Storyboard              场景顺序、镜头目的、旁白和时长       批量生成视觉资产

  Visual Bible            角色、地点、配色和整体风格           批量生成最终关键帧

  Keyframe Review         构图、风格、角色一致性和字幕安全区   对应镜头的视频生成

  Cost Approval           Provider、镜头数量和预计费用         批量付费任务

  Rough Cut               节奏、旁白、字幕和镜头衔接           最终高质量渲染

  Final QA                内容、音频、画面、字幕和技术规格     发布/交付
  ------------------------------------------------------------------------------------

### 10.2 审批状态机

``` text
draft → pending_review → approved
                     ↘ changes_requested → draft
                     ↘ rejected
approved → superseded (新版本获批后)
```

规则： - 每次编辑创建新版本或明确的变更集。 -
审批记录包含对象、版本、审核人、时间、决定和备注。 -
已批准版本保持不可变；新版本批准后，旧版本标记为 `superseded`。 -
仅重新运行受变更影响的下游任务。 -
修改旁白标点不应自动重生成图像；修改角色外观可能使相关参考图和镜头失效。 -
昂贵任务执行前显示估算费用，并要求明确批准。 -
支持取消、失败恢复和人工重试。

## 11. 工作流编排与失效传播

使用显式 DAG，而不是依赖一个长对话 Agent 完成所有步骤。

``` text
source
  └── script
       └── storyboard
            ├── visual_bible
            │    └── keyframes
            │         └── pillow_processing
            ├── shot_classification
            └── cost_estimate
                 └── approved_shot_plan
                      ├── ai_video_clips
                      ├── tts_audio
                      └── remotion_timeline
                            └── ffmpeg_assembly
                                  └── qa_report
                                        └── final_render
```

每个 job 记录： -
`job_id`、`project_id`、`stage`、`input_hash`、`config_hash`。 -
`status`、`attempt`、`started_at`、`finished_at`。 -
`provider`、`model`、`estimated_cost`、`actual_cost`（可获得时）。 -
输入/输出资产 ID。 - 错误代码、可读错误信息和重试建议。 - 使用的
prompt、模板、运行时和工作流版本。

上游内容变化时： 1. 计算变更影响范围。 2. 将受影响产物标记为
`stale`，不直接删除。 3. 保留仍有效的产物。 4. 展示影响清单和预计费用。
5. 用户确认后只重跑受影响的节点。

## 12. 目录与产物布局

``` text
projects/<project-id>/
├── project.yaml
├── README.md
├── sources/
├── scripts/
│   ├── script.v001.md
│   └── script.v001.json
├── storyboard/
│   ├── storyboard.v001.json
│   └── shots/
├── visual-bible/
│   ├── visual-bible.v001.md
│   └── references/
├── assets/
│   ├── generated/
│   ├── processed/
│   ├── thumbnails/
│   └── contact-sheets/
├── video-clips/
├── audio/
├── remotion/
│   ├── src/
│   ├── package.json
│   └── render-config.json
├── renders/
│   ├── previews/
│   └── final/
├── qa/
├── approvals/
├── manifests/
└── logs/
```

-   大媒体文件可以放在对象存储中；数据库保存 metadata 和 URI。
-   Git 适合管理脚本、JSON/YAML、Remotion 代码、prompt 模板和配置。
-   不建议将大体积视频和图片全部提交到 Git。
-   Manifest 记录产物哈希、来源、生成配置和关联版本。

## 13. 建议的数据表

初期采用 PostgreSQL，至少包括：

-   `projects`：项目名称、语言、画幅、状态、目标时长和创建时间。
-   `project_versions`：项目快照、版本号和变更说明。
-   `artifacts`：类型、URI、MIME、尺寸、哈希、来源和 metadata。
-   `workflow_jobs`：阶段、输入/输出、状态、重试、成本和日志引用。
-   `approvals`：对象类型、对象版本、决定、审核人、备注和时间。
-   `providers`：Provider 类型、启用状态和非敏感配置。
-   `provider_runs`：模型、请求摘要、耗时、状态、用量和费用（可获得时）。
-   `shot_plans`：镜头策略、时长、生成服务和批准状态。

API key
等秘密放在环境变量或秘密管理服务中，不存入普通数据库字段、项目文件或日志。

## 14. Remotion、FFmpeg 与媒体流水线

### Remotion

负责： - 标题、字幕、章节卡、数据图表和标注。 -
静态图平移/缩放、简单镜头运动和转场。 - 按镜头 JSON 生成时间轴。 -
统一字体、配色、字幕安全区域和品牌主题。 -
输出低分辨率预览与最终渲染配置。

### FFmpeg / ffprobe

负责： - 拼接或合成镜头、音频、旁白和音乐。 -
统一编码、分辨率、帧率和音频采样率。 -
检测媒体时长、音轨、帧率和编码信息。 - 生成最终 MP4 和技术 QA 报告。 -
对损坏或不兼容媒体提供明确错误信息。

Remotion 的时间轴应由结构化数据生成，不要通过让 LLM
直接编辑任意渲染代码来完成每个视频。复杂渲染模板需经过测试并版本化。

## 15. API / 模块边界

``` ts
interface LLMProvider {
  generateStructured<T>(request: {
    systemPrompt: string;
    input: unknown;
    schema: unknown;
    model?: string;
  }): Promise<T>;
}

interface ImageProvider {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  getJob(jobId: string): Promise<ImageGenerationResult>;
  cancelJob?(jobId: string): Promise<void>;
}

interface VideoProvider {
  generateClip(request: {
    shotId: string;
    prompt: string;
    durationSeconds: number;
    aspectRatio: string;
    referenceAssetIds: string[];
    providerOptions?: Record<string, unknown>;
  }): Promise<{
    jobId: string;
    status: string;
    outputAssetIds: string[];
    providerMetadata: Record<string, unknown>;
  }>;
  getJob(jobId: string): Promise<unknown>;
}

interface ArtifactStore {
  put(input: {
    projectId: string;
    filePath: string;
    metadata: Record<string, unknown>;
  }): Promise<{ assetId: string; uri: string; sha256: string }>;
  getUri(assetId: string): Promise<string>;
}
```

具体类型需要按选定 API、存储方式和队列实现细化。Provider
的原始响应不得直接传播到所有业务模块。

## 16. 质量保证（QA）

### 内容质量

-   旁白与分镜一致。
-   事实性陈述有来源或人工审核。
-   没有明显重复镜头、突兀转场或叙事断层。
-   内容语言符合项目选择。

### 视觉质量

-   画幅、分辨率和格式符合项目配置。
-   角色、地点和风格与 Visual Bible 尽可能一致。
-   检查错误文本、异常裁切、重复图像和明显生成瑕疵。
-   字幕和重要元素位于安全区域。

### 音视频技术质量

-   使用 ffprobe 检查时长、分辨率、帧率、音轨和编码。
-   检查音频缺失、削波和片段间音量差异。
-   检查字幕时间是否超出镜头或视频时长。
-   检查黑帧、静音段、损坏媒体和异常帧率。
-   输出 QA 报告与低分辨率预览，供最终审批。

## 17. 安全、可靠性与运维

-   外部 API 调用使用超时、限流和有上限的重试策略。
-   仅对网络错误、限流等可重试故障进行退避重试。
-   将 Provider 错误映射为统一内部错误代码。
-   日志记录 job/request ID，不记录 API key。
-   校验文件路径、文件大小、上传类型和图像解码结果。
-   将生成任务放入 worker 队列，避免 Web 请求长时间阻塞。
-   支持取消、超时、恢复和人工重试。
-   设置项目预算阈值和硬性停止开关。
-   Provider
    不可用时保留任务状态，不自动切换到会产生额外费用的服务，除非用户事先批准。
-   对本地运行时和托管 API 分别记录安全边界、数据流和成本。

## 18. 分阶段开发计划

估算假设：一名主要开发者、已有开发环境、先做单用户可用版本。实际工期取决于
FLUX.2 Klein 运行时、视频 API、渲染资源和 UI
范围。每阶段必须验收后再进入下一阶段。

### Phase 0 --- 验证与范围冻结（约 2--3 天）

  --------------------------------------------------------------------------------------------------------------------------------
  ID                任务                               交付物                         验收标准
  ----------------- ---------------------------------- ------------------------------ --------------------------------------------
  P0-01             确定首个视频类型、目标时长和画幅   `docs/product-scope.md`        有明确输入、输出和成功标准

  P0-02             验证 FLUX.2 Klein 直接推理方案     `docs/flux-runtime.md`         通过 CLI/Python 或托管 API
                                                                                      生成并保存测试图；记录模型和依赖版本

  P0-03             核实模型许可和运行条件             `docs/model-licensing.md`      明确所选模型变体的许可、商用限制和运行需求

  P0-04             验证 MiniMax / GLM API 权限和条款  `docs/llm-provider-spike.md`   至少一个可支持结构化输出的接口真实调用成功

  P0-05             评估一个视频 Provider 和 TTS 方案  `docs/provider-spike.md`       完成最小调用测试，或记录阻塞与替代方案

  P0-06             定义预算和停止条件                 `docs/cost-policy.md`          明确项目预算、单任务上限和人工确认点
  --------------------------------------------------------------------------------------------------------------------------------

### Phase 1 --- 项目与工作流骨架（约 3--5 天）

  -------------------------------------------------------------------------------------------------------
  ID                任务                               交付物            验收标准
  ----------------- ---------------------------------- ----------------- --------------------------------
  P1-01             初始化仓库、lint、测试和环境配置   基础项目          一条命令启动开发环境

  P1-02             定义 Project / Artifact / Job /    数据模型与迁移    Schema 校验和迁移测试通过
                    Approval schema                                      

  P1-03             实现项目目录与 ArtifactStore       存储模块          文件可保存、检索并计算哈希

  P1-04             实现工作流状态机                   Workflow engine   支持暂停、恢复、取消并记录状态

  P1-05             实现版本与审批服务                 Approval manager  已批准版本不可被静默覆盖

  P1-06             实现基础 UI 或 CLI                 项目管理入口      能创建项目并查看阶段状态
  -------------------------------------------------------------------------------------------------------

### Phase 2 --- Script 与 Storyboard（约 4--6 天）

  -------------------------------------------------------------------------------------------
  ID                任务                   交付物            验收标准
  ----------------- ---------------------- ----------------- --------------------------------
  P2-01             定义脚本 JSON Schema   Schema 与样例     无效输出被拒绝并返回可读错误

  P2-02             实现 LLM Provider      MiniMax / GLM     结构化输出、超时和错误映射可用
                    adapter                适配器            

  P2-03             生成脚本和镜头列表     Script +          时长、顺序和旁白字段通过验证
                                           Storyboard        

  P2-04             实现编辑与版本化       编辑 UI / JSON    修改产生新版本并记录差异
                                           workflow          

  P2-05             加入脚本和分镜审批门   Approval          未批准时不能触发批量视觉生成
                                           checkpoints       
  -------------------------------------------------------------------------------------------

### Phase 3 --- FLUX.2 Klein 直接生成 + Pillow（约 4--7 天）

  ----------------------------------------------------------------------------------------------------------------------
  ID                任务                       交付物                             验收标准
  ----------------- -------------------------- ---------------------------------- --------------------------------------
  P3-01             锁定并记录直接推理运行时   `docs/flux-runtime.md`、运行配置   测试图可通过脚本生成，运行步骤可复现

  P3-02             实现 ImageProvider adapter 图像生成模块                       提交、状态查询、失败和取消路径可测试

  P3-03             实现 Visual Bible          角色/地点/风格资产                 镜头可以引用已批准的参考资产
                    与参考资产管理                                                

  P3-04             实现 Pillow 规范化与校验   Python image worker                画幅、模式、尺寸和损坏检测测试通过

  P3-05             生成 contact sheet         审核产物                           用户可比较候选图并批准指定版本
                    和审核页面                                                    

  P3-06             记录 prompt / seed / 参数  generation manifest                每张图的输入、版本和参数可追踪

  P3-07             实现选择性重生成           资产版本管理                       不覆盖批准图片，不重跑无关镜头
  ----------------------------------------------------------------------------------------------------------------------

### Phase 4 --- 镜头策略与成本控制（约 2--4 天）

  ------------------------------------------------------------------------------------------------
  ID                任务                     交付物            验收标准
  ----------------- ------------------------ ----------------- -----------------------------------
  P4-01             定义镜头分类规则         Shot classifier   每个镜头有策略和分类理由

  P4-02             实现成本估算接口         Cost estimator    价格有来源/日期；未知项标记待核实

  P4-03             实现预算阈值和人工确认   Cost approval UI  未批准预算时不会执行批量付费任务

  P4-04             实现缓存与幂等键         Job cache         相同输入不会意外重复付费生成
  ------------------------------------------------------------------------------------------------

### Phase 5 --- Remotion + FFmpeg（约 5--8 天）

  ------------------------------------------------------------------------------------------------------------------
  ID                任务                             交付物            验收标准
  ----------------- -------------------------------- ----------------- ---------------------------------------------
  P5-01             建立 Remotion composition 模板   Remotion 项目     可从项目 JSON 读取镜头和时间轴

  P5-02             实现标题、字幕、图表和转场组件   Motion graphics   至少提供标题、字幕、图表、图片平移/缩放模板
                                                     library           

  P5-03             将镜头资产映射到时间轴           Timeline compiler 时间轴总时长符合项目目标

  P5-04             集成 TTS / 音轨                  Audio pipeline    音频、字幕和镜头基本同步

  P5-05             实现 FFmpeg 最终封装             Render worker     输出符合配置的 MP4 和技术报告

  P5-06             实现预览渲染与断点恢复           Preview/final     失败可恢复，不重复执行上游昂贵任务
                                                     render            
  ------------------------------------------------------------------------------------------------------------------

### Phase 6 --- 视频生成 Provider（约 3--6 天，取决于 API）

  ---------------------------------------------------------------------------------------------------
  ID                任务                     交付物            验收标准
  ----------------- ------------------------ ----------------- --------------------------------------
  P6-01             定义 VideoProvider       Provider          业务流程不依赖厂商专属字段
                    contract                 interface         

  P6-02             接入首个视频生成服务     Provider adapter  可提交任务、查询状态、下载并登记输出

  P6-03             处理参考图、时长和画幅   Request mapping   参数映射通过真实 API 测试

  P6-04             实现镜头审批与批量限制   Video generation  只有已批准镜头才会生成
                                             gate              

  P6-05             将视频片段接入           Clip integration  视频片段可与静态镜头混合剪辑
                    Remotion/FFmpeg                            
  ---------------------------------------------------------------------------------------------------

### Phase 7 --- QA、稳定性与试点（约 4--6 天）

  --------------------------------------------------------------------------------------------------------------
  ID                任务                         交付物                   验收标准
  ----------------- ---------------------------- ------------------------ --------------------------------------
  P7-01             实现 ffprobe 与音视频 QA     QA report                可检测分辨率、时长、帧率、音轨等问题

  P7-02             加入黑帧/静音/缺失资产检查   QA checks                注入错误时能检测并报告

  P7-03             实现日志、成本和失败面板     Run dashboard            可定位各阶段失败原因

  P7-04             制作端到端试点视频           Example project          从输入到成片完整运行并通过人工审核

  P7-05             记录缺陷和下一迭代           `docs/pilot-review.md`   每个问题有优先级、复现步骤和处理计划
  --------------------------------------------------------------------------------------------------------------

**MVP 初步工期：约 25--45 个开发日。**
这是规划估算，不包含第三方服务审核等待、复杂视觉调优或大规模生产部署。Phase
0 的运行时验证结果可能改变后续工期。

## 19. MVP 范围与验收

### 19.1 MVP 必须具备

-   创建中文或英文视频项目。
-   从主题/文章生成脚本和结构化分镜。
-   在脚本、分镜、Visual Bible、关键帧、预算和成片阶段提供人工审核。
-   通过选定的直接推理运行时或托管 API 调用 FLUX.2
    Klein，生成至少一个镜头的关键帧。
-   用 Pillow 处理并校验图片。
-   至少组合两类画面策略：静态图动画、Remotion motion graphics、AI
    视频片段。
-   通过 Remotion 和 FFmpeg 输出预览与最终 MP4。
-   记录资产来源、版本、参数和哈希。
-   支持失败恢复、选择性重跑和项目归档。
-   展示成本估算，对未知费用明确标记。

### 19.2 MVP 验收场景

1.  用户创建 60--90 秒、16:9 的中文解释视频项目。
2.  系统生成脚本、分镜和视觉风格建议。
3.  用户编辑并批准脚本、分镜和 Visual Bible。
4.  系统调用 FLUX.2 Klein 生成代表性关键帧，Pillow 输出 contact sheet。
5.  用户选择并批准关键帧；系统显示镜头策略和费用估算。
6.  用户批准预算后，系统只生成选定的 AI 视频镜头。
7.  系统用 Remotion 生成字幕、标题和图表，用 FFmpeg 组合音视频。
8.  用户审阅预览并提出修改。
9.  系统只重跑受修改影响的任务。
10. 用户批准成片后，系统输出 MP4、QA 报告和完整 manifest。

## 20. 风险与缓解措施

  ----------------------------------------------------------------------------------------------------------
  风险                               影响                    缓解措施
  ---------------------------------- ----------------------- -----------------------------------------------
  直接推理运行时不支持目标模型变体   无法生成或结果不稳定    Phase 0 先做真实验证；固定依赖与模型版本

  运行时硬件要求超出预算             本地生成不可行          在 Phase 0 测量资源和速度；必要时评估托管 API

  角色跨镜头不一致                   视觉质量下降            Visual
                                                             Bible、参考资产、人工审核；不承诺完全自动一致

  第三方 API 或 Coding Plan 权限不符 计划无法运行            区分 Coding Plan 与生产 API，早期验证

  视频生成费用超预算                 成本不可控              镜头分类、预算阈值和逐批批准

  Provider 响应格式变化              任务失败                适配器隔离、契约测试和版本化

  长任务中断                         资源浪费或状态丢失      持久化 job 状态、幂等键和断点恢复

  覆盖已批准结果                     无法回滚                不可变版本、显式审批和新资产 ID

  AI 输出结构不稳定                  下游失败                JSON Schema、验证和有限修复重试

  渲染资源不足                       队列积压                独立 worker、并发限制和渲染队列

  供应商价格/政策变化                成本或合规风险          执行前重新核实，Provider 配置化
  ----------------------------------------------------------------------------------------------------------

## 21. 后续增强（不纳入 MVP）

-   多项目队列与并发渲染。
-   多种视频 Provider 的质量/成本基准测试和自动选择。
-   自动字幕校对、配音情绪控制和音乐节拍同步。
-   可视化时间轴编辑器和镜头级 A/B 对比。
-   生成资产语义检索与复用。
-   模板库、品牌主题和可复用 motion graphics 套件。
-   多人审批、权限管理、审计和项目共享。
-   根据实际生产数据优化镜头分类与成本估算。

## 22. 开发规范与交付要求

每个开发任务必须包含： - 唯一任务 ID、依赖任务和负责人（如适用）。 -
输入、输出和验收标准。 - 测试要求与失败恢复行为。 -
可能产生的第三方费用。 - 人工审批要求（如适用）。

交付约定： - 每个阶段完成后更新 `docs/implementation-status.md`。 - 每个
Provider 都有 mock 单元测试和真实 API smoke
test；真实测试必须标记是否会产生费用。 - 所有工作流配置、prompt
模板和运行时依赖均版本化。 - 所有结构化模型输出经过 schema
validation。 - 对昂贵任务提供 `dry-run` / `estimate-only` 模式。 -
不将密钥或敏感输入写入 Git。 - 每个阶段验收都保存可复现的测试项目。 -
图像运行时实现必须与业务层解耦，允许以后替换本地 CLI/Python runtime
或托管推理 API，而无需重写工作流。

## 23. 首批实施顺序

1.  完成 Phase 0：验证 FLUX.2 Klein 直接推理、许可、LLM API 权限、视频
    API 和成本。
2.  建立 Project / Artifact / Job / Approval 数据模型。
3.  打通 Script → Storyboard → 人工审批。
4.  打通 FLUX.2 Klein 直接推理 → Pillow → contact sheet → 人工审批。
5.  通过成本审批后实现 Remotion + FFmpeg 的静态图/图形视频 MVP。
6.  接入一个视频生成 Provider，并验证端到端流程。
7.  用真实的 60--90
    秒视频试点，根据成本、等待时间和人工修改次数规划下一迭代。

------------------------------------------------------------------------

## Review Checklist

-   [ ] 首个目标视频类型、时长和画幅已确定。
-   [ ] FLUX.2 Klein 具体模型变体、许可和运行时方案已验证。
-   [ ] 已确认直接 CLI/Python runtime 或托管 API 的调用方式可自动化。
-   [ ] MiniMax / GLM 的 API 权限、配额和条款已核实。
-   [ ] 首个 VideoProvider 和 TTS 方案已确定。
-   [ ] 项目预算上限和单任务费用确认策略已确定。
-   [ ] 审批点与已批准资产不可覆盖的规则已确认。
-   [ ] MVP 是先用 CLI 验证，还是直接开发 Next.js UI，已确定。
-   [ ] 60--90 秒试点视频的验收标准已确认。

**设计原则总结：** 不依赖 ComfyUI 或 LoRA。先验证 FLUX.2 Klein
的直接推理路径，再构建可追踪、可审核、可恢复的生产流程。先用 FLUX.2
Klein + Pillow + Remotion
解决静态视觉和解释性动画；仅对确实需要连续运动的镜头调用视频生成服务。所有关键产物版本化，所有重要费用在执行前明确，人工对关键内容和最终成片保留决定权。
