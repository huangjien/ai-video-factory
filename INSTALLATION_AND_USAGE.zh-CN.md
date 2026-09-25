# AI Video Factory 安装与使用手册

本文档说明当前仓库的实际安装方式、CLI 命令和完整使用流程。

## 概览

v0.4 起，AI Video Factory 的对外接口**只保留 3 个命令** ——
两个 LLM 写入辅助文件，1 个命令完成剩下的所有事情：

```text
主题  ──►  vf draft  ──►  article.md  ────►
                                       │  人工编辑
                              ◄── vf audio-plan
                                       │
                                       ▼
                                     vf make  ──►  preview.mp4
                                                ►  final-mixed.mp4
```

两个人工编辑文件就是 **`article.md`**（叙事 + Scenes YAML 块）和
**`audio-config.yaml`**（voice / bgm / sfx / fades）。其它一切都是派生
产物，编辑后 `vf make` 一键重跑。

旧版的多阶段命令（`vf research` / `vf script` / `vf storyboard` /
`vf audio` / `vf approve` / `vf reject` / `vf rollback` 等）仍可用，但
**新项目不建议使用**；详见 §8 与 §12.8。

## 1. 环境要求

必须安装：

- Node.js 22 或更高版本
- npm
- FFmpeg，且包含 `ffprobe`
- macOS、Linux，或可运行 POSIX shell 的 Windows 环境

检查版本：

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

macOS：

```bash
brew install node ffmpeg
```

Debian / Ubuntu：

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

Windows 请安装 Node.js 和 FFmpeg，并确保 `node`、`ffmpeg`、`ffprobe` 已加入 `PATH`。

## 2. 安装项目

在仓库根目录执行：

```bash
pnpm install
ppnpm run build
```

CLI 编译后位于：

```bash
node packages/cli/dist/index.js --help
```

可在当前 shell 中设置简写：

```bash
alias vf='node packages/cli/dist/index.js'
```

也可以使用仓库提供的 wrapper：

```bash
bin/video --help
```

### 全局安装

发布 `@vf/*` packages 后，用户可以全局安装 CLI：

```bash
npm install --global @vf/cli
vf --help
```

全局安装只安装 CLI 和运行时依赖，不会把项目文件写入 npm 的全局安装目录。项目会创建在当前工作目录，或 `--cwd` 指定的目录下：

```bash
mkdir my-video-projects
cd my-video-projects
vf new demo
```

本地开发时可以链接 workspace CLI：

```bash
npm run build
npm link --workspace @vf/cli
vf --help
```

维护者发布全部 workspace packages：

```bash
npm run publish:packages:dry-run
npm run publish:packages
```

修改源码后需要重新构建：

```bash
npm run build
```

## 3. 验证安装

```bash
npm run build
pnpm test
pnpm run lint
ppnpm run format:check
```

完整验收和 benchmark：

```bash
npm run benchmark:verify
pnpm run acceptance
```

这两个命令会实际渲染视频，因此需要 FFmpeg、ffprobe 和可用的本地 Remotion 渲染环境。

## 4. 创建项目

创建 `projects/demo`：

```bash
node packages/cli/dist/index.js new demo
```

生成的目录包括：

```text
projects/demo/
├── project.yaml
├── storyboard/storyboard.yaml
├── vdsl/vdsl.yaml
├── assets/audio/
├── assets/images/
├── assets/fonts/
├── captions/
├── checkpoints/
├── runs/
├── output/
└── state.yaml
```

主要输入文件是：

```text
projects/demo/storyboard/storyboard.yaml
```

项目初始状态为 `DRAFT`。当前工作流状态保存在 `state.yaml`，每次执行记录保存在 `runs/`。

## 5. Storyboard / VDSL 格式

当前 schema 版本为 `0.1`。时长单位是秒，渲染器会根据 FPS 转换为帧。

```yaml
schema_version: "0.1"

project:
  id: demo
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
    transition:
      in: fade
      out: cut
```

重要规则：

- `schema_version` 必须是 `"0.1"`。
- Scene ID 必须唯一。
- 每个 Scene 必须有正数 `duration` 和已注册的视觉组件。
- 未知字段会被拒绝。
- 引用的素材必须存在于项目目录中。
- 支持 `zh-CN` 和 `en-US`。

当前组件包括 `Title`、`Paragraph`、`Image`、`CodeBlock`、`Terminal`、`Callout`、`FlowChart`、`Timeline`、`Comparison` 和 `EndCard`。

