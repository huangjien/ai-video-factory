import type { ExperimentRanking } from "./backlog-judge-experiment.js";

const statusLabels: Record<string, string> = {
  shortlist: "优先候选",
  revise: "待改题",
  duplicate: "疑似重复",
  verify: "核对重复",
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderExperimentReport(
  ranking: ExperimentRanking,
  models: { gemini: string; openai: string },
  created: string,
): string {
  const rows = ranking
    .map((row) => {
      const label = row.stable ? "稳定前五" : statusLabels[row.status];
      const details = [row.google, row.openai]
        .map(
          (rating, index) =>
            `<p>${index === 0 ? "Gemini" : "OpenAI"} · 点开 ${rating.click.toFixed(2)} · 看下去 ${rating.retention.toFixed(2)} · 收获 ${rating.payoff.toFixed(2)} · 重复 ${(100 * rating.duplicate).toFixed(1)}%</p>`,
        )
        .join("");
      const ranks = row.ranks
        .map(({ rank }) => `<td>${rank ?? "—"}</td>`)
        .join("");
      return `<tr class="${row.stable ? "stable" : row.status}"><th scope="row"><details><summary>${escapeHtml(row.title)}</summary>${details}</details></th><td>${row.score.toFixed(3)}</td>${ranks}<td>${label}</td></tr>`;
    })
    .join("\n");
  const stableCount = ranking.filter((row) => row.stable).length;
  const shortlistCount = ranking.filter(
    (row) => row.status === "shortlist",
  ).length;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>视频选题加权实验</title>
<style>
:root{font:16px/1.6 system-ui,sans-serif;background:#f4f6ef;color:#1e2c25}
main{max-width:72rem;margin:auto;padding:clamp(.75rem,4vw,3rem)}
h1{font-size:clamp(1.85rem,5vw,3rem);margin:0} select{font:inherit}
.scroll{overflow:auto;margin-top:.6rem}table{width:100%;min-width:43rem;border-collapse:collapse;background:white}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid #dce5da;vertical-align:top}
thead{background:#285144;color:white}tbody th{font-weight:550;width:48%}
td{font-variant-numeric:tabular-nums}summary{cursor:pointer}.stable{background:#e1eee1}
</style></head><body><main>
<h1>视频选题加权实验</h1>
<p>${ranking.length} 条选题 · ${shortlistCount} 条优先候选 · ${stableCount} 条稳定前五</p>
<p>${escapeHtml(models.gemini)} 和 ${escapeHtml(models.openai)} · ${escapeHtml(created)}</p>
<p>单项取两家均分。主榜按点开 40%、看下去 30%、收获 30% 加权，满分 6 分。比较等权和收获占 40% 的排名，三套权重均进前五即标为稳定前五。优先候选须各项至少 1 分且两家重复概率均低于 80%。</p>
<label>显示范围 <select id="scope"><option value="stable">稳定前五</option><option value="shortlist">全部优先候选</option><option value="all">全部选题</option></select></label>
<div class="scroll"><table><thead><tr><th scope="col">选题</th><th scope="col">加权分</th><th scope="col">等权名次</th><th scope="col">主榜名次</th><th scope="col">收获优先名次</th><th scope="col">状态</th></tr></thead><tbody>${rows}</tbody></table></div>
<script>
const scope = document.querySelector('#scope');
const rows = [...document.querySelectorAll('tbody tr')];
function filter() {
  for (const row of rows) {
    row.hidden = scope.value !== 'all' && row.className !== 'stable'
      && row.className !== scope.value;
  }
}
scope.addEventListener('change', filter);
filter();
</script></main></body></html>`;
}
