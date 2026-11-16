#!/usr/bin/env node
/**
 * Build the NEGATIVE `caption-overlap` decision cases from the shipped
 * render reports and captions.
 *
 * The surface's question is: does a frame draw two pieces of text in
 * the bottom band at the same time? The deterministic caption check
 * knows where the caption sits and cannot see what else is drawn there,
 * so the shipped renders are the ground truth for "the caption sits
 * alone".
 *
 * The positives are NOT built here: the failure was rare and it was
 * fixed by design (the baked text overlay moved ABOVE the caption band
 * — see `scripts/pillow-text-overlay.py`), so the only positives in the
 * corpus are the two documented failures that live in the corpus
 * already. This script writes the negatives and leaves them alone.
 *
 * The state is built by `buildCaptionOverlapState` — the same function
 * the pipeline consults with — so a corpus case and a shadow-run
 * consult have exactly the same shape.
 *
 *   node scripts/build-caption-overlap-corpus.mjs [--dry-run]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { buildCaptionOverlapState } from "../packages/qa/dist/caption-decision.js";

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
  "caption-overlap",
);
const dryRun = process.argv.includes("--dry-run");

/** Parse an SRT into cues. */
function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [from, to] = timing.split("-->").map((s) => s.trim());
    const toSec = (t) => {
      // "HH:MM:SS,mmm" — the comma is the millisecond separator.
      const parts = t.replace(",", ".").split(":").map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return Number.NaN;
      }
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };
    const startSec = toSec(from);
    const endSec = toSec(to);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    const body = lines
      .slice(lines.indexOf(timing) + 1)
      .join(" ")
      .trim();
    cues.push({ startSec, endSec, text: body });
  }
  return cues;
}

const cases = [];
for (const project of readdirSync(projectsDir)) {
  const reportFile = path.join(
    projectsDir,
    project,
    "qa",
    "render-report.json",
  );
  const storyboardFile = path.join(
    projectsDir,
    project,
    "storyboard",
    "storyboard.yaml",
  );
  if (!existsSync(reportFile) || !existsSync(storyboardFile)) continue;
  let report;
  let storyboard;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
    storyboard = parseYaml(readFileSync(storyboardFile, "utf8"));
  } catch {
    continue;
  }
  // The captions check must have PASSED — a render whose caption check
  // failed is not evidence that the band was clean.
  const captions = report?.checks?.captions;
  if (!captions?.ok) continue;
  const captionsDir = path.join(projectsDir, project, "captions");
  if (!existsSync(captionsDir)) continue;
  const srtFile = readdirSync(captionsDir)
    .filter((f) => f.endsWith(".srt"))
    .sort()[0];
  if (srtFile === undefined) continue;
  const cues = parseSrt(readFileSync(path.join(captionsDir, srtFile), "utf8"));
  const scenes = storyboard?.scenes ?? [];
  if (scenes.length === 0 || cues.length === 0) continue;

  // Bucket the cues into the scenes by the scene start times.
  let cursor = 0;
  const buckets = scenes.map((scene) => {
    const start = cursor;
    cursor += Number(scene.duration ?? 0);
    return { scene, start, end: cursor, cues: [] };
  });
  for (const cue of cues) {
    const bucket = buckets.find(
      (b) => cue.startSec >= b.start - 0.01 && cue.startSec < b.end - 0.01,
    );
    if (bucket) bucket.cues.push(cue);
  }
  const withCues = buckets.filter((b) => b.cues.length > 0);
  if (withCues.length === 0) continue;
  const first = withCues[0];
  const scene = first.scene;
  const index = scenes.indexOf(scene) + 1;
  const props = scene?.visual?.props ?? {};
  // The scene's own text, and where it sits.
  //  - the CS-06 overlay (`overlay:` in the storyboard) is composited over
  //    the scene's image and declares its own position: `top` is above the
  //    caption band, `bottom` IS the caption band;
  //  - the baked PNG overlay (`props.textOverlaySrc`) is written ABOVE
  //    the safe area by `scripts/pillow-text-overlay.py`, so it never
  //    shares the band.
  const overlay = scene?.overlay ?? null;
  const overlayText =
    typeof overlay?.title === "string"
      ? overlay.title
      : typeof overlay?.chapter === "string"
        ? overlay.chapter
        : "";
  const bakedText =
    typeof props["textOverlaySrc"] === "string" &&
    props["textOverlaySrc"] !== ""
      ? String(props["caption"] ?? "")
      : "";
  const ownText = overlayText !== "" ? overlayText : bakedText;
  const ownPlacement =
    overlayText !== ""
      ? overlay?.position === "bottom"
        ? "in-band"
        : "above-band"
      : bakedText !== ""
        ? "above-band"
        : undefined;

  const state = buildCaptionOverlapState({
    sceneId: String(scene.id ?? `scene-${index}`),
    sceneIndex: index,
    sceneCount: scenes.length,
    component: String(scene?.visual?.component ?? ""),
    cues: first.cues.map((c) => ({
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.text,
    })),
    ...(ownText !== "" ? { ownText, ownPlacement } : {}),
  });

  // The label is DERIVED from the artifact: a scene whose own text sits
  // IN the caption band holds two texts at the same time.
  const label = ownPlacement === "in-band" ? "true" : "false";
  cases.push({
    id: `${project}-captions-clean`,
    surface: "caption-overlap",
    state,
    expects: {
      kind: "noul",
      value: label,
      probability: label === "true" ? [0.8, 1.0] : [0.0, 0.2],
    },
    baseline: "false",
    policy: {
      rule: "caption-band",
      note:
        label === "true"
          ? "The scene declares its own overlay at `position: bottom` — the same band the caption is drawn into, so two texts are drawn there at the same time."
          : "The shipped render's caption check passed and the scene's own text sits ABOVE the caption band, so the caption sits alone in the bottom band.",
    },
    provenance: {
      source: `projects/${project}/qa/render-report.json (captions.ok, ${captions.cues} cues) + projects/${project}/captions/${srtFile} — the caption sits alone in the bottom band.`,
    },
  });
}

console.log(`negative cases: ${cases.length} (one per shipped render)`);

if (!dryRun) {
  for (const c of cases) {
    writeFileSync(
      path.join(outDir, `${c.id}.yaml`),
      yamlStringify(c, { lineWidth: 100 }),
      "utf8",
    );
  }
  console.log(`written to ${path.relative(repoRoot, outDir)}`);
}