## 6. 本地核心流程（v0.4 推荐）

新版把核心流程压缩成单个 `vf make`：

### 6.1 一次性准备：`article.md` + `audio-config.yaml`

```bash
vf new my-topic
vf draft "my-topic"           # → projects/<slug>/article.md
                            #   同时刷新 storyboard.yaml（VDSL，由 article.md 派生）
vf audio-plan my-topic       # → projects/<slug>/audio-config.yaml
# 人工编辑：
$EDITOR projects/<slug>/article.md
$EDITOR projects/<slug>/audio-config.yaml
```

### 6.2 一键渲染：`vf make`

```bash
vf make my-topic             # TTS → 音频素材 → 渲染 → 混音
vf make my-topic --fake       # 离线（写静音 WAV 占位，不调用 Edge TTS）
vf make my-topic --dry-run    # 看会跑哪些步骤
```

输出：

```text
projects/<slug>/output/preview.mp4           # 视频预览
projects/<slug>/output/preview-faststart.mp4 # 同上，faststart 元数据
projects/<slug>/output/final-mixed.mp4       # 解说 + BGM + 音效 — 发布件
projects/<slug>/assets/audio/scene_*.wav
projects/<slug>/assets/audio-assets/{bgm,sfx}/*.wav
projects/<slug>/captions/<lang>.srt
```

### 6.3 修改后重跑

`vf make` 是**幂等**的：比源文件新的产物会被跳过。所以修改
`article.md` 或 `audio-config.yaml` 后重跑会只跑受影响的部分。

```bash
# 只改了 audio-config 里的 BGM
vf make my-topic
# → 跳过已经新鲜的 TTS 与 preview；重新跑 audio-assets 与 mix
```

### 6.4 校验文件格式

```bash
node packages/cli/dist/index.js validate \
  projects/<slug>/storyboard/storyboard.yaml \
  --root projects/<slug>
```

错误信息包含文件、行号、字段和具体原因。

### 6.5 旧版核心流程（保留作为遗留路径）

详细说明见 §12.8。简略形式：

```bash
vf preview --cwd projects/<slug>     # 渲染 preview.mp4
vf final   --cwd projects/<slug>     # 渲染 final.mp4（要求 review APPROVED）
```

## 7. 编辑、迭代与恢复

新版不再依赖 `approve` / `reject` / `rollback` 流水线 — **改完文件重跑
`vf make` 即可**：

```bash
# 改了 article.md 的某段叙事
$EDITOR projects/<slug>/article.md
vf make <slug>          # 只重跑 TTS + render + mix（其余跳过）

# 改了 audio-config.yaml
$EDITOR projects/<slug>/audio-config.yaml
vf make <slug>          # 只重跑 audio-assets + mix

# 想给某一场换组件（比如用 Image 替代 Paragraph）
$EDITOR projects/<slug>/storyboard.yaml
vf make <slug>          # 只重跑 render + mix
```

`vf make` 不会产生 review checkpoint；它产出的 `final-mixed.mp4` 就是
发布件。

### 关于手改 `storyboard.yaml`

`storyboard.yaml` 是 `article.md` 的派生文件，每次 `vf draft` 跑都会
重新生成。另外，`vf make` 在 TTS 后会按实测音频长度校正每场
`duration:` —— 没有这一步，渲染器会用文章里估算的时长，音频放完时画面
还卡在最后帧。

如果你手工编辑了 `storyboard.yaml`（例如换 `Image` 组件或调 `props`）：

- 每场 `duration:` 和其他 `vf draft` 派生的字段，下次 `vf draft` 时
  会被覆盖。
- 每场 `duration:` 在下次 `vf make` 时也会被覆盖（实测后重写）。
- 其它字段（组件、props、subtext 等）因为 `syncStoryboardDurations`
  只动 `duration:` 行，所以会被保留。

常见流程：

- 想让 `vf draft` 出来的内容去噪 → 直接编辑 `article.md`
- 想做像素级的视觉控制 → 手工编辑 `storyboard.yaml` 后跑 `vf make`
  （**不要**再跑 `vf draft`，否则会覆盖）

### 7.1 旧版 workflow 命令（仍可用，仅供旧项目回退）

