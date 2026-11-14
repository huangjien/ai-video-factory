/**
 * Report every visual-classifier trigger word inside each scene's `visual:` line.
 * Usage: NODE_PATH=... node scripts/visual-trigger-scan.mjs <article.md>
 */
import { readFileSync } from "node:fs";
import YAML from "yaml";

const RULES = [
  ["QuoteBlock", /\b(quote|quoted|cited|excerpt|excerpts|attributed|says|said|remark|remarks|statement)\b/i],
  ["QuoteBlock", /(引用|引文|引语|原话|说过|指出|强调|名言|金句|名言警句)/],
  ["CycleDiagram", /\b(cycle|cycles|circular|loop|loops|feedback loop|iterat\w*|ooda|pdca|flywheel|vicious|virtuous)\b/i],
  ["CycleDiagram", /(循环|闭环|迭代|飞轮|轮转|反馈环|周期)/],
  ["Leaderboard", /\b(rank|ranking|ranked|rankings|leaderboard|top[- ]?\d+|winner|champion)\b/i],
  ["Leaderboard", /(排名|榜单|排行榜|榜首|冠军|亚军|季军|前十|前五|前三)/],
  ["BarChart", /\b(bar ?chart|chart|charts|graph|graphs|distribution|breakdown|proportion|proportions|segment|segments)\b/i],
  ["BarChart", /(柱状图|条形图|饼图|分布|构成|占比分布|份额)/],
  ["StatGrid", /%|％/],
  ["StatGrid", /\b(stat|stats|statistic|statistics|percentage|percent|metric|metrics|kpi|kpis|growth|increase|decrease|million|billion|trillion)\b/i],
  ["StatGrid", /(统计|百分比|百分点|增长率|增长|下降|占比|比例|倍数|关键数字)/],
  ["Checklist", /\b(checklist|check ?list|to-?dos?|dos and don'?ts|best practices|pitfalls)\b/i],
  ["Checklist", /\b(list|listing|bullet|bullets|points|tips|examples|kinds|items|agenda)\b/i],
  ["Checklist", /(清单|核对|检查表|待办|注意事项|避坑|防坑|秘籍)/],
  ["Checklist", /(列表|要点|条目|示例|提纲)/],
  ["PyramidDiagram", /\b(pyramid|pyramids|hierarchy|hierarchical|layer|layers|tier|tiers|stack|stacked)\b/i],
  ["PyramidDiagram", /(金字塔|层级|层次|分层|三层|四层|五层)/],
  ["VennDiagram", /\b(venn|overlap|overlapping|intersect\w*|middle ground|sweet spot)\b/i],
  ["VennDiagram", /(维恩|交集|重叠|交叉|融合|兼得)/],
  ["BigIdea", /\b(key insight|key takeaways?|takeaway|main point|core idea|in one sentence|one sentence|bottom line|punchline|remember this)\b/i],
  ["BigIdea", /(核心观点|核心思想|一句话|记住|重点是|要点是|说白了|本质上|总结)/],
  ["FlowChart", /\b(network|networks|flow|flows|pipeline|pipelines|pipe|step|steps|process|workflow|workflows|diagram|flowchart|node|nodes|edge|edges)\b/i],
  ["FlowChart", /(网络|流水线|流程|步骤|节点|连线|拓扑|链路)/],
  ["Terminal", /\b(code|coding|terminal|console|command|commands|script|snippet|cli|shell|bash|prompt|json|yaml)\b/i],
  ["Terminal", /(代码|终端|控制台|命令行|脚本|片段|命令|提示)/],
  ["Timeline", /\b(timeline|history|chronology|chronological|year|years|decade|decades|century|centuries|era|eras|milestone|milestones)\b/i],
  ["Timeline", /(时间线|年表|历史|年代|世纪|里程碑|历年|沿革)/],
  ["Callout", /\b(formula|equation|math|mathematics|expression|expressions|derive|derivation)\b/i],
  ["Callout", /(公式|方程|数学|推导|表达式)/],
  ["Callout", /\b(database|databases|sql|query|queries|schema|table|tables|columnstore|attribute)\b/i],
  ["Callout", /(数据库|表格|字段|列存|列式|sql|查询)/],
  ["MapInsert", /\b(map|maps|route|routes|campaign-map|march)\b/i],
  ["MapInsert", /(地图|路线图|行军图|战役图)/],
];

const md = readFileSync(process.argv[2], "utf8");
const block = md.match(/```yaml\n([\s\S]*?)\n```/);
const scenes = YAML.parse(block[1]).scenes;

let bad = 0;
scenes.forEach((s, i) => {
  const text = s.visual ?? "";
  const hits = [];
  for (const [component, pat] of RULES) {
    const m = text.match(pat);
    if (m) hits.push(`${component}:«${m[0]}»`);
  }
  const fatal = i > 0 && hits.length > 0;
  if (fatal) bad += 1;
  console.log(
    `scene_${i + 1}${fatal ? "  <<< EATS IMAGE" : ""}\n  ${text}\n  HITS: ${hits.length ? hits.join("  ") : "(none)"}\n`,
  );
});
console.log(`scenes=${scenes.length} image_eating=${bad}`);
