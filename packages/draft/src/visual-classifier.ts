/**
 * v0.4 — Visual-variety classifier.
 *
 * Picks a VDSL component for a scene based on keyword clusters in the
 * article's `visual:` field. Deterministic (regex, no LLM) so it stays
 * free, fast, and identical across retries.
 *
 * Mapping (zh-CN + en-US keywords):
 *   database / 表 / schema / 存储 / sql / query   → Callout
 *   network / 网络 / flow / pipeline / 流水线     → FlowChart
 *   compare / 对比 / versus / vs / 差异            → Comparison
 *   code / terminal / 代码 / console / command      → Terminal
 *   timeline / 年表 / 历史 / 年代 / chronology     → Timeline
 *   formula / 公式 / equation / math               → Callout
 *   process / step / 步骤                            → FlowChart
 *   list / 列表 / bullet / 要点 / list of           → AnimatedIllustration
 *   quote / 引用 / 引文 / "..."                    → Callout
 *   first scene                                    → Title
 *   fall-through                                   → AnimatedIllustration
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
  | "Timeline";

export interface ComponentChoice {
  component: ComponentName;
}

interface ClusterRule {
  component: ComponentName;
  patterns: RegExp[];
}

const RULES: ClusterRule[] = [
  {
    component: "FlowChart",
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
  {
    component: "AnimatedIllustration",
    patterns: [
      /\b(list|listing|bullet|bullets|points|tips|examples|kinds|items|agenda)/i,
      /(列表|清单|要点|条目|示例|提纲)/,
    ],
  },
  {
    component: "Callout",
    patterns: [
      /\b(quote|quoted|cited|excerpt|excerpts|attributed|says|said|remark|remarks|statement)/i,
      /(引用|引文|引语|原话|说过|指出|强调)/,
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