```bash
vf status --cwd projects/<slug>            # 各阶段清单 + checkpoint
vf reject wrong-pacing --cwd projects/<slug>
vf rollback storyboard-v2 --cwd projects/<slug>   # 需交互确认
vf resume --cwd projects/<slug>            # 查看阶段 + git commit
```

`vf rollback` 不会删除 Git 历史或已有输出文件；回滚后应再跑一次
`vf validate` + `vf preview`（或 `vf make`）。

## 8. 可选 AI 工作流

AI 命令调用 MiniMax 或 GLM API；纯本地渲染不依赖它们。
密钥**只放在环境变量**，不要写到 Git：

```bash
export MINIMAX_API_KEY="..."
export GLM_API_KEY="..."        # vf draft / vf audio-plan 默认使用 GLM
```

自定义 provider 路由：

```bash
export LL_CONFIG="$PWD/llm.config.yaml"
```

### v0.4 推荐：`vf draft` + `vf audio-plan`

新版 AI 工作流只有这两步 — 全部内聚到两个人类可编辑的产物：

```bash
# 1. 写 article.md（一篇可编辑的长 markdown + 一个 Scenes YAML 块）
vf draft "AI Agent Memory"
vf draft "AI Agent Memory" --no-web
vf draft "AI Agent Memory" --model glm --lang zh-CN --duration 60 --audience developers
vf draft "AI Agent Memory" --from draft-outline.md   # 基于已有大纲改写

# 2. 读 article.md，写 audio-config.yaml（一个音频相关的旋钮全在这里）
vf audio-plan ai-agent-memory
```

输出：

```text
projects/<slug>/article.md            # 人类编辑：叙事、结构、Scenes YAML
projects/<slug>/audio-config.yaml     # 人类编辑：voice / bgm / sfx / fades
```

人类编辑完两个文件后，跑 `vf make <slug>` 即出一份发布 mp4。

### 旧版 AI Agents（仍可用，仅供旧项目迁移 / 调参）

如果你已经在用旧的多阶段格式，下面的命令仍可工作。但**新项目建议
改用 `vf draft` + `vf audio-plan`**，它们更短、文件更少、人工工作更少。

| 旧命令                          | 产物                                                  | 新版替代               |
| ------------------------------- | ----------------------------------------------------- | ---------------------- |
| `vf research`                   | `research/{research.md,sources.yaml,claims.yaml}`     | `vf draft`             |
| `vf script`                     | `script/script.<lang>.md`                             | `vf draft`             |
| `vf storyboard`                 | `storyboard/storyboard.yaml`                          | `vf draft`（包含在内） |
| `vf review`                     | `review/{content,visual,technical}-review.yaml`       | 删除 — 人类即审稿人   |

各旧命令的常用 flag：

```bash
# Research — 联网搜索可选；模型可选；时长达 60s
vf research "AI Agent Memory" --model glm --duration 60 --lang zh-CN --audience developers

# Script — 默认结构 Hook → Problem → Explanation → Example → Comparison → Implication → Conclusion
vf script "AI Agent Memory" \
  --from-research projects/<slug>/research \
  --duration 60 --lang zh-CN

# Storyboard — 必须人工审核后再渲染
vf storyboard "AI Agent Memory" \
  --from-research projects/<slug>/research \
  --from-script    projects/<slug>/script/script.zh-CN.md \
  --duration 60 --style dark-tech

# Review — 只读，不修改项目
vf review <slug>
```

### YouTube 元数据

不是 `vf make` 的一部分，需要时单独调：

```bash
vf youtube <slug>
```

生成标题、简介、WebVTT chapters、结构化 YAML、缩略图提示词与 Shorts hook。
它**不会**上传 YouTube，也**不会**生成缩略图或 Shorts MP4（那两个由 §12.5
中的 `vf thumbnail` 和 `vf shorts` 产出）。

## 9. 语音、字幕和音频（v0.4）

### 9.1 推荐路径：整合在 `vf make` 中

v0.4 起，TTS、BGM/SFX 素材、混音、字幕 SRT 都由 `vf make` 一次性产出 ——
不再需要单独跑 `vf audio` / `vf audio-asset` / `vf mix`：

```bash
vf make <slug>            # 真 Edge TTS（需要网络）
vf make <slug> --fake     # 静音 WAV 占位（无需网络，离线 / CI 友好）
```

默认使用 Edge TTS（免费、无需 API key），但依赖在线 Microsoft 服务，
可能受限流或网络故障影响。

输出：

