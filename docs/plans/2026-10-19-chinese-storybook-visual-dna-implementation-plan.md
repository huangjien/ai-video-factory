# 中式静观叙事视频风格：开发计划

> 基于已确认的 [风格设计](./2026-10-19-chinese-storybook-visual-dna-design.md)。本文是可执行任务清单；任务 ID 稳定，可直接复制到 issue tracker。此计划不代表任务已经实现。

## 目标

把频道叙事语法接入现有 `article.md → storyboard/VDSL → assets → render` 流程，并以《玄武门》完成首支淡彩工笔样片。频道语法跨片复用；每支视频仍可选择一种画风，并在整片保持一致。

## 完成条件

- 《玄武门》使用淡彩工笔图像预设和 `paper-light` 主题，全片不混切其他画种。
- 首镜是悬念叙事画，片名和必要的章节提示以无衬线字叠在留白处；没有独立标题卡或常驻角标。
- 旁白完整呈现为同步字幕，同一时刻最多两行；叙述语速目标为每分钟 220–240 个中文字。
- 大多数镜头静止；需要动效时，每镜最多一种低幅变化。没有可控遮罩时不做局部环境动画。
- 李世民的身份、青年秦王/后期皇帝两个变体、史料依据和画风参考均可追溯；正式参考图经过人工批准。
- scene-08 是唯一全屏地图插页；只画核实过的主要山河、路线和标记，不含可读地名。
- 成片 3–8 分钟，画面、声音、旁白和字幕通过人工样片评审。

## 边界与实施原则

- `channel_profile` 表示跨片复用的叙事、文字、字幕和运动语法；`image_style` 表示单片画种。两者不能合并成一个“画风”开关。
- 首版只实现 `chinese-storybook` 频道配置和 `gongbi` 图像预设；不迁移其他既有视频，也不增加其他画种的实现。
- 角色图像暂不作为生成模型的图像条件；首版以角色文字锚点、候选/正式状态、联系表和人工审核维持一致性。
- 局部雨丝、灯笼等动画依赖可独立控制的图层或遮罩；若无法得到可靠遮罩，首版成片以静止和慢推为限。
- 《玄武门》的 article 是源文件；storyboard、VDSL、图像和音视频均由流程重新生成，不把派生文件作为长期手工维护源。

## 任务清单

### A. 配置基础与风格提示

- [ ] **CS-01｜建立频道配置与画种配置的独立字段** `P0`
  - 依赖：无
  - 涉及：`packages/draft/src/schemas.ts`、`packages/cli/src/draft-command.ts`、`packages/vdsl/src/schema.ts`、article → storyboard 编译链。
  - 实施：为源 article 增加可选 `channel_profile: chinese-storybook`；新增 `video draft --channel-profile chinese-storybook`，将选项写入 article frontmatter，并传到 storyboard/VDSL/render plan。保留现有 `image_style` 作为逐片画种字段，不改变旧项目未指定 profile 时的行为。
  - 验收：新样片能显式选择频道配置和画种；修改画种不会清除频道配置；未配置频道 profile 的既有 article 仍按旧流程生成。

- [ ] **CS-02｜新增淡彩工笔图像预设** `P0`
  - 依赖：CS-01
  - 涉及：`packages/prompts/prompts/image-styles.yaml`、`packages/draft/src/image-style.ts`、`packages/prompts/prompts/draft-image-prompt.md`。
  - 实施：在 `packages/draft/src/image-style.ts` 的样式列表和 `image-styles.yaml` 中新增 `gongbi` 预设，描述克制细线、低饱和分层设色、旧纸 `#E8E0CF`、墨黑 `#242521`、烟灰 `#77786F`、按场景调整的青灰 `#657B78`/赭黄 `#B38A56`，以及少量朱砂 `#A54A3D` 强调色；强调历史服饰可信度和远景简化。所有场景使用同一规则。明确禁止多格、拼贴、漫画分镜、模型绘字和跨场景切换画种。
  - 验收：`image_style: gongbi` 在提示扩写与最终图像提示中均生效；无论场景是人物、建筑、山水还是图解插页，提示中都保留工笔表面风格和字幕留白。

- [ ] **CS-03｜把说书叙事约束接入起稿和内容评审** `P0`
  - 依赖：CS-01
  - 涉及：`packages/prompts/prompts/draft-article.md`、`packages/draft/src/article-review.ts` 及其评审配置。
  - 实施：只在 `chinese-storybook` profile 下要求沉静、清楚、有停顿的固定讲述者；人物对白以旁白转述；目标语速 220–240 个中文字/分钟，旁白占成片约 55–70%。保留单集“悬念—背景—局势—选择/转折—回扣开场”的叙事弧线。
  - 验收：新稿可按目标时长形成 3–8 分钟脚本；评审能指出超出语速/占比目标或对白演员化的稿件；profile 之外的稿件不被错误套用此规则。

