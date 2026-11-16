#!/usr/bin/env node
/**
 * Build the `review-verdict` decision corpus from the SHIPPED review
 * artifacts.
 *
 * The `video review` agent writes three files per project —
 * `content-review.yaml`, `visual-review.yaml`, `technical-review.yaml`
 * — and each ends in an `overall` verdict (`pass` | `warn` | `fail`).
 * That verdict is the ground truth: the surface asks whether a decision
 * model can re-derive it from the section's findings.
 *
 * The state deliberately withholds the verdict (see
 * `packages/review/src/decision.ts`): the model reads the fields and
 * findings and decides the verdict they earn.
 *
 * The state is built by `buildReviewVerdictState` — the same function
 * the pipeline consults with — so a corpus case and a shadow-run
 * consult have exactly the same shape.
 *
 *   node scripts/build-review-verdict-corpus.mjs [--dry-run]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  buildReviewVerdictState,
  sectionVerdictBaseline,
} from "../packages/review/dist/decision.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectsDir = path.join(repoRoot, "projects");
const outDir = path.join(
  repoRoot,
  "packages",
  "prompts",
  "decisions",
  "review-verdict",
);
const dryRun = process.argv.includes("--dry-run");

/** Split a section into its scalar fields and its findings. */
function sectionFacts(section, name) {
  const fields = [];
  const findings = [];
  for (const [key, value] of Object.entries(section)) {
    if (key === "overall") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          findings.push({
            ...(item.id !== undefined ? { id: String(item.id) } : {}),
            ...(item.severity !== undefined
              ? { severity: String(item.severity) }
              : {}),
            ...(item.reference !== undefined && item.reference !== null
              ? { reference: String(item.reference) }
              : {}),
            observation: String(item.observation ?? ""),
            ...(item.evidence !== undefined && item.evidence !== null
              ? { evidence: String(item.evidence) }
              : {}),
          });
        }
      }
      continue;
    }
    if (value && typeof value === "object" && "status" in value) {
      fields.push({
        name: key,
        status: String(value.status),
        ...(value.evidence !== undefined && value.evidence !== null
          ? { evidence: String(value.evidence) }
          : {}),
      });
    }
  }
  return { section: name, fields, findings };
}

const cases = [];
for (const project of readdirSync(projectsDir)) {
  const reviewDir = path.join(projectsDir, project, "review");
  if (!existsSync(reviewDir)) continue;
  for (const file of readdirSync(reviewDir)) {
    if (!file.endsWith("-review.yaml")) continue;
    const sectionName = file.replace("-review.yaml", "");
    let doc;
    try {
      doc = parseYaml(readFileSync(path.join(reviewDir, file), "utf8"));
    } catch {
      continue;
    }
    const section = doc?.[sectionName];
    if (!section || typeof section !== "object") continue;
    const overall = section.overall;
    if (overall !== "pass" && overall !== "warn" && overall !== "fail") {
      continue;
    }
    const facts = sectionFacts(section, sectionName);
    cases.push({
      id: `${project}-${sectionName}`,
      surface: "review-verdict",
      state: buildReviewVerdictState(facts),
      expects: { kind: "choice", value: overall },
      // The deterministic path's answer — the field-status rule, not the
      // artifact's own verdict (which is the label).
      baseline: sectionVerdictBaseline(facts),
      source_verdict: { section_verdict: overall },
      policy: {
        rule: "section-verdict",
        note: "The label is DERIVED from the review artifact's own `overall` verdict by the section-verdict rule. The loader re-checks that derivation when the case is loaded.",
      },
      provenance: {
        source: `projects/${project}/review/${file} — the review agent's own verdict for the ${sectionName} section.`,
      },
    });
  }
}

const counts = cases.reduce((acc, c) => {
  acc[c.expects.value] = (acc[c.expects.value] ?? 0) + 1;
  return acc;
}, {});
console.log(`cases: ${cases.length}`, counts);

if (!dryRun) {
  mkdirSync(outDir, { recursive: true });
  for (const c of cases) {
    writeFileSync(
      path.join(outDir, `${c.id}.yaml`),
      yamlStringify(c, { lineWidth: 100 }),
      "utf8",
    );
  }
  console.log(`written to ${path.relative(repoRoot, outDir)}`);
}
