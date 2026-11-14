#!/usr/bin/env node
/**
 * Audit the decision corpus against the artifacts it cites.
 *
 * A corpus case is only worth measuring if its state is the state the
 * pipeline actually sees. This script checks that:
 *
 *  - a case whose provenance names a project has its state present in
 *    that project's `article.md` scene block (for `visual-class`), and
 *  - a case whose provenance names a file has that file on disk.
 *
 * It is a LOCAL check: `projects/*` is gitignored apart from the
 * benchmark fixture, so a fresh clone has nothing to check against and
 * the script reports "nothing to audit" and exits 0.
 *
 *   node scripts/audit-decision-corpus.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const corpusDir = path.join(repoRoot, "packages", "prompts", "decisions");

/** The `visual:` lines of a project's article.md, when it has one. */
function articleVisuals(project) {
  const file = path.join(repoRoot, "projects", project, "article.md");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const match = text.match(/## Scenes\s*```yaml\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]);
    const scenes = parsed?.scenes ?? [];
    return scenes.map((s) => (s?.visual ?? "").toString());
  } catch {
    return null;
  }
}

const problems = [];
let checked = 0;
let skipped = 0;

for (const surface of readdirSync(corpusDir, { withFileTypes: true })) {
  if (!surface.isDirectory()) continue;
  const dir = path.join(corpusDir, surface.name);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yaml")) continue;
    const full = path.join(dir, file);
    const fixture = parseYaml(readFileSync(full, "utf8"));
    const source = String(fixture?.provenance?.source ?? "");

    // The file the provenance names must exist.
    const fileMatch = source.match(
      /^(projects\/[^/]+\/(?:qa\/render-report\.json|article-review\.yaml|article\.md)|packages\/[^ ,]+\.yaml)/,
    );
    if (fileMatch) {
      const cited = path.join(repoRoot, fileMatch[1]);
      if (!existsSync(cited)) {
        problems.push(`${file}: the cited file is gone — ${fileMatch[1]}`);
      } else {
        checked += 1;
      }
    }

    // A visual-class state must be a scene's `visual:` line.
    if (surface.name === "visual-class") {
      const projectMatch = source.match(/^projects\/([^/]+)\//);
      if (projectMatch) {
        const visuals = articleVisuals(projectMatch[1]);
        if (visuals === null) {
          skipped += 1;
        } else {
          checked += 1;
          if (!visuals.includes(String(fixture?.state ?? ""))) {
            problems.push(
              `${file}: the state is not a scene's visual line in projects/${projectMatch[1]}/article.md`,
            );
          }
        }
      }
    }
  }
}

if (checked === 0) {
  console.log(
    "nothing to audit — the cited projects are not on disk (projects/* is gitignored)",
  );
  process.exit(0);
}

if (problems.length > 0) {
  console.error(`corpus audit FAILED — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `corpus audit OK — ${checked} citation(s) checked, ${skipped} project(s) not on disk`,
);