- [ ] **CS-04｜统一《玄武门》样片的主题与源配置** `P0`
  - 依赖：CS-01、CS-02
  - 涉及：`projects/玄武门/article.md`、`projects/玄武门/project.yaml`、`projects/玄武门/storyboard/storyboard.yaml`、`projects/玄武门/vdsl/vdsl.yaml`。
  - 实施：在 article 中声明 `channel_profile: chinese-storybook`、`image_style: gongbi`、`theme: paper-light`、唐代时空设定及约 300 秒目标；统一项目元数据与派生 storyboard/VDSL 使用 `paper-light`。storyboard/VDSL 在重生成后也必须保留该主题。
  - 验收：从 article 重新派生 storyboard/VDSL 后主题仍一致；风格配置没有落回 `editorial` 或 `dark-tech`。

### B. 单幅画面、标题和字幕

- [ ] **CS-05｜让首镜成为可生成图像的悬念场景** `P0`
  - 依赖：CS-01、CS-02
  - 涉及：`packages/draft/src/visual-classifier.ts`、`packages/draft/src/visual-builders.ts`、`packages/prompts/prompts/storyboard.md`。
  - 实施：移除“第一场景必为独立 `Title` 组件”的默认分流；保留首镜视觉方向，使其进入正常叙事图生成路径。片名取自文章标题，不再替代首镜画面或复用场景 caption。
  - 验收：首个场景生成工笔叙事图；不存在单独纯色标题镜头；重新生成 storyboard 不会把第一镜改回 `Title` 卡。

- [ ] **CS-06｜增加叠加式片名和可选章节提示** `P1`
  - 依赖：CS-05
  - 涉及：`packages/vdsl/src/schema.ts`、`packages/vdsl/src/compile.ts`、`packages/video-renderer/src/Root.tsx`、`packages/video-components/src/` 的文字叠层组件。
  - 实施：新增可选、结构化的场景文字叠层。首镜片名短暂出现在图像留白处后淡出；章节名仅在段落转换确有帮助时叠加，不生成独立章节卡。沿用主题无衬线字配置，并支持安全区位置和显示时段。
  - 验收：叠层只影响文字层，不替换或遮住背景图；不配置章节提示时不显示；所有标题与字幕均使用主题字体，画面无书法字。

- [ ] **CS-07｜把完整旁白字幕限制为同步的两行以内** `P0`
  - 依赖：CS-01
  - 涉及：`packages/media/src/captions.ts`、`packages/vdsl/src/compile.ts`、`packages/vdsl/src/validate-project.ts`、`packages/video-components/src/components/CaptionsOverlay.tsx`、`packages/make/src/index.ts`。
  - 实施：将整段旁白按句读/停顿切成字幕 cue；每个 cue 最多两行且不截断文字。按实际单场景音频时长和文字长度分配 cue 时间；同一套 cue 同时用于画面烧录字幕和 `captions/<lang>.srt`。超长 cue 在标点处拆分，避免堆成三行以上。保留无底板、墨色无衬线字和轻微描边，不重复显示场景标题。
  - 验收：任何时刻最多显示两行；整段旁白均有字幕；字幕 cue 按场景音频时长连续、无倒序/空洞；字幕不出现不透明底条，人物面部和关键道具不被字幕覆盖。

- [ ] **CS-08｜为频道配置关闭叙事镜头常驻角标** `P1`
  - 依赖：CS-01
  - 涉及：`packages/vdsl/src/schema.ts` 的 brand 配置、`packages/video-renderer/src/pipeline.ts`、`packages/video-renderer/src/Root.tsx`、`projects/玄武门/brand.yaml`。
  - 实施：增加明确的 watermark 开关，使项目能关闭继承自根目录 `brand.yaml` 的每镜角标；为《玄武门》关闭。片尾签名暂不启用，直到频道名称和标记正式确定。
  - 验收：样片的所有叙事镜头与地图没有角标；关闭 watermark 不影响其他项目沿用当前品牌配置。

### C. 静观运动

- [ ] **CS-09｜实现静止优先、每镜最多一种变化的运动策略** `P0`
  - 依赖：CS-01
  - 涉及：`packages/prompts/prompts/motion.md`、`packages/motion/src/agent.ts`、`packages/motion/src/plan.ts`、`packages/video-components/src/components/ImageBackground.tsx`、VDSL 动画验证。
  - 实施：`chinese-storybook` 镜头默认静止；允许把 `ImageBackground.kenBurnsScale` 设为 `0` 或约 `0.015` 来表达静止/1–2% 慢推，不自动叠加入场、强调、平移等变化。profile 下的 motion agent 可返回零条或一条动画，但不得强制为每镜生成动画。80/15/最多 5% 只作成片抽样参考，不自动强凑比例。非此 profile 继续使用现有规则。
  - 验收：静帧镜头可以无动画通过；慢推镜头只有一次低幅画面推进；不出现自动高亮、文字逐字揭示或随节拍运动。
  - 代码现状：Motion prompt 写了 `camera` 类型，但 VDSL `ANIMATION_TYPES` 当前不含 `camera`；首版不依赖该动画类型，先复用 `kenBurnsScale`。