```text
projects/<slug>/assets/audio/scene_*.wav
projects/<slug>/assets/audio-assets/bgm/<tag>.wav
projects/<slug>/assets/audio-assets/sfx/<tag>.wav
projects/<slug>/captions/<lang>.srt
```

字幕格式是标准 WebVTT-兼容 SRT（实际后缀是 .srt 但内容是 SRT）。

### 9.2 句间停顿（`pause_between_sentences_sec`）

TTS 输出句与句之间可以插入静默停顿，写在 `audio-config.yaml` 中：

```yaml
voice: zh-CN-XiaoxiaoNeural
bgm: "calm"
bgm_fade_in_sec: 1.5
bgm_fade_out_sec: 2
pause_between_sentences_sec: 1     # 在每个句号 / 问号 / 感叹号之后停 1 秒
sfx: {}
```

- 范围 `0–5`（秒）；`0` 禁用。
- 实现方式：`vf make` 在调 TTS 时把文本包成 SSML
  `<speak>第一句。<break time="1000ms"/>第二句。</speak>`，
  Edge TTS 在那个 `break` 处插入静音。
- 典型取值 `0.5–1.0`（明显但不拖沓）。`vf audio-plan` 默认填 0；
  人类编辑时如果场景里有 2+ 句，可以提升到 1.0 左右。

只改 `pause_between_sentences_sec` 后再跑 `vf make`，只重跑 TTS
那一步，其它产物按 mtime 跳过。

### 9.3 音色选择

默认音色取决于 article 的 `language` 字段。想按项目自定义，改
`audio-config.yaml` 里的 `voice:`；想改全局默认，改
`packages/make/src/index.ts` 的 `ZH_VOICE` / `EN_VOICE` 常量并重新构建。

| 语言 | 默认（男声） | 女声备选 | 其它男声备选 |
| --- | --- | --- | --- |
| `zh-CN` | `zh-CN-YunjianNeural`（纪录片风格） | `zh-CN-XiaoxiaoNeural` | `zh-CN-YunxiNeural`（温暖）、`zh-CN-YunyangNeural`（新闻） |
| `en-US` | `en-US-ChristopherNeural`（平静旁白） | `en-US-AriaNeural` | `en-US-GuyNeural`、`en-US-EricNeural` |

任何 Edge TTS 支持的 voice ID 都可以用 — 直接写到 `audio-config.yaml`
的 `voice:` 字段即可。除非显式覆盖，文章一直使用默认男声。

### 9.4 Edge TTS 注意事项

Edge TTS 不收取直接 API 费，但商业再分发和长期生产使用应先确认服务
条款。需要正式授权的生产服务时，可通过 `@vf/tts` 的 `TTSProvider`
接口替换（例如 MiniMax TTS / ElevenLabs）。

### 9.5 旧版 `vf audio` 命令（仍可用）

旧项目若要单独跑 TTS，可继续用 `vf audio <slug>`，它读
`storyboard/storyboard.yaml` 的 `narration.text` 字段。`vf make` 内部
就是这套逻辑，只是源从 storyboard.yaml 换成了 article.md。

## 10. 项目文件和可追溯性

### v0.4 推荐结构

```text
projects/<slug>/
├── project.yaml                     项目元数据
├── article.md                       ⭐ 可人工编辑：叙事 + Scenes YAML（vf draft 写）
├── audio-config.yaml                ⭐ 可人工编辑：voice / bgm / sfx / fades（vf audio-plan 写）
├── storyboard/storyboard.yaml       vf draft 从 article.md 派生；vf make 在 TTS 后按实测时长校正每场 duration（手改其他字段保留；duration 会被下次 make 覆盖）
├── vdsl/vdsl.yaml                   编译后的标准 VDSL
├── state.yaml                       状态（旧 workflow；新版可以忽略）
├── checkpoints/                     旧 workflow 留下的审计
├── runs/<run-id>.yaml               每次 LLM / tool 调用的 run 记录
├── assets/
│   ├── audio/scene_*.wav           逐场景 TTS（vf make 写）
│   └── audio-assets/{bgm,sfx}/     BGM/SFX 素材（vf make 写）
├── captions/<lang>.srt              字幕（vf make 写）
└── output/
    ├── preview.mp4                  vf make 写
    ├── preview-faststart.mp4        vf make 写
    └── final-mixed.mp4              ⭐ 发布件（vf make 写）
```

