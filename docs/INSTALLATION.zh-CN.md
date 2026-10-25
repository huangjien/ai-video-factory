# AI Video Factory — 安装

在机器上跑起 AI Video Factory 所需的一切。

- **想直接做视频？** → [`docs/USAGE.zh-CN.md`](./USAGE.zh-CN.md)
- **想了解系统设计？** → [`docs/architecture.md`](./architecture.md)
- **想查分镜格式？** → [`docs/schema.md`](./schema.md)

本文覆盖：环境要求、安装、验证，以及可选的编程代理适配器。

---

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

---

## 2. 安装项目

### 2.1 从仓库克隆安装

在仓库根目录执行：

```bash
pnpm install
pnpm run build
```

构建会把所有 workspace 包编译到 `packages/*/dist`。

### 2.2 调用 CLI

CLI 从编译产物运行：

```bash
node packages/cli/dist/index.js --help
```

可以在当前 shell 里设置简写：

```bash
alias video='node packages/cli/dist/index.js'
```

[`docs/USAGE.zh-CN.md`](./USAGE.zh-CN.md) 里的每个示例都假定这个简写已生效。

仓库还提供一个 wrapper，供编程代理 shell 和自动化脚本使用——它把每个动词转发给同一个 CLI：

```bash
bin/video --help
```

### 2.3 全局安装

发布 `@video/*` packages 后，用户可以全局安装 CLI：

```bash
npm install --global @video/cli
video --help
```

全局安装只安装 CLI 和运行时依赖，不会把项目文件写入 npm 的全局安装目录。项目会创建在当前工作目录，或 `--cwd` 指定的目录下：

```bash
mkdir my-video-projects
cd my-video-projects
video new demo
```

### 2.4 本地开发

不发布，而是把 workspace 的 CLI 链接过去：

```bash
npm run build
npm link --workspace @video/cli
video --help
```

改动源码后，重建再使用 CLI：

```bash
npm run build
```

---

## 3. 验证安装

跑一遍类型检查和测试：

```bash
npm run build
pnpm test
```

其余项目检查：

```bash
pnpm run lint
pnpm run format:check
npm run benchmark:verify
pnpm run acceptance
```

`benchmark:verify` 和 `acceptance` 会真的渲染视频，因此需要 FFmpeg、ffprobe
和可用的本地 Remotion 渲染器。部分 provider 集成测试需要本地回环 socket，
它们不能替代真实 API 测试。

安装成功的标志是十一项验收检查全部通过：

```text
ALL 11 §62.4 acceptance checks passed
```

---

## 4. 编程代理适配器（v0.4.1）

`video` CLI 是**稳定的、与 harness 无关的接口**。仓库为官方支持的 harness
提供适配文件；每个适配器都转发到 `video`（或转发到 `bin/video`，一个薄
shell wrapper）。

### 4.1 Shell 封装 — `bin/video`

把每个动词转发给 `video`，所以任何 shell、Makefile 或 CI 脚本都能用同一个
二进制驱动整条流水线。不需要 harness。

### 4.2 OpenCode — `.opencode/command/video.md`

OpenCode、Cursor、Claude Code 等会查找 `.opencode/command/*.md` 的
agentic harness，会把 `/video` 当成斜杠命令加载。该文件使用 OpenCode 的
frontmatter（`description`、`tools`），正文列出每个动词、canonical 流程顺序，
以及关键不变量（绝不自动批准、凭据留在环境变量里、失败要响亮）。

### 4.3 pi / oh-my-pi — `.omp/commands/video.md`

`oh-my-pi` 编程代理（`@oh-my-pi/pi-coding-agent`，omp.sh）会在
`<cwd>/.omp/commands/*.md` 下发现原生斜杠命令。仓库提供
`.omp/commands/video.md`，使用 OMP 原生 frontmatter（`name`、`description`），
正文与 canonical 流程和不变量一致。在 `omp` 交互会话里，用户输入斜杠命令，
其参数会原样映射到 CLI 参数。

命令正文使用 `$ARGUMENTS`，所以斜杠输入会原样透传。权限默认为
`read: allow, write/edit/bash: ask`（在 `.omp/settings.json` 里），以保住
"人工门"原则——代理可以自由读取，但改动任何东西之前必须先问。

#### OMP 中的技能

`.agents/skills/<name>/SKILL.md` 是技能的权威来源（见 `skills-lock.json`）。
对 OMP 而言，`.omp/skills/<name>/SKILL.md` 是软链接，指向权威文件——
`readlink -f .omp/skills/<name>/SKILL.md` 能看到真实路径。
`.omp/settings.json` 把 `skills.customDirectories` 指向 `.omp/skills`，
这样 OMP 原生的 provider 就能连同其他技能一起加载它们。

安装新技能时，先加到权威的 `.agents/skills` 目录，然后确认
`.omp/skills/<new-skill-name>/SKILL.md` 的软链接存在。如果安装器没有创建，
手动补一个即可——每个技能只需要一个软链接。

### 4.4 为什么没有自动批准

按 `docs/workflow.md`，工作流在每个生成步骤和下一个步骤之间都强制一道人工门。
无论调用方是 OpenCode、OMP，还是终端前的人，代理都只负责调用生成类动词并
把产物亮出来；人来读、来批准，然后预览才会碰到渲染路径。

### 4.5 接入新的编程代理

1. 在该 harness 期望的目录下创建它自己的命令文件（`.opencode/commands/`、
   `.omp/commands/`、`.claude/commands/`、`.gemini/commands/`、
   `.codex/commands/`）。
2. 使用该 harness 原生的 frontmatter 结构。
3. 在正文里写清参数展开方式（OMP 用 `$ARGUMENTS`，OpenCode 和 Claude 用
   位置参数）。
4. CLI 始终是唯一事实来源——绝不要在适配文件里重复实现动词逻辑。

---

## 5. 安装阶段的问题排查

### 找不到 FFmpeg 或 ffprobe

渲染路径需要两个二进制都在 `PATH` 上。用对应平台的包管理器安装（macOS 用
`brew install ffmpeg`，Debian / Ubuntu 用 `apt-get install -y ffmpeg`），
然后重开 shell 让新的 `PATH` 生效。

### 找不到 `packages/cli/dist/index.js`

CLI 还没构建。在仓库根目录执行 `pnpm run build`。改动源码后同样要执行这一步
——CLI 跑的就是编译产物。

### 缺少 MiniMax 或 GLM key

AI 类命令（`video draft`、`video research`、`video script`）需要在环境变量里
有 provider key。运行前设置 `GLM_API_KEY` 或 `MINIMAX_API_KEY`。本地渲染
路径不需要 key——完全离线的路线见 [`docs/USAGE.zh-CN.md`](./USAGE.zh-CN.md)。

### key 已设置但调用仍然失败

key 只从 shell 环境变量读取，不会从提交进仓库的文件里读。确认变量在启动 CLI
的那个 shell 里已经导出，并检查 provider 的配额——429、402、403 会触发自动
降级到备用 provider，实际服务的 provider 会记录在 `runs/<run-id>.yaml` 里。

### 磁盘占用增长很快

通常是 `node_modules` 和 Remotion 打包缓存。渲染器在打包选项里禁用了
Remotion 的持久化 webpack 缓存，因为开着会泄漏几十 GB。删掉
`packages/video-renderer/.studio` 和任何 `scenes-draft/` 目录就能回收空间。

---

## 下一步

安装完成。继续读 [`docs/USAGE.zh-CN.md`](./USAGE.zh-CN.md) 开始做视频。
