# 角色圣经 (Character Bible)

跨片复用的角色身份档案。身份与画风分层保存：同一份身份可以在不同画风下复用，每种画风各自维护带版本的参考图。

Schema：`character-profile/1`，定义与校验在 `packages/draft/src/character-profile.ts`。

## 目录约定

```
assets/characters/
  README.md                          # 本文件
  <character_id>/
    character.yaml                   # 身份档案（唯一入口）
    refs/
      <style>/                       # 每种画风一个目录，如 gongbi
        v1.jpg                       # 参考图，文件名带版本，永不覆盖
        v2.jpg
```

`character_id` 是稳定 id（如 `li_shimin`），场景与提示词引用它，不引用目录位置。

## character.yaml

```yaml
schema: character-profile/1
id: li_shimin
name: 李世民
identity:
  era_region: Tang-dynasty China, 626-630 CE
  role: 秦王 / 唐太宗

# 身份锚点：提示词必须复现这些特征，同一个人才认得出
anchors:
  face_shape:
    value: 圆润下颌，颧骨柔和
    basis: inferred          # sourced | inferred
    note: 工笔传统中的帝王面相，无具体史料记载
  silhouette:
    value: 肩背舒展，站姿稳定
    basis: inferred
  hair:
    value: 高髻束发，簪小
    basis: sourced
    source: 《旧唐书·太宗本纪》载其"少有才略"…

# 年龄/时期变体：只覆盖与身份不同的部分
variants:
  - id: li_shimin__young_prince
    label: 青年秦王
    period: 618-626 CE
    anchors:
      costume:
        value: 暗色圆领袍，少饰品
        basis: inferred
  - id: li_shimin__emperor
    label: 后期皇帝
    period: 627-649 CE
    anchors:
      costume:
        value: 赭黄常服，圆领施襕
        basis: inferred

# 每个画风的参考图，带版本与审核状态
references:
  - style: gongbi
    version: v1
    status: candidate          # candidate | approved | superseded
    file: refs/gongbi/v1.jpg
```

## 三条硬规则

1. **`basis` 必填。** `sourced` 必须写 `source`；写不出来就填 `inferred` + `note`。
   这是验收条件「不看对话也能判断哪些有史料依据、哪些是美术选择」的落地方式——判据是字段，不是散文。
2. **参考图按版本累积，永不覆盖。** 换图 = 加 `v2`。旧的标 `superseded` 留在磁盘上可追溯。
   批准新的一张时，同画风的其余版本（无论原状态）一并标 `superseded`——只留一张正式图，
   其余留在盘上备查。
3. **只有 `approved` 算正式资产。** `approved` 必须有 `reviewedBy` + `reviewedAt`；
   一种画风最多一个 `approved`，多了必须把旧的标 `superseded`。
   下游只能用 `approvedReferenceFor()` 取参考图——candidate 永远不会被误当成正式图。

## 审核流程

```bash
# 1) 出候选图（不会覆盖旧版本，自动取下一个版本号）
video character sheet li_shimin gongbi --variant li_shimin__young_prince

# 2) 人工核对锚点：脸型、发式、体态、服饰、标志道具是否与档案一致
#    （候选图若出现题字/印章/落款，直接重出，不要批准）

# 3) 批准：记录审核人与时间，旧版本自动降级为 superseded
video character approve li_shimin gongbi v4 --by <审核人>

# 查看现状
video character list
```

`video character approve` 会拒绝三件事：没有 `--by` 审核人、图片文件不存在的版本、
以及重复批准已经是 approved 的版本。

## 校验

`packages/draft/src/character-profile.ts` 在加载时强制上述三条，违反即抛错：

- `basis: sourced` 缺 `source`
- `approved` 缺 `reviewedBy` / `reviewedAt`
- 同一画风出现两个 `approved`
- 重复的 variant id

```ts
import { loadCharacterProfile, anchorPromptLines } from "@video/draft";

const profile = loadCharacterProfile("assets/characters/li_shimin/character.yaml");
const lines = anchorPromptLines(profile, "li_shimin__young_prince");
```

## 不做什么

- **不作为图像模型的参考图输入。** MiniMax `image-01` 没有 `subject_reference` 字段，
  无法接收参考图条件。一致性靠**文字锚点**维持——这是能力限制，不是待补的功能。
- **路人不建档。** 只有跨场景/跨片复用的角色进这里。
- **单集专属角色不进共享库。** （如《玄武门》之外的配角）留在该片的 article 里。