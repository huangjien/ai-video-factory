# 频道声音系统（Sound System）

> 目的：既不单调，又让观众听得出"这是同一个频道"。
> 做法：**片头动机固定 + 正文按题材换曲 + 片尾回到同一动机**。
> 单一曲子铺满全片 ≠ 品牌；固定动机 + 变化正文 = 品牌。

## 三层结构

| 层 | 时长 | 内容 | 目的 |
|---|---|---|---|
| **片头动机** | 0–12s | 每期**同一首**的同一段 | 听觉 logo：观众 12 秒内认出频道 |
| **正文** | 12s–(总长−10s) | 按题材族选曲，**每期不同** | 避免单调；匹配内容气质 |
| **片尾回扣** | 最后 10s | 回到片头同一首 | 听觉闭环，形成"起承转合"的结构感 |

## 片头动机：`epic-the-epic-hero`

- 元数据依据：曲库索引写明 *"Opening beats and high-stakes reveals — an orchestral piano build"* —— 这首就是为片头准备的。
- -13.3 LUFS（非 `quiet_master`，人声垫得住）、149s 曲长，够取首 12s。
- 片尾回扣用同一首的同一段，和片头**完全一致**——这和电视/播客的收尾签名音是同一个做法，观众听的是"同一个东西出现两次"。

## 正文曲库分组（按 `packages/prompts/prompts/music.json` 的 `use_when` 归族）

| 题材族 | 曲目 | 索引原文依据 | 已用于 |
|---|---|---|---|
| 方法论 / 思维模型 | `classical-gymnopedie-no-3`、`ambient-take-your-pick` | "Quiet, reflective, philosophical or historical narration" / "wide, unobtrusive bed" | 软件架构和实现、领域建模 |
| 军事 / 历史 | `war-endless-storm`、`chinese-lau-tzu-ehru`、`medieval-adventure-beyond` | "Open conflict — an army, a siege, a standoff" / "Chinese historical or period scenes" / "Journey and quest narratives - a caravan, a voyage, an expedition" | 从伍什到班排、任务式指挥 |
| 技术 / 工程 / Agent | `electronic-nekozilla`、`inspiring-flowing-energy`、`corporate-synesthesia` | "Tech/futuristic explainers and build-ups" / "Forward motion — a build, a turning point" / "polished, modern bed" | 扁平化组织与任务式指挥 |
| 轻松 / 科普 | `cheerful-smile-ikson`、`upbeat-your-love`、`hiphop-groomin` | "upbeat without being frantic" / "Beat-driven, casual explainers" | — |

## 选曲的四条硬约束

1. **`quiet_master: true` 的曲子不要做正文底**——混音器对所有窗口施加**同一个固定底音量**，安静的曲子会被人声淹没（`japanese-yugen` -22 LUFS、`chinese-lau-tzu-ehru` -17 LUFS 只适合片段/历史场景）。
2. **时长不够会循环**——`needs_loop_under_300s: true` 的曲子会在片长超过曲长时循环；8 分钟以上的片子优先选 ≥300s 的曲子（如 `dramatic-this-too-shall-pass` 448s、`hopeful-resolutions` 328s、`medieval-adventure-beyond` 309s）。
3. **循环点要听不见**——曲子开头和结尾都接近静音时，循环缝就听不出来（`epic-phoenix`、`medieval-adventure-beyond` 都是这种）。反之，开头很响、结尾突然静音的曲子（如 `electronic-nekozilla`、`ambient-take-your-pick`）每循环一次就会“炸”一下。
4. **`avoid_when` 优先于 `use_when`**——例如 `trailer-silhouette-of-war` 索引明写 *"the percussion fights the voice"*，解说不适合。

## 实现：`audio-config.yaml` 的 `bgm_tracks`

```yaml
voice: Chinese (Mandarin)_Male_Announcer
bgm_tracks:
  - { track: epic-the-epic-hero, until_sec: 12 }    # 片头动机
  - { track: medieval-adventure-beyond, until_sec: 470 }  # 正文（until_sec = 总长 − 片尾长度）
  - { track: epic-the-epic-hero }                   # 片尾回扣（末窗省略 until_sec = 跑到结尾）
bgm_fade_in_sec: 2
bgm_fade_out_sec: 3
pause_between_sentences_sec: 0.5
```

- 时间窗是**绝对秒**；只有**最后一窗**可以省略 `until_sec`（跑到结尾），否则混音器直接报错。
- 各窗之间有 1s 交叉淡化，合成一条 `_timeline.wav`。
- `until_sec` 需要成片的**实测**总时长（TTS 测出来的），所以流程是：**先 make 一次拿到总长 → 改 `audio-config.yaml` → 再 `video mix` 一次**（只重混，不重渲染）。

## 踩过的坑（2026-11-13）

1. **`video mix` 不支持 `bgm_tracks`**——独立 mix 命令只认显式的 `--bgm <path>`；多窗口时间窗只在 `video make` 的混音步骤里被解析。要改 BGM 窗口就**重跑 `video make`**（增量：TTS/图片/渲染都命中缓存，只重建时间窗 + 重混）。
2. **`bgm_tracks` 的命名标签曾无法解析**（已修）——多窗口分支把标签硬编码到 `<项目>/assets/audio-assets/bgm/<tag>.wav`，而那个文件只在传了 `--bgm-dir` 时才会生成，导致任何"命名库曲"的多窗口配置都在建时间窗时 ffmpeg 报 `No such file or directory`。现在统一走 `resolveLibraryBgm`（项目覆盖 → 工作区曲库 → 工作区品牌音频），修复在 `packages/make/src/index.ts` 的 `resolveBgmTrack()`，测试见 `packages/make/src/bgm-track-resolution.test.ts`。
3. **GLM 有周/月配额**（2026-11-13 撞到 429，限额 11-15 03:11 重置）——`video translate` 可用 `--model minimax` 绕开。
4. **推理型模型会带 `<think>` 前缀**（已修）——MiniMax 等提供方在正文前加推理块，translate 路径原先只做了 `stripFence`，导致"缺 frontmatter / 24 个场景全缺失"。现在先 `stripReasoning` 再 `stripFence`，测试见 `packages/draft/src/translate-article.test.ts`。

## 每期的执行清单

1. `video draft … --bgm <正文曲>`（只影响初始 audio-config，后面会手改）。
2. `video make` → 得到实测总时长 D。
3. 手改 `audio-config.yaml`：`bgm_tracks` 三段，`until_sec` = 12 / (D − 10) / 省略。
4. `video make <project>` → 重建 BGM 时间窗并重新混音（增量：不重渲染、不重出图；`video mix` 不认 `bgm_tracks`）。
5. `video qa <project>` 复核音频。
