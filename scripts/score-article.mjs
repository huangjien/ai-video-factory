/**
 * Score the CURRENT article.md with the repo's own article judge.
 *
 * Same function the draft loop calls (packages/draft/src/article-review.ts
 * → scoreArticle), same cross-model split: the draft was written by GLM,
 * so the judge must be a different provider family (minimax).
 *
 * Usage: node scripts/score-article.mjs <project-dir>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("usage: node scripts/score-article.mjs <project-dir>");
  process.exit(2);
}

const repo = path.resolve(import.meta.dirname, "..");
const draft = await import(
  pathToFileURL(path.join(repo, "packages/draft/dist/index.js")).href
);
const llm = await import(
  pathToFileURL(path.join(repo, "packages/llm/dist/index.js")).href
);

const articleMd = readFileSync(
  path.join(projectDir, "article.md"),
  "utf8",
);

// The task spec the draft loop passes (packages/cli/src/draft-command.ts).
const task = {
  topic: "先定好什么算好，再放开怎么做",
  audience: "软件开发者与技术管理者",
  language: "zh-CN",
  durationSec: 330,
};

// The judge is flaky on a long article (it sometimes answers without the
// JSON object the schema needs). Retry rather than losing the run.
let score;
for (let attempt = 1; ; attempt++) {
  try {
    score = await draft.scoreArticle(
      articleMd,
      new llm.GLMProvider(),
      new llm.MiniMaxProvider(),
      undefined,
      task,
    );
    break;
  } catch (err) {
    console.error(`judge attempt ${attempt} failed: ${err.message}`);
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}

console.log(`overall   ${score.computed.overall_score}/100  grade ${score.computed.grade}`);
console.log(`coverage  ${score.computed.coverage}%`);
console.log(`passing   ${score.passing}`);
console.log("");
for (const d of score.computed.dimension_scores) {
  const bar = "#".repeat(Math.round(d.weighted_score));
  console.log(
    `  ${d.id} ${d.name.padEnd(28)} ${String(d.indicator_mean).padEnd(5)} → ${d.weighted_score.toFixed(1)}/${d.weight}  ${bar}`,
  );
}
console.log("");
console.log(`comment: ${score.raw.comment ?? ""}`);
console.log("");
for (const f of score.raw.findings ?? []) {
  console.log(
    `  [${f.severity}] ${f.code} (${f.dimension_ids.join(",")}) ${f.verification_status ?? ""}`,
  );
  console.log(`     ${f.description}`);
  if (f.recommendation) console.log(`     → ${f.recommendation}`);
}
if (score.raw.risk_flags?.length) {
  console.log("");
  console.log("risk flags:");
  for (const r of score.raw.risk_flags) {
    console.log(`  ${r.code} (${r.severity}) findings=${r.finding_ids.join(",")}`);
  }
}
if (score.raw.limitations?.length) {
  console.log("");
  console.log("limitations:");
  for (const l of score.raw.limitations) {
    console.log(`  ${l.code}: ${l.description}`);
  }
}
