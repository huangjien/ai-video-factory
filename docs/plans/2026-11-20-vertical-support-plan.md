# 竖屏(9:16)支持方案(2026-11-20)

## 现状调查

### 已经参数化的(不需要改)

| 环节 | 证据 |
|---|---|
| Remotion 组合尺寸 | `Root.tsx:265` `width={renderPlan.project.width} height={renderPlan.project.height}` — 全部来自 render plan 的 project 块 |
| 字幕几何 | `captionStyle.ts` 全部是帧占比(0.032×height、宽度比例)— 竖屏自动适配 |
| 品牌角标 | "px at 1080p scaled by width/1920" — 相对缩放 |
| 图片生成 | MiniMax/Gemini/OpenAI 都支持 9:16(`aspect_ratio` 吸附机制现成,720×1280) |
| 渲染管线 | `CompileOptions {fps, width, height}` 参数化;draft 模式 960×540 同机制 |
| shorts 命令 | 已经产出 1080×1920(ffmpeg 裁切横片)— 半成品竖屏路径 |

### 硬编码阻塞点(全部聚集在"格式源头")

| 位置 | 现状 | 改法 |
|---|---|---|
| `draft/src/schemas.ts:276-277` | 编译模板硬编码 `width: 1920 / height: 1080` | 按 format 发 1080×1920 |
| `draft/src/image-prompt.ts:225` | 图生 prompt 写死 "Frame: 16:9 landscape, 1920x1080" | 按 format 换 "9:16 vertical, 1080x1920" — 否则图模型生成横版构图 |
| `new-command.ts` 脚手架 | project.yaml + storyboard 模板写死 1920×1080 | 按 format 落 |
| `media-generators` 请求尺寸 | 图生成请求需要拿到项目宽高(线程穿透) | visuals/make 阶段传项目 dims |
| 组件竖排走查 | captionStyle 比例制 ✓ 但视觉合理性(窄屏字号/断行/水印大小)未验证 | 竖屏 preview 走查,微调 |

## 设计决策

**单一格式源**:`article.md` frontmatter 新增 `format: landscape | vertical`(默认 landscape,向后兼容)。它是源 — storyboard 编译器、VDSL、render plan 全部从它派生宽高;`storyboard.yaml` 的 project 块携带最终数值(1080×1920 或 1920×1080),下游照旧。

**不做的事**:
- 不引入任意分辨率 — 只有两种格式(防配置爆炸)
- 不改 shorts(已是竖屏)
- 不动 auto 默认 — auto 生产 landscape 先行;竖屏作为衍生/显式选择(见分期)

## 分期

### Phase 1 — 格式线程(P0,约 1 天)
1. article frontmatter `format` 字段 + `video draft --format vertical` 旋钮 + agent-ask 问题
2. schemas.ts 编译模板 + image-prompt 按 format 分支
3. new-command 脚手架按 format
4. visuals/make 传项目宽高给图生成
5. 验证:`--fake` 全链路出一支竖屏片;真实出图抽查验构图

### Phase 2 — 组件竖排走查(P0,约 1 天)
1. 竖屏 preview 走查:字幕带、标题卡、品牌角标(72px 按 width/1920 缩放在竖屏 = 42px,验证可读性)、 Ken-Burns
2. 微调发现的绝对几何(预期少量)

### Phase 3 — 封面与发布(P1,约半天)
1. `video thumbnail --format vertical`(1080×1920 品牌版封面,角标/边框逻辑复用)
2. 发布流不变(YouTube 竖屏自动识别;≤60s 竖屏自动归 Shorts;B站支持竖版)
3. zhihu 不变

### Phase 4 — 竖版衍生 + Shorts/TikTok 发布(已定向,2026-11-20)

**决策**:每部横片自动配一条竖版衍生,提交 YouTube Shorts;TikTok 预留通道(接口就位,实现待账号/API)。

**4a. 衍生片生成** — 复用 `video shorts` 的既有双路径:
- minimax 路径(首选):AI 用 thumbnail + shorts-hook 生成真竖版短视频(非盲裁)
- mock 路径(离线兜底):ffmpeg 中心裁切 `crop=ih*9/16`
- 选段:v1 用 shorts-hook 指定的开场(打包时 LLM 已选最钩人的 60s);后续按字幕时间轴选"钩子+回报"完整弧段

**4b. 发布通道** — auto 管线在四通道后追加两步:
- YouTube Shorts:竖片 `--upload --privacy private`(与主片同惯例,公开人工翻转);竖片 ≤60s 被 YouTube 自动归 Shorts
- TikTok:通道接口就位(平台名/视频文件/标题/tags/可见性的统一记录格式,元数据 JSON 先落盘 `tiktok/package.json`),实现延后 — TikTok Content Posting API 需要应用审核, unofficial 路径风险高

**4c. 开关与记录**:
- `video backlog auto --no-shorts` 跳过衍生
- run record 增 `shorts` 阶段(bvid/video-id 落盘同 bvid.txt 惯例)
- stats 增 shorts 档(每部片衍生数)

**验证**:一支真竖片 Shorts(YouTube 后台可见 ≤60s 竖屏标记);mock 路径离线全链路绿。

## 验证标准
- `video draft <topic> --format vertical --fake` 全链路绿
- 真实竖屏片一支:出图构图 9:16、字幕带位置合理、角标可读、发布成功
- 横屏回归:默认 format 全链路零差异(现有项目不动)

## 工作量
Phase 1+2 ≈ 2 天;Phase 3 ≈ 半天;Phase 4 另议。
