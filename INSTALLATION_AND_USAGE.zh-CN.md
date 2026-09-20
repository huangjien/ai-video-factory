# AI Video Factory 安装与使用手册

本文档说明当前仓库的实际安装方式、CLI 命令和完整使用流程。

AI Video Factory 将结构化 storyboard 转换为 1920×1080 MP4：

```text
Storyboard YAML
    ↓
校验
    ↓
编译为 VDSL / RenderPlan
    ↓
Remotion + FFmpeg
    ↓
Preview MP4
    ↓
人工审核
    ↓
Final MP4
```

项目也包含可选的 Research、Script、Storyboard、Review 和 YouTube 元数据 Agent。

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
npm install
npm run build
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
npm test
npm run lint
npm run format:check
```

完整验收和 benchmark：

```bash
npm run benchmark:verify
npm run acceptance
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

## 6. 本地核心流程

### 6.1 校验

```bash
node packages/cli/dist/index.js validate \
  projects/demo/storyboard/storyboard.yaml \
  --root projects/demo
```

错误信息会包含文件、行号、字段和具体原因。

### 6.2 查看状态

```bash
node packages/cli/dist/index.js status --cwd projects/demo
```

### 6.3 审核源文件

编辑并审核 `storyboard/storyboard.yaml`。项目初始为 `DRAFT`；第一次人工批准点在成功生成 preview 之后创建。

### 6.4 生成 Preview

```bash
node packages/cli/dist/index.js preview --cwd projects/demo
```

该命令依次执行校验、编译、Remotion 渲染和 FFmpeg faststart 处理：

```text
projects/demo/output/preview.mp4
projects/demo/output/preview-faststart.mp4
```

成功后，项目进入 `review / WAITING_REVIEW`。

### 6.5 批准 Review 并生成 Final

```bash
node packages/cli/dist/index.js approve review --cwd projects/demo
node packages/cli/dist/index.js final --cwd projects/demo
```

输出：

```text
projects/demo/output/final.mp4
projects/demo/output/final-faststart.mp4
```

`final` 要求 `review` checkpoint 已经是 `APPROVED`。成功后项目状态为 `FINAL_APPROVED`。

## 7. 编辑、拒绝、回滚与恢复

修改 storyboard 后重新校验和预览：

```bash
vf validate projects/demo/storyboard/storyboard.yaml --root projects/demo
vf preview --cwd projects/demo
```

拒绝当前 checkpoint：

```bash
vf reject wrong-pacing --cwd projects/demo
```

常用原因包括 `wrong-content`、`wrong-pacing`、`wrong-style` 和 `missing-information`。

回滚需要交互确认：

```bash
vf rollback storyboard-v2 --cwd projects/demo
```

回滚不会删除 Git 历史或已有输出文件。完成检查后，应重新运行校验和 preview。

查看当前阶段和 Git commit：

```bash
vf resume --cwd projects/demo
```

## 8. 可选 AI 工作流

AI 命令使用 MiniMax 或 GLM API，核心本地渲染流程不依赖它们。

在 shell 中设置密钥，不要提交到 Git：

```bash
export MINIMAX_API_KEY="..."
export GLM_API_KEY="..."
```

自定义 provider 路由文件：

```bash
export LL_CONFIG="$PWD/llm.config.yaml"
```

### Research

```bash
vf research "AI Agent Memory"
```

生成：

```text
projects/ai-agent-memory/research/research.md
projects/ai-agent-memory/research/sources.yaml
projects/ai-agent-memory/research/claims.yaml
```

禁用 Web Search：

```bash
vf research "AI Agent Memory" --no-web
```

使用指定 provider：

```bash
vf research "AI Agent Memory" --model glm --lang zh-CN --duration 60 --audience developers
```

使用前应人工检查来源和 claims。

### Script

```bash
vf script "AI Agent Memory" \
  --from-research projects/ai-agent-memory/research \
  --duration 60 \
  --lang zh-CN
```

输出：

```text
projects/ai-agent-memory/script/script.zh-CN.md
```

默认结构是 Hook → Problem → Explanation → Example → Comparison → Implication → Conclusion。

### Storyboard Agent

```bash
vf storyboard "AI Agent Memory" \
  --from-research projects/ai-agent-memory/research \
  --from-script projects/ai-agent-memory/script/script.zh-CN.md \
  --duration 60 \
  --style dark-tech
```

输出 `storyboard/storyboard.yaml`。必须人工审核后再渲染。

### Review Agent

```bash
vf review ai-agent-memory
```

生成：

```text
review/content-review.yaml
review/visual-review.yaml
review/technical-review.yaml
```

Review Agent 只读，不会自动批准、拒绝或修改项目。

### YouTube 元数据

```bash
vf youtube ai-agent-memory
```

生成标题、简介、WebVTT chapters、结构化 YAML、缩略图提示词和 Shorts hook。它不会上传 YouTube，也不会生成缩略图或 Shorts MP4。

## 9. 语音和字幕

`audio` 命令需要 storyboard 和 script：

```bash
vf script "AI Agent Memory"
vf audio ai-agent-memory
```

默认使用 Edge TTS，不需要 API key，但需要网络连接。它依赖在线 Microsoft Edge TTS 服务，可能受到限流或网络故障影响。

离线测试：

```bash
vf audio ai-agent-memory --fake
```

输出：

```text
projects/ai-agent-memory/assets/audio/scene-01.wav
projects/ai-agent-memory/captions/zh-CN.srt
```

将音频路径写入对应 Scene：

```yaml
narration:
  text: "Scene narration"
  audio: assets/audio/scene-01.wav
```

音频路径相对于项目根目录解析。

Edge TTS 没有直接 API 费用，但商业再分发和长期生产使用应先确认服务条款。需要正式授权的生产服务时，可通过 TTS provider 接口替换。

## 10. 项目文件和可追溯性

```text
project.yaml                 项目元数据
storyboard/storyboard.yaml   可人工编辑的源文件
vdsl/vdsl.yaml               编译后的标准 VDSL
state.yaml                   当前工作流状态
checkpoints/                 批准和失效记录
runs/<run-id>.yaml           执行与来源记录
assets/                      音频、图片、截图和字体
output/                      preview 和 final MP4
```

AI 执行记录还包含 provider、model、token 使用量、prompt hash 和估算成本。

不要把 API key、`.env`、私有资料或凭据提交到仓库。

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

`assets/audio/scene-01.wav` 这类路径相对于项目根目录，而不是 YAML 文件所在目录。使用 `--root` 指定项目根目录。

### `final` 提示 review 未批准

```bash
vf status --cwd projects/demo
vf approve review --cwd projects/demo
vf final --cwd projects/demo
```

### Edge TTS 失败

检查网络并重试；离线 CI 使用：

```bash
vf audio <project> --fake
```

### Remotion 无法找到端口

可能是其他渲染进程占用端口，或当前执行环境禁止本地 loopback。停止残留进程后重试，并确认本地端口绑定权限。

## 12. 推荐首次运行

```bash
npm install
npm run build

node packages/cli/dist/index.js new demo

# 编辑 projects/demo/storyboard/storyboard.yaml
node packages/cli/dist/index.js validate \
  projects/demo/storyboard/storyboard.yaml --root projects/demo

node packages/cli/dist/index.js preview --cwd projects/demo
node packages/cli/dist/index.js approve review --cwd projects/demo
node packages/cli/dist/index.js final --cwd projects/demo
```

最终文件位于：

```text
projects/demo/output/preview-faststart.mp4
projects/demo/output/final-faststart.mp4
```
