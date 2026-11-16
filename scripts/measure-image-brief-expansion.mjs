#!/usr/bin/env node
/**
 * Measure whether the image-brief surface has a corpus at all.
 *
 * v0.12's P3 candidate was: "skip the image-brief expansion when the
 * article's `visual:` line is already a concrete brief". The premise
 * was that some scenes carry a bare category ("a diagram of the three
 * layers") that the expander turns into a concrete subject, so the
 * expander's call could be skipped for the scenes that do not need it.
 *
 * This script tests the premise against the SHIPPED artifacts:
 *
 *  - how long is a shipped `visual:` line (a bare category is short)?
 *  - does the shipped brief (assets/images/scene_N.prompt.txt) invent
 *    content the line did not have, or does it restate it?
 *
 * The overlap measure is only meaningful for the ENGLISH projects: the
 * expander writes the brief in English, so a Chinese line shares no
 * characters with its brief even when the brief is a faithful
 * translation of it.
 *
 *   node scripts/measure-image-brief-expansion.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectsDir = path.join(repoRoot, "projects");

/** The character bigrams of a text, lowercased and whitespace-free. */
function bigrams(text) {
  const s = text.replace(/\s+/g, "").toLowerCase();
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const rows = [];
for (const project of readdirSync(projectsDir)) {
  const articleFile = path.join(projectsDir, project, "article.md");
  if (!existsSync(articleFile)) continue;
  const text = readFileSync(articleFile, "utf8");
  const match = text.match(/## Scenes\s*```yaml\s*([\s\S]*?)```/);
  if (!match) continue;
  let doc;
  try {
    doc = parseYaml(match[1]);
  } catch {
    continue;
  }
  for (const [index, scene] of (doc?.scenes ?? []).entries()) {
    const visual = scene?.visual;
    if (typeof visual !== "string" || visual.trim() === "") continue;
    const briefFile = path.join(
      projectsDir,
      project,
      "assets",
      "images",
      `scene_${index + 1}.prompt.txt`,
    );
    if (!existsSync(briefFile)) continue;
    const brief = readFileSync(briefFile, "utf8");
    const vb = bigrams(visual);
    const overlap =
      vb.size === 0
        ? 0
        : [...vb].filter((g) => bigrams(brief).has(g)).length / vb.size;
    rows.push({
      project,
      language: project.endsWith("-en") ? "en" : "zh",
      length: visual.trim().length,
      overlap,
    });
  }
}

const zh = rows.filter((r) => r.language === "zh");
const en = rows.filter((r) => r.language === "en");
const bare = rows.filter((r) => r.length < 30);

console.log(`scenes with a visual line AND a shipped brief: ${rows.length}`);
console.log(`  zh ${zh.length} · en ${en.length}`);
console.log(
  `visual-line length: median ${median(rows.map((r) => r.length))} · ` +
    `lines under 30 chars: ${bare.length} (${((bare.length / rows.length) * 100).toFixed(1)}%)`,
);
console.log(
  "  length buckets:",
  [0, 30, 60, 120, 240]
    .map((lo, i, all) => {
      const hi = all[i + 1] ?? Infinity;
      const n = rows.filter((r) => r.length >= lo && r.length < hi).length;
      return `${lo}-${hi === Infinity ? "∞" : hi}:${n}`;
    })
    .join("  "),
);
for (const [label, group] of [
  ["zh", zh],
  ["en", en],
]) {
  if (group.length === 0) continue;
  const reused = group.filter((r) => r.overlap > 0.6).length;
  console.log(
    `${label}: brief restates the line (overlap > 0.6) in ${reused}/${group.length} scenes`,
  );
}
console.log(
  "\nVerdict: the shipped visual lines are already concrete prose (median " +
    `${median(rows.map((r) => r.length))} chars), and the expander's real job is to ` +
    "TRANSLATE and STRUCTURE them into the six-part English brief. There is no " +
    "population of bare-category lines to skip, so the surface has no corpus to " +
    "measure — see docs/plans/v0.12.",
);
