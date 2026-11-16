#!/usr/bin/env node
/**
 * Build the `motion-prescreen` decision corpus from the SHIPPED
 * storyboards.
 *
 * The surface asks one question: does a scene's deterministic baseline
 * plan already say what the scene is about, or would a second pass
 * change what the viewer sees? The ground truth is the plan that
 * actually shipped — every shipped storyboard carries the motion plan
 * the pipeline produced, and that plan is the answer to "what did this
 * scene need?".
 *
 * The label rule (`motion-specificity`, see decisions/POLICY.md):
 *
 *   refine — the shipped plan animates a NAMED element of the scene
 *            (`event-1979`, `__title__`, `line-0`). The baseline plan
 *            cannot know those names; the plan says something specific
 *            about the scene's content.
 *   keep   — the shipped plan animates the scene as a whole (every
 *            target is the scene id): the same shape the deterministic
 *            baseline produces.
 *
 * The population is lopsided — 482 refine and 46 keep across the 528
 * shipped scenes that carry a plan — so the corpus is BALANCED 50/50
 * by construction. A corpus that is 91% one class measures the
 * majority class, not the model.
 *
 * The state is built by `buildMotionPrescreenState` — the same function
 * the pipeline consults with — so a corpus case and a shadow-run
 * consult have exactly the same shape.
 *
 *   node scripts/build-motion-prescreen-corpus.mjs [--dry-run]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { planSceneMotion } from "../packages/motion/dist/plan.js";
import { buildMotionPrescreenState } from "../packages/motion/dist/decision.js";

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
  "motion-prescreen",
);
const dryRun = process.argv.includes("--dry-run");

/** One shipped scene's motion facts. */
function sceneFacts(scene) {
  return {
    sceneId: String(scene.id ?? ""),
    durationSec: Number(scene.duration ?? 0),
    component: String(scene.visual?.component ?? "AnimatedIllustration"),
    ...(scene.narration?.text !== undefined
      ? { narrationText: String(scene.narration.text) }
      : {}),
    propsSummary: JSON.stringify(scene.visual?.props ?? {}).slice(0, 600),
  };
}

/** Does the shipped plan animate a NAMED element of the scene? */
function isSpecific(shipped, sceneId) {
  const targets = shipped.map((a) => String(a.target ?? ""));
  return targets.some((t) => t !== sceneId && t !== "__scene__");
}

const cases = [];
for (const project of readdirSync(projectsDir)) {
  const file = path.join(projectsDir, project, "storyboard", "storyboard.yaml");
  if (!existsSync(file)) continue;
  let doc;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const channelProfile = doc?.style?.channel_profile;
  for (const scene of doc?.scenes ?? []) {
    const shipped = scene?.animations;
    // A scene with no shipped plan says nothing about the baseline's
    // quality — the project may never have run `video motion` — so it
    // is not evidence either way.
    if (!Array.isArray(shipped) || shipped.length === 0) continue;
    const facts = sceneFacts(scene);
    if (!facts.sceneId || !(facts.durationSec > 0)) continue;
    let baseline;
    try {
      baseline = planSceneMotion({
        sceneId: facts.sceneId,
        durationSec: facts.durationSec,
        index: 0,
        component: facts.component,
        ...(channelProfile !== undefined ? { channelProfile } : {}),
      });
    } catch {
      continue;
    }
    const specific = isSpecific(shipped, facts.sceneId);
    const label = specific ? "refine" : "keep";
    const targets = shipped.map((a) => String(a.target ?? "")).join(", ");
    cases.push({
      id: `${project}-${facts.sceneId}`,
      surface: "motion-prescreen",
      state: buildMotionPrescreenState(facts, baseline),
      expects: { kind: "choice", value: label },
      baseline: "keep",
      policy: {
        rule: "motion-specificity",
        note: specific
          ? "The shipped plan animates a NAMED element of the scene — the baseline plan cannot know those names, so the scene needed a second pass."
          : "The shipped plan animates the scene as a whole — the same shape the deterministic baseline produces, so a second pass was not needed.",
      },
      provenance: {
        source: `projects/${project}/storyboard/storyboard.yaml — scene ${facts.sceneId} (${facts.component}, ${facts.durationSec}s). The shipped motion plan targets: ${targets}.`,
      },
    });
  }
}

// Balance 50/50 by construction — the population is lopsided, and a
// corpus that is 91% one class measures the majority class.
const keeps = cases.filter((c) => c.expects.value === "keep");
const refines = cases.filter((c) => c.expects.value === "refine");
// Spread the refine picks across projects: take them in a stable order,
// then keep every Nth so one big project cannot fill the corpus.
refines.sort((a, b) => (a.id < b.id ? -1 : 1));
const take = Math.min(keeps.length, refines.length);
const step = Math.max(1, Math.floor(refines.length / Math.max(1, take)));
const pickedRefines = [];
for (let i = 0; pickedRefines.length < take && i < refines.length; i += step) {
  pickedRefines.push(refines[i]);
}
const selected = [...keeps, ...pickedRefines].sort((a, b) =>
  a.id < b.id ? -1 : 1,
);

console.log(
  `scenes with a shipped plan: ${cases.length} (keep ${keeps.length}, refine ${refines.length})`,
);
console.log(`corpus written: ${selected.length} cases (balanced)`);

if (!dryRun) {
  // The surface's corpus is rebuilt in full: the two cases that came
  // from a unit-test fixture are replaced by cases that cite shipped
  // storyboards.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const c of selected) {
    writeFileSync(
      path.join(outDir, `${c.id}.yaml`),
      yamlStringify(c, { lineWidth: 100 }),
      "utf8",
    );
  }
  console.log(`written to ${path.relative(repoRoot, outDir)}`);
}
