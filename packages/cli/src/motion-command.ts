import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  GLMProvider,
  loadProviderConfig,
  MiniMaxProvider,
  type Provider,
} from "@vf/llm";
import { validateStoryboard } from "@vf/vdsl";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  syncSceneDurations,
} from "@vf/media";
import {
  callMotionAgent,
  planSceneMotion,
  IartSkillAdapter,
  type MotionSpec,
} from "@vf/motion";
import {
  formatRunId,
  extractSceneFragment,
  recordSceneVersion,
  replaceSceneFragment,
  writeRun,
} from "@vf/workflow";
import { assertStageWritable } from "./stage-guard.js";
import { resolveProjectDir } from "./project-path.js";

const STORYBOARD_REL = path.join("storyboard", "storyboard.yaml");
const GUIDANCE_MAX_CHARS = 3500;

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

function modelFor(providerName: string): string {
  return providerName === "glm" ? "glm-5.3" : "MiniMax-M3";
}

function sha256OfMessages(messages: { role: string; content: string }[]): string {
  const canon = JSON.stringify(
    messages.map((m) => ({ role: m.role, content: m.content })),
  );
  return "sha256:" + createHash("sha256").update(canon).digest("hex");
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Locate the skills directories relative to how the CLI was invoked:
 * the workspace root is the cwd or its parent (projects/<slug> layout). */
function skillDirsFor(cwd: string | undefined): string[] {
  const base = path.resolve(cwd ?? process.cwd());
  const candidates = [base, path.dirname(base)];
  const dirs: string[] = [];
  for (const c of candidates) {
    dirs.push(path.join(c, ".agents", "skills"));
    dirs.push(path.join(c, "skills"));
  }
  return dirs;
}

function leadingSpace(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

/** Re-indent a yaml-stringified list item to the original fragment's
 * indent (stringify emits "- id: …" flush-left; the storyboard needs it
 * nested under scenes:). */
function indentFragment(fragment: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return fragment
    .split("\n")
    .map((l) => (l.trim() === "" ? l : pad + l))
    .join("\n");
}

function specEquals(existing: unknown, planned: unknown): boolean {
  return JSON.stringify(existing ?? null) === JSON.stringify(planned ?? null);
}

export interface MotionOptions {
  project: string;
  cwd?: string | undefined;
  /** Plan motion for one scene only. */
  scene?: string | undefined;
  /** Beat grid for impact quantization (e.g. 120). */
  bpm?: number | undefined;
  /** Skip the LLM — apply the deterministic heuristics verbatim. */
  baseline?: boolean | undefined;
  model?: "minimax" | "glm" | undefined;
  force?: boolean | undefined;
}

export async function runMotion(opts: MotionOptions): Promise<number> {
  const resolved = resolveProjectDir(opts.project, opts.cwd);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const root = resolved.root;

  // Human gate (A5 pattern): regenerating motion rewrites scenes inside
  // storyboard.yaml — refuse when the storyboard checkpoint is approved
  // or the project shipped, unless --force.
  if (!(await assertStageWritable(root, "storyboard", opts.force === true))) {
    return 1;
  }

  await syncSceneDurations(root);
  const storyboardPath = path.join(root, STORYBOARD_REL);
  if (!existsSync(storyboardPath)) {
    console.error(`motion: no storyboard at ${storyboardPath}`);
    return 1;
  }
  const text = await readFile(storyboardPath, "utf8");
  const shape = validateStoryboard(text, STORYBOARD_REL);
  if (!shape.ok) {
    console.error(
      `motion: storyboard invalid — run \`vf validate\`:\n${shape.errors.map((e) => `  ${e.file}:${e.line} ${e.field} ${e.message}`).join("\n")}`,
    );
    return 1;
  }
  const scenes = shape.data.scenes;
  const targets = opts.scene
    ? scenes.filter((s) => s.id === opts.scene)
    : scenes;
  if (targets.length === 0) {
    console.error(
      `motion: scene "${opts.scene}" not found (has: ${scenes.map((s) => s.id).join(", ")})`,
    );
    return 1;
  }

  // Provider routing via the dedicated "motion" role; LLM output is never
  // trusted — every failure falls back to the deterministic baseline.
  const cfg = loadProviderConfig();
  const roleCfg = cfg["motion"];
  const chosenName = opts.model ?? roleCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === roleCfg.primary ? roleCfg.fallback : roleCfg.primary;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;

  const adapter = new IartSkillAdapter(skillDirsFor(opts.cwd));
  const rawGuidance = await adapter.loadSkillGuidance("animation-principles");
  const guidance = rawGuidance
    ? rawGuidance.body.slice(0, GUIDANCE_MAX_CHARS)
    : null;
  if (!opts.baseline && guidance === null) {
    console.log("  skills not found — using schema rules only (baseline-aware)");
  }

  let storyboardText = text;
  let changed = 0;
  let usedBaseline = opts.baseline === true;
  const providerNames = new Set<string>();
  const tokens = { input: 0, output: 0 };
  let lastMessages: { role: string; content: string }[] = [];

  for (let i = 0; i < targets.length; i++) {
    const scene = targets[i]!;
    const baseline = planSceneMotion({
      sceneId: scene.id,
      durationSec: scene.duration,
      index: i,
      component: scene.visual.component,
      ...(scene.narration?.text !== undefined
        ? { narrationText: scene.narration.text }
        : {}),
      ...(opts.bpm !== undefined ? { beatsPerMinute: opts.bpm } : {}),
    });

    let spec = baseline;
    if (!opts.baseline) {
      try {
        const result = await callMotionAgent(
          {
            sceneId: scene.id,
            durationSec: scene.duration,
            index: i,
            component: scene.visual.component,
            ...(scene.narration?.text !== undefined
              ? { narrationText: scene.narration.text }
              : {}),
            propsSummary: JSON.stringify(scene.visual.props).slice(0, 600),
            ...(opts.bpm !== undefined ? { beatsPerMinute: opts.bpm } : {}),
            baseline,
            guidance,
          },
          provider,
          { model: modelFor(chosenName), temperature: 0.4 },
          fallback,
        );
        spec = result.spec;
        providerNames.add(result.providerName);
        tokens.input += result.usage.input;
        tokens.output += result.usage.output;
        lastMessages = result.messages;
      } catch (err) {
        usedBaseline = true;
        console.warn(
          `  scene ${scene.id}: agent failed → deterministic baseline (${(err as Error).message})`,
        );
      }
    }

    const frag = extractSceneFragment(storyboardText, scene.id);
    if (frag === null) continue;
    // The fragment is a bare YAML sequence ("- id: …"), so parseYaml
    // returns an array of one scene.
    const parsedFrag: unknown = parseYaml(frag);
    const sceneObj = (
      Array.isArray(parsedFrag) ? parsedFrag[0] : parsedFrag
    ) as Record<string, unknown>;
    if (
      specEquals(sceneObj["animations"] ?? null, spec.animations) &&
      specEquals(sceneObj["transition"] ?? null, spec.transition)
    ) {
      console.log(`  scene ${scene.id}: motion unchanged`);
      continue;
    }
    sceneObj["animations"] = spec.animations;
    sceneObj["transition"] = spec.transition;
    const indent = leadingSpace(frag);
    const newFrag = indentFragment(yamlStringify([sceneObj]), indent);
    storyboardText = replaceSceneFragment(storyboardText, scene.id, newFrag);
    await recordSceneVersion(root, scene.id, newFrag);
    changed++;
    console.log(
      `  scene ${scene.id}: ${spec.animations.length} animation(s) planned${usedBaseline && opts.baseline !== true ? " (baseline)" : ""}`,
    );
  }

  if (changed > 0) {
    await writeFile(storyboardPath, storyboardText, "utf8");
  }

  const runId = formatRunId("motion");
  await writeRun(root, {
    run_id: runId,
    stage: "motion",
    status: "succeeded",
    actor: "agent",
    tool: "vf-motion",
    input_commit: safeGitHead(root),
    input_files: [STORYBOARD_REL],
    output_files: [STORYBOARD_REL],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: opts.baseline
      ? "baseline"
      : providerNames.size === 1
        ? [...providerNames][0]!
        : providerNames.size === 0
          ? "baseline"
          : "mixed",
    ...(opts.baseline ? {} : { model: modelFor(chosenName) }),
    ...(lastMessages.length > 0
      ? { prompt_hash: sha256OfMessages(lastMessages) }
      : {}),
    tokens,
  });

  console.log(
    `✓ motion planned for ${changed}/${targets.length} scene(s)${changed > 0 ? ` — next: \`vf preview\`, then \`vf scene list\` to review versions` : ""}`,
  );
  return 0;
}