- [ ] **CS-10｜验证局部环境微动的素材条件** `P2`
  - 依赖：CS-09
  - 涉及：图像资产流程、遮罩/分层格式及一个人工审核样例。
  - 实施：只为一幅具有叙事理由的画面试做雨丝或灯笼微动；要求人物、山水和房屋保持原帧静止，动态层独立可控。没有稳定遮罩或会造成画面重绘时，记录为不支持并继续用静帧/慢推。
  - 验收：样例中只有一种环境元素低幅移动；静态区域无闪烁、变形或边缘穿帮。此项不阻塞首版样片。

### D. 角色圣经和图解插页

- [ ] **CS-11｜建立可版本化的角色圣经数据结构** `P0`
  - 依赖：无
  - 涉及：`assets/characters/` 目录约定和角色档案文档。
  - 实施：定义每个角色的稳定 ID、身份/地域/时代、脸型/轮廓/发式/体态/服饰/道具锚点、年龄/时期变体、史料来源、美术推断，以及各画风参考图的版本和 `candidate`/`approved` 状态。当前角色身份与每个画风的参考图分层保存。
  - 验收：不看对话也能判断哪些内容有史料依据、哪些是美术选择；旧版参考图可保留并追溯；未经人工批准的 candidate 不标为正式资产。

- [ ] **CS-12｜为李世民建档并让场景提示复用角色锚点** `P1`
  - 依赖：CS-02、CS-11
  - 涉及：`assets/characters/li_shimin/`、`packages/draft/src/schemas.ts`、`packages/draft/src/image-prompt.ts`、`packages/prompts/prompts/draft-image-prompt.md`、`projects/玄武门/article.md`。
  - 实施：添加 `li_shimin` 身份档案及“青年秦王”“后期皇帝”两个外观变体；在涉及李世民的场景标注角色 ID 与变体。图像提示从档案加入适用的文字锚点；不假设图像模型接收参考图条件。李渊等单集角色不进入共享角色库。
  - 验收：青年/后期形象服饰可不同但共享身份锚点；提示能区分变体；人物轮廓、脸型、发式、体态、服饰和标志道具的漂移可在联系表中发现。

- [ ] **CS-13｜建立角色参考候选与批准流程** `P1`
  - 依赖：CS-11、CS-12
  - 涉及：角色档案目录、候选图与审核记录。
  - 实施：为每个需跨场景/跨片复用的角色制作工笔候选参考图和联系表；人工核对锚点并明确批准后，才写入该画风正式版本。保留旧版本；路人不进入档案。
  - 验收：候选与正式版本目录/状态可区分；批准记录可追溯；明显锚点漂移的候选不能升级为正式参考。

- [ ] **CS-14｜实现单幅、全屏的地图图解插页** `P1`
  - 依赖：CS-02
  - 涉及：VDSL visual schema/registry、`packages/video-components/`、`packages/draft/src/visual-classifier.ts`、scene-08 及地图资料记录。
  - 实施：新增结构化全屏 `MapInsert`（或等价组件），用可审核的坐标/路径数据绘制简化山河、路线和标记点，采用淡彩工笔线色；禁止可读地名、比例尺和细碎地形。为四大战役的主要位置和行军方向记录核验来源，城市名由旁白讲述。频道 profile 启用时，每片最多允许一个图解插页；该地图不得拆成多格。
  - 验收：scene-08 是本片唯一图解插页；profile 对第二个图解插页给出验证错误；主要方向经史料/可靠地图核对；画面无模型生成文字；主题与工笔叙事画相容。

### E. 声音与首支样片

- [ ] **CS-15｜锁定首支样片的 Voicebox 音色与声音底色** `P1`
  - 依赖：无
  - 涉及：`projects/玄武门/article.md`、`projects/玄武门/audio-config.yaml`、现有 `packages/tts/src/voicebox.ts` 和 BGM 资产索引。
  - 实施：从 Voicebox 可用 profile 中为首支样片选定一个讲述者音色，并记录 profile；沿用现有 Voicebox→项目支持的回退链路。选择一条低存在感、无明显节拍的持续配乐；只为叙事需要添加少量环境声。
  - 验收：全部旁白使用同一 Voicebox profile；Voicebox 不可用时日志清楚说明实际回退音色；配乐不盖过旁白、不驱动切镜。

