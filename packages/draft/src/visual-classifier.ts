/**
 * v0.4 — Visual-variety classifier.
 *
 * Picks a VDSL component for a scene based on keyword clusters in the
 * article's `visual:` field. Deterministic (regex, no LLM) so it stays
 * free, fast, and identical across retries.
 *
 * Mapping (zh-CN + en-US keywords):
 *   quote / 引用 / 引文 / 名言                    → QuoteBlock
 *   cycle / loop / 循环 / 闭环 / 迭代 / 飞轮      → CycleDiagram
 *   rank / leaderboard / top-N / 排名 / 榜单      → Leaderboard
 *   chart / distribution / 柱状图 / 分布 / 构成    → BarChart
 *   percent / % / statistics / 增长 / 百分比      → StatGrid
 *   checklist / 清单 / 注意事项 / 避坑            → Checklist
 *   pyramid / hierarchy / 金字塔 / 层级           → PyramidDiagram
 *   venn / overlap / 交集 / 重叠                  → VennDiagram
 *   key insight / takeaway / 核心观点 / 一句话    → BigIdea
 *   database / 表 / schema / 存储 / sql / query   → Callout
 *   network / 网络 / flow / pipeline / 流水线     → SvgScene  (draw-on diagram)
 *   compare / 对比 / versus / vs / 差异            → Comparison
 *   code / terminal / 代码 / console / command      → Terminal
 *   timeline / 年表 / 历史 / 年代 / chronology     → Timeline
 *   formula / 公式 / equation / math               → Callout
 *   process / step / 步骤                            → SvgScene
 *   list / 列表 / bullet / 要点 / list of           → Checklist
 *   first scene                                    → Title
 *   fall-through                                   → AnimatedIllustration
 *
 * DoodleScene is never auto-selected (user request 2026-10-03: the canvas
 * family looked useless in output) but stays registered — explicit
 * `component: DoodleScene` in a hand-edited storyboard still renders.
 *
 * Every returned component name MUST be in the video-components REGISTRY —
 * the Callout `kind` prop only accepts info|warning|success and is derived
 * by the visual builder, never hinted here.
 *
 * The classifier returns the component name and the prop-key set to
 * emit. Props are minimal — components accept arbitrary props and
 * render their known fields.
 */

export type ComponentName =
  | "Title"
  | "AnimatedIllustration"
  | "Callout"
  | "FlowChart"
  | "Comparison"
  | "Terminal"
  | "Timeline"
  | "SvgScene"
  | "DoodleScene"
  | "QuoteBlock"
  | "StatGrid"
  | "BarChart"
  | "Leaderboard"
  | "Checklist"
  | "BigIdea"
  | "PyramidDiagram"
  | "VennDiagram"
  | "CycleDiagram";

export interface ComponentChoice {
  component: ComponentName;
}

interface ClusterRule {
  component: ComponentName;
  patterns: RegExp[];
}