`⭐` 标记的是两个人类编辑点；其余都是派生产物。

`storyboard.yaml` 是 **article.md 的派生**（由 `vf draft` 在每次
draft 运行时从 `article.md` 同步生成）。第一场映射到 `Title` 组件，
其余场映射到 `Paragraph` 组件，`caption` 作为屏显文字。如果想要像素
级别的视觉控制（例如换 `Image` 组件或调整 `props`），可以手工编辑
`storyboard.yaml` 后跑 `vf make` —— 但下一次 `vf draft` 会把它
**覆盖**回去。如果手改很重要，跑 `vf make` 之前不要重新跑 `vf draft`。

### AI 调用记录字段

`runs/<run-id>.yaml` 每条记录包含 `provider`、`model`、
`tokens` (`{input, output}`)、`prompt_hash`、`estimated_cost_usd`、
`input_files` 与 `output_files` 引用、ISO 时间戳。

**绝不要**把 API key、`.env`、私有资料、Token、Cookie 等凭据提交到仓库。

## 11. 常见问题

### 找不到 FFmpeg 或 ffprobe

安装 FFmpeg，并确认命令在 `PATH` 中：

```bash
which ffmpeg
which ffprobe
```

### 找不到 `packages/cli/dist/index.js`

重新构建：

```bash
npm run build
```

### 缺少 MiniMax 或 GLM key

在运行命令的同一个 shell 中导出对应环境变量。

### Validation 报告素材不存在

`assets/audio/scene_01.wav` 这类路径相对于项目根目录，而不是 YAML
文件所在目录。使用 `--root` 指定项目根目录。

### `vf make` 一上来就报错

`vf make` 需要 `article.md` 和 `audio-config.yaml` 两个文件都在
`projects/<slug>/`。两个文件都不在时报：

```bash
article.md not found at .../article.md
# hint: run `vf draft <topic>` first

audio-config.yaml not found at .../audio-config.yaml
# hint: run `vf draft <topic>` first
```

### Edge TTS 失败

检查网络并重试；离线 / CI 用：

```bash
vf make <project> --fake
```

### 旧版 `final` 提示 review 未批准

如果还在用旧版的 `vf final` 路径：

```bash
vf status --cwd projects/demo
vf approve review --cwd projects/demo
vf final --cwd projects/demo
```

新版本已不需要 — 直接改 `article.md` 后再跑一次 `vf make <slug>`。

### Remotion 无法找到端口

可能是其他渲染进程占用端口，或当前执行环境禁止本地 loopback。停止
残留进程后重试，并确认本地端口绑定权限。

### 磁盘占用增长很快（`node_modules` / `/tmp`）

两个临时目录会在高频使用下持续累积：

- **`node_modules/.cache/webpack`** — Remotion 的持久化 webpack 缓存。
  每次渲染配置变化都会增量增长。直接删除即可，下次渲染会重建。

  ```bash
  rm -rf node_modules/.cache/webpack
  ```

- **系统 `$TMPDIR`**（macOS 默认 `$TMPDIR`、Linux 默认 `/tmp`）—
  每次 Remotion 渲染会留下 `remotion-webpack-bundle-*` 与
  `remotion-v*-assets-*` 目录。每个渲染 ~26MB；几百次测试/make
  跑下来可以积到几十 GB。`vf make` 每次渲染会自动清理 1 小时前
  的条目，但本地直接跑 `vf preview` 时不一定走这条路径。立即清理：

  ```bash
  # macOS 默认：
  rm -rf "$TMPDIR"/remotion-webpack-bundle-* "$TMPDIR"/remotion-v*-assets*
  # Linux：
  rm -rf /tmp/remotion-webpack-bundle-* /tmp/remotion-v*-assets*
  ```

## 12. 一步步：从一个主题开始创建视频

### 12.0 推荐：3 命令最小 API（v0.4+）

整个流水线被压缩到 **3 个命令 + 2 个人工编辑点 + 1 个渲染输出**：

1. `vf draft <topic>` → 写出 `article.md`（LLM 综合 research + script + storyboard 三件事）
2. `vf audio-plan <project>` → 写出 `audio-config.yaml`（LLM 基于 article.md 给出 BGM/SFX/voice 建议）
3. `vf make <project>` → 一切自动：TTS → 音频素材 → 渲染 → 混音 → 输出 mp4