- [ ] **CS-16｜重生成并审核《玄武门》工笔静帧集** `P1`
  - 依赖：CS-04、CS-05、CS-06、CS-07、CS-12、CS-13、CS-14
  - 涉及：`projects/玄武门/article.md`、生成的 `storyboard/`、`assets/images/`、`checkpoints/visuals.yaml`。
  - 实施：启用现有视觉审核门；用 `video visuals 玄武门` 生成画面和联系表。逐镜检查单焦点、全幅单场景、淡彩工笔、年代服饰、字幕留白；拒绝不符合的图并重新生成。批准后冻结静帧集，再进入运动和声音合成。
  - 验收：所有批准镜头保持工笔统一；无多格/拼贴/角标；李世民关键锚点稳定；scene-08 地图通过来源和方向审核；未批准图不能进入最终渲染。

- [ ] **CS-17｜完成样片运动、声音和成片验收** `P1`
  - 依赖：CS-08、CS-09、CS-13、CS-15、CS-16
  - 涉及：《玄武门》motion 文件、`audio-config.yaml`、输出视频与 QA/人工评审记录。
  - 实施：按静止优先原则生成运动计划；首先比较静止和 1–2% 慢推效果，环境微动仅在 CS-10 通过后使用。用 Voicebox、配乐、字幕生成预览和成片；按设计稿六项验收标准记录通过/返工镜头。
  - 验收：成片时长 3–8 分钟；没有画种切换、动画堆叠或角标；完整旁白字幕同步且每屏最多两行；旁白清晰且留白充分；所有返工项关闭后保存样片评审记录。

## 依赖顺序

| 任务 | 前置任务 |
| --- | --- |
| CS-01 | — |
| CS-02、CS-03 | CS-01 |
| CS-04 | CS-01、CS-02 |
| CS-05 | CS-01、CS-02 |
| CS-06 | CS-05 |
| CS-07、CS-08、CS-09 | CS-01 |
| CS-10 | CS-09（可选，不阻塞样片） |
| CS-11、CS-15 | — |
| CS-12 | CS-02、CS-11 |
| CS-13 | CS-11、CS-12 |
| CS-14 | CS-02 |
| CS-16 | CS-04、CS-05、CS-06、CS-07、CS-12、CS-13、CS-14 |
| CS-17 | CS-08、CS-09、CS-13、CS-15、CS-16 |

建议实现顺序：CS-01 → CS-02/03/04 → CS-05/07/09/11/14 → CS-06/08/12/15 → CS-13/16 → CS-17。CS-10 是可选探索，不阻塞静帧与慢推路径。

## 首版暂不纳入

- 把所有既有项目迁移到 `chinese-storybook`。
- 不同画种在同一条视频中混用，或一次完成所有画种预设。
- 让图像模型直接接收角色参考图；当前能力不支持。
- 未经验证的自动分层、自动抠图或复杂粒子雨雪系统。
- 频道名称/标志设计及片尾品牌签名；品牌身份确认后再另立任务。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 新 profile 横跨 draft、VDSL、motion 和 renderer | 配置丢失会造成同片视觉规则不一致 | 以 article 为源，逐层检查配置传递；老项目缺省路径保持原样 |
| 模型无法稳定生成工笔线稿、面部与历史服饰 | 静帧返工增加、角色漂移 | 锁定提示词与配色；生成后先人工审核静帧；核心锚点漂移就重生 |
| 完整旁白较长，难塞入两行字幕 | 字幕遮挡或阅读速度过快 | 按标点拆 cue、限制每 cue 两行，并按实际场景音频时长分配显示区间 |
| TTS 没有词级时间戳 | 字幕只能做到句/短语级近似同步 | 以实测单场景音频总时长按文字长度分配 cue；样片人工校准，不宣称词级同步 |
| Motion Agent 的 `camera` 与 VDSL 类型表不一致 | 计划中的慢推动作若直接使用 camera timeline 会验证失败 | 首版把慢推映射为 `ImageBackground.kenBurnsScale`；只有将来有明确需求才统一添加 camera animation 类型 |
| 单张合成图不能局部动 | 雨丝/灯笼动效可能造成整图变形 | 静止和慢推作为稳定交付；环境微动必须先通过遮罩样例验证 |
| 生成式地图地理关系不可靠 | 战役路线误导观众 | 使用可审核的矢量路径/标记数据；先核来源再进入渲染 |

## 实施完成后更新

样片通过后，把实测有效的色值、字幕可读性、Voicebox profile、画面返工原因和运动参数回写至风格设计及 `CONTEXT.md`。只有首支样片通过人工评审，才将 `chinese-storybook` 作为后续项目的推荐 profile。