const RULES: ClusterRule[] = [
  {
    component: "QuoteBlock",
    patterns: [
      /\b(quote|quoted|cited|excerpt|excerpts|attributed|says|said|remark|remarks|statement)\b/i,
      /(引用|引文|引语|原话|说过|指出|强调|名言|金句|名言警句)/,
    ],
  },
  {
    component: "CycleDiagram",
    patterns: [
      /\b(cycle|cycles|circular|loop|loops|feedback loop|iterat\w*|ooda|pdca|flywheel|vicious|virtuous)\b/i,
      /(循环|闭环|迭代|飞轮|轮转|反馈环|周期)/,
    ],
  },
  {
    component: "Leaderboard",
    patterns: [
      /\b(rank|ranking|ranked|rankings|leaderboard|top[- ]?\d+|winner|champion)\b/i,
      /(排名|榜单|排行榜|榜首|冠军|亚军|季军|前十|前五|前三)/,
    ],
  },
  {
    component: "BarChart",
    patterns: [
      /\b(bar ?chart|chart|charts|graph|graphs|distribution|breakdown|proportion|proportions|segment|segments)\b/i,
      /(柱状图|条形图|饼图|分布|构成|占比分布|份额)/,
    ],
  },
  {
    component: "StatGrid",
    patterns: [
      /%|％/,
      /\b(stat|stats|statistic|statistics|percentage|percent|metric|metrics|kpi|kpis|growth|increase|decrease|million|billion|trillion)\b/i,
      /(统计|百分比|百分点|增长率|增长|下降|占比|比例|倍数|关键数字)/,
    ],
  },
  {
    component: "Checklist",
    patterns: [
      /\b(checklist|check ?list|to-?dos?|dos and don'?ts|best practices|pitfalls)\b/i,
      /\b(list|listing|bullet|bullets|points|tips|examples|kinds|items|agenda)\b/i,
      /(清单|核对|检查表|待办|注意事项|避坑|防坑|秘籍)/,
      /(列表|要点|条目|示例|提纲)/,
    ],
  },
  {
    component: "PyramidDiagram",
    patterns: [
      /\b(pyramid|pyramids|hierarchy|hierarchical|layer|layers|tier|tiers|stack|stacked)\b/i,
      /(金字塔|层级|层次|分层|三层|四层|五层)/,
    ],
  },
  {
    component: "VennDiagram",
    patterns: [
      /\b(venn|overlap|overlapping|intersect\w*|middle ground|sweet spot)\b/i,
      /(维恩|交集|重叠|交叉|融合|兼得)/,
    ],
  },
  {
    component: "BigIdea",
    patterns: [
      /\b(key insight|key takeaways?|takeaway|main point|core idea|in one sentence|one sentence|bottom line|punchline|remember this)\b/i,
      /(核心观点|核心思想|一句话|记住|重点是|要点是|说白了|本质上|总结)/,
    ],
  },
  {
    component: "SvgScene",
    patterns: [
      /\b(network|networks|flow|flows|pipeline|pipelines|pipe|step|steps|process|workflow|workflows|diagram|flowchart|node|nodes|edge|edges)/i,
      /(网络|流水线|流程|步骤|节点|连线|拓扑|链路)/,
    ],
  },
  {
    component: "Comparison",
    patterns: [
      /\b(compare|comparison|versus|vs\.?|difference|differences|trade[- ]off|pros and cons|before and after)/i,
      /(对比|比较|差异|区别|不同|相比|权衡|优缺点|前后)/,
    ],
  },
  {
    component: "Terminal",
    patterns: [
      /\b(code|coding|terminal|console|command|commands|script|snippet|cli|shell|bash|prompt|json|yaml)/i,
      /(代码|终端|控制台|命令行|脚本|片段|命令|提示)/,
    ],
  },
  {
    component: "Timeline",
    patterns: [
      /\b(timeline|history|chronology|chronological|year|years|decade|decades|century|centuries|era|eras|milestone|milestones)/i,
      /(时间线|年表|历史|年代|世纪|里程碑|历年|沿革)/,
    ],
  },
  {
    component: "Callout",
    patterns: [
      /\b(formula|equation|math|mathematics|expression|expressions|derive|derivation)/i,
      /(公式|方程|数学|推导|表达式)/,
    ],
  },
  {
    component: "Callout",
    patterns: [
      /\b(database|databases|sql|query|queries|schema|table|tables|columnstore|attribute)/i,
      /(数据库|表格|字段|列存|列式|sql|查询)/,
    ],
  },
];

const DEFAULT_COMPONENT: ComponentName = "AnimatedIllustration";

/** Pick a VDSL component for one scene.
 *
 *  @param visual    The article's `visual:` direction text.
 *  @param isFirst   Whether this is the first scene (always Title).
 */
export function pickVisualComponent(
  visual: string,
  isFirst: boolean,
): ComponentChoice {
  if (isFirst) {
    return { component: "Title" };
  }
  const text = visual ?? "";
  for (const rule of RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(text)) {
        return { component: rule.component };
      }
    }
  }
  return { component: DEFAULT_COMPONENT };
}