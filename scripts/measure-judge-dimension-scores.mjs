#!/usr/bin/env node
/**
 * Measure the article judge's per-dimension score against the
 * Decisions API (v0.12 P6).
 *
 * The article judge scores 8 dimensions × 3 indicators on a 0–5 scale
 * and weights them into an overall score. The judge is a chat model
 * asked for JSON — its dimension scores carry no confidence, and the
 * pipeline already knows the judge is noisy (±2.5 points on the overall
 * score, measured on one draft).
 *
 * The question this script answers: **would a `score` decision per
 * dimension be a better signal than the judge's own dimension
 * numbers?** The decision sees the same article and the same rubric
 * (the dimension block is read straight out of the judge's prompt), and
 * answers with a probability-weighted score plus a confidence.
 *
 * It is a MEASUREMENT, not a surface: nothing here ships in the
 * pipeline. The result decides whether P6 becomes code.
 *
 *   node scripts/measure-judge-dimension-scores.mjs [--articles 8]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectsDir = path.join(repoRoot, "projects");
const promptFile = path.join(
  repoRoot,
  "packages",
  "prompts",
  "prompts",
  "draft-article-review.md",
);

const args = process.argv.slice(2);
const articlesArg = args.indexOf("--articles");
const ARTICLE_LIMIT = articlesArg >= 0 ? Number(args[articlesArg + 1]) : 8;

const API_KEY = process.env["OPENAI_API_KEY"];
const BASE_URL = (
  process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"
).replace(/\/+$/, "");
const MODEL = process.env["DECISION_MODEL"] ?? "gpt-6-luna";

if (!API_KEY) {
  console.error("OPENAI_API_KEY is not set — nothing to measure.");
  process.exit(1);
}

/** The dimension blocks, read out of the judge's own prompt. */
function dimensionBlocks() {
  const text = readFileSync(promptFile, "utf8");
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^## ([A-H])\. (.+?) — weight (\d+)/.exec(lines[i] ?? "");
    if (!heading) continue;
    const indicators = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      if (line.startsWith("## ")) break;
      const indicator = /^\s{2}([A-H]\d)\. (.+?)\s*\((\d+)\)/.exec(line);
      if (indicator) {
        indicators.push({
          id: indicator[1],
          text: indicator[2],
          weight: Number(indicator[3]),
        });
      }
    }
    out.push({ id: heading[1], name: heading[2], indicators });
  }
  return out;
}

const dimensions = dimensionBlocks();

/** The article the judge read: its frontmatter (the commission) and body. */
function articleState(articleFile) {
  const text = readFileSync(articleFile, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return text;
  return `The commissioned task:\n${match[1]}\n\nThe article:\n${match[2]}`;
}

/** Ask the Decisions API for one dimension's score. */
async function scoreDimension(state, dimension) {
  const instructions = [
    `Rate the article on the "${dimension.name}" dimension (${dimension.id}), from 0 to 5.`,
    "0 is the worst possible result on this dimension and 5 is the best.",
    "The indicators are:",
    ...dimension.indicators.map(
      (i) => `- ${i.id}. ${i.text} (weight ${i.weight})`,
    ),
    "Answer with the level the article earns on this dimension.",
  ].join("\n");
  const res = await fetch(`${BASE_URL}/decisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: state,
      questions: [
        {
          name: `dimension-${dimension.id}`,
          type: "score",
          instructions,
          levels: [0, 1, 2, 3, 4, 5].map((n) => ({ label: String(n) })),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  const parsed = await res.json();
  const answer = parsed.answers?.[0];
  return {
    score: typeof answer?.score === "number" ? answer.score : null,
    confidence:
      typeof answer?.confidence === "number" ? answer.confidence : null,
    usage: parsed.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

const projects = readdirSync(projectsDir)
  .filter((p) => existsSync(path.join(projectsDir, p, "article-review.yaml")))
  .filter((p) => existsSync(path.join(projectsDir, p, "article.md")))
  .sort();
// Spread the sample across the list so it is not one project's worth of
// articles.
const step = Math.max(1, Math.floor(projects.length / ARTICLE_LIMIT));
const sampled = [];
for (
  let i = 0;
  sampled.length < ARTICLE_LIMIT && i < projects.length;
  i += step
) {
  sampled.push(projects[i]);
}

const rows = [];
let tokensIn = 0;
for (const project of sampled) {
  const reviewFile = path.join(projectsDir, project, "article-review.yaml");
  const review = parseYaml(readFileSync(reviewFile, "utf8"));
  const attempts = review?.attempts ?? [];
  const attempt = attempts[attempts.length - 1];
  if (!attempt?.dimensions) continue;
  const state = articleState(path.join(projectsDir, project, "article.md"));
  for (const dimension of dimensions) {
    const judged = attempt.dimensions.find((d) => d.id === dimension.id);
    if (!judged) continue;
    try {
      const answer = await scoreDimension(state, dimension);
      tokensIn += answer.usage.input_tokens ?? 0;
      rows.push({
        project,
        dimension: dimension.id,
        name: dimension.name,
        judged: judged.indicator_mean,
        decision: answer.score,
        confidence: answer.confidence,
      });
    } catch (err) {
      console.error(`  ! ${project} ${dimension.id}: ${err.message}`);
    }
  }
}

const scored = rows.filter((r) => r.decision !== null);
const errors = scored.map((r) => Math.abs(r.judged - r.decision));
const meanError =
  errors.length === 0
    ? null
    : errors.reduce((a, b) => a + b, 0) / errors.length;
const withinOne = errors.filter((e) => e <= 1).length;
const meanJudged =
  scored.length === 0
    ? null
    : scored.reduce((a, r) => a + r.judged, 0) / scored.length;
const meanDecision =
  scored.length === 0
    ? null
    : scored.reduce((a, r) => a + r.decision, 0) / scored.length;

console.log(
  `articles sampled: ${sampled.length} · dimension scores: ${scored.length}`,
);
console.log(
  `judge mean ${meanJudged?.toFixed(2)} · decision mean ${meanDecision?.toFixed(2)}`,
);
console.log(
  `mean |judge − decision| ${meanError?.toFixed(3)} · within 1 point: ${withinOne}/${scored.length}`,
);
console.log(
  `decision input tokens: ${tokensIn} · cost at $0.10/M: $${((tokensIn / 1_000_000) * 0.1).toFixed(4)}`,
);
const outFile = path.join(repoRoot, "runs", "judge-dimension-scores.json");
writeFileSync(
  outFile,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), model: MODEL, rows },
    null,
    2,
  ),
  "utf8",
);
console.log(`report written: ${path.relative(repoRoot, outFile)}`);