```
┌────────────────────────────────────────────────────────────────┐
│  主题  ──►  vf draft  ──►  article.md  ──┐                      │
│                                         │  人工编辑           │
│                                         ▼                      │
│                                  audio-config.yaml  ◄── vf audio-plan
│                                         │                      │
│                                         ▼                      │
│                                       vf make  ──►  preview.mp4
│                                                  ►  final-mixed.mp4
└────────────────────────────────────────────────────────────────┘
```

`vf make` 是**幂等**的：已产出的 WAV / mp4 比源文件新就跳过；只用
`--dry-run` 看会跑哪些步骤。

### 12.1 一次性安装

```bash
# ffmpeg（所有流程的必需依赖）+ Node 22+
brew install ffmpeg                 # macOS；Debian/Ubuntu: sudo apt install ffmpeg

git clone https://github.com/huangjien/ai-video-factory.git
cd ai-video-factory
npm install
npm run build
```

### 12.2 创建一个项目

```bash
TOPIC="ai-thinking"
vf new "$TOPIC"
# 会创建 projects/<slug>/ 目录：
#   project.yaml
#   storyboard/storyboard.yaml    (模板 — 2 个场景，供 vf make 渲染用)
#   state.yaml
#   runs/, checkpoints/, output/, assets/, 等
```

### 12.3 两个 LLM 命令（推荐路径）

需要环境中的 `GLM_API_KEY`（默认值；`MINIMAX_API_KEY` 作为可选 fallback）。

```bash
# 1. Draft — 写 article.md（同时承担 research + script + storyboard 三件事）
#    输出 projects/<slug>/article.md：
#      - YAML frontmatter（project / language / duration_target_sec / voice）
#      - # <title> + > **Hook**
#      - ## <n>. <Section> + <body> 段落（人类可改）
#      - ## Scenes  围栏 YAML 块（驱动器下游工具）
#    同时派生 storyboard.yaml（VDSL），第一场映射到 Title，其余到 Paragraph，
#    caption 作为屏显文字。vf make 渲染的就是这个文件，所以视频长度
#    与音频自动对齐。
vf draft "$TOPIC"                  # 默认开启 MiniMax 联网搜索
vf draft "$TOPIC" --no-web          # 关闭联网，纯模型知识
vf draft "$TOPIC" --model glm --duration 40 --lang zh-CN --audience developers
vf draft "$TOPIC" --from outline.md  # 把已有大纲当起点改写
```

```bash
# 2. Audio-plan — 读 article.md 的 scenes，写 audio-config.yaml
#    一次性把所有音频旋钮（voice / bgm tag / sfx cues / fades）写到一个文件
vf audio-plan "$TOPIC"
```

然后人工编辑这两个文件：

```bash
$EDITOR "projects/$TOPIC/article.md"          # 改叙事、删场景、调时长
$EDITOR "projects/$TOPIC/audio-config.yaml"   # 换 BGM、加音效、调 fade
```

### 12.4 渲染（一个命令搞定）

```bash
vf make "$TOPIC"                     # TTS → 音频资产 → 渲染 → 混音（真 Edge TTS）
vf make "$TOPIC" --fake              # 用 FakeTTSProvider（无需网络，写静音 WAV 占位）
vf make "$TOPIC" --dry-run           # 只打印会跑哪些步骤，不真正执行
```

输出：

```text
projects/$TOPIC/output/preview.mp4           # 视频预览（仅画面）
projects/$TOPIC/output/preview-faststart.mp4 # 同上，faststart 元数据
projects/$TOPIC/output/final-mixed.mp4       # 解说 + BGM + 音效的发布件
projects/$TOPIC/assets/audio/scene_*.wav     # 每场景 TTS（可重新编辑 article.md 后再跑覆盖）
projects/$TOPIC/assets/audio-assets/bgm/*.wav
projects/$TOPIC/assets/audio-assets/sfx/*.wav
projects/$TOPIC/captions/<lang>.srt
```

不满意？改 `article.md` 或 `audio-config.yaml` 任意一处，再跑一次
`vf make` — 没改的部分会跳过，改了的部分从那一步重跑。

### 12.5 可选：YouTube 发布包 + 缩略图 + Shorts

发布到 YouTube 的元数据，单独调用（不是 `vf make` 的一部分）：

```bash
# YouTube 文本包 — 标题、描述、chapters.vtt、缩略图提示、Shorts hook
vf youtube "$TOPIC"
# 优先读 article.md（如果存在）；否则回退到旧的 research.md + script.md + storyboard.yaml 三件套
# → projects/$TOPIC/youtube/{title.txt,description.md,chapters.vtt,thumbnail-prompt.txt,shorts-hook.txt}

# 缩略图 — 默认 mock；加 --provider minimax 走真实 AI
vf thumbnail "$TOPIC"
# → projects/$TOPIC/youtube/thumbnail.png（1280×720）

# Shorts 切片 — 从 final-mixed.mp4 抽一段竖屏 9:16
vf shorts "$TOPIC"
# → projects/$TOPIC/youtube/shorts.mp4
```

`vf youtube` 在新版下不再要求旧的 `research/`、`script/`、
`storyboard/storyboard.yaml` 三件套都存在 —— 只要 `article.md` 在就
够。所有信息（标题、hook、章节、时长）都从 `article.md` 推出来。

两个命令都加 `--provider minimax` 走真实 AI（需要 `MINIMAX_API_KEY` + 配额）：

```bash
vf thumbnail "$TOPIC" --provider minimax
vf shorts "$TOPIC"     --provider minimax
```

### 12.6 查看产出

```bash
ls "projects/$TOPIC/output/"
ls "projects/$TOPIC/assets/audio/"
ls "projects/$TOPIC/assets/audio-assets/"
ls "projects/$TOPIC/captions/"
ls "projects/$TOPIC/runs/"            # 每次 agent / tool 调用一条 run 记录
```

### 12.7 一段复制粘贴即可运行的完整流程

假设 `vf` 在 PATH 中、`GLM_API_KEY` 已设置（没有就加 `--fake`）：

```bash
TOPIC="ai-thinking"
vf new "$TOPIC"
vf draft "$TOPIC"                     # 写 article.md + 派生 storyboard.yaml
vf audio-plan "$TOPIC"

# 人工编辑文章与音频计划（任意编辑器）
$EDITOR "projects/$TOPIC/article.md"
$EDITOR "projects/$TOPIC/audio-config.yaml"
# 比如想让每句之间停 1 秒，把它写进 audio-config.yaml：
#   echo 'pause_between_sentences_sec: 1' >> "projects/$TOPIC/audio-config.yaml"

vf make "$TOPIC"                     # → preview.mp4 + final-mixed.mp4

# 可选
vf youtube "$TOPIC"                  # 现在 article.md 直接可用，无需 research/script/storyboard 三件套
vf thumbnail "$TOPIC"
vf shorts "$TOPIC"
```

最终发布件是 `projects/$TOPIC/output/final-mixed.mp4`，加上
`projects/$TOPIC/youtube/` 下的 YouTube 包。

### 12.8 旧版多命令流水线（保留作为遗留路径）

旧版保留了细粒度的多阶段命令（`vf research` / `vf script` /
`vf storyboard` / `vf audio` / `vf audio-asset` / `vf mix` / `vf review` /
`vf approve` / `vf reject` / `vf rollback` / `vf preview` / `vf final`），
新项目**不建议**使用。新版的 `vf draft` + `vf audio-plan` + `vf make`
已经把它们内化：

| 旧命令                                       | 新版替代                                                       |
| -------------------------------------------- | -------------------------------------------------------------- |
| `vf research` / `vf script` / `vf storyboard` | `vf draft`（一次产出 article.md，等同三者合并）                |
| `vf audio`                                   | 由 `vf make` 内化                                              |
| `vf audio-asset`                             | 由 `vf make` 内化                                              |
| `vf mix`                                     | 由 `vf make` 内化                                              |
| `vf preview` + `vf final`                    | 由 `vf make` 一次性产出                                         |
| `vf approve` / `vf reject` / `vf rollback`   | 不再需要 — 编辑 `article.md` / `audio-config.yaml` 后重跑 `vf make` |

如果你的项目已经在用旧版格式（`research/`、`script/`、`storyboard.yaml`），它们仍
可工作；后续可以加一个 `vf migrate <project>` 把它们合并成 `article.md`。

## 13. 用验收脚本验证

跑完上面流程后，`npm run acceptance` 会在 `projects/benchmark-v01/`
参考项目上执行 §62.4 审计（39 秒的中文思维链讲解视频）。审计检查文件
格式、运行时和来源追溯，全程不需要 AI 介入。

```bash
npm run acceptance
# 预期："ALL 11 §62.4 acceptance checks passed"
```
