import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bakeDigestFor, loadBakeManifestSync } from "@video/media-generators";
import { parse as parseYaml } from "yaml";
import { extractSceneFragment, hashSceneFragment } from "@video/workflow";
import {
  parseArticleWithRecovery,
  resolveImageStyle,
  IMAGE_PROMPT_REVISION,
} from "@video/draft";
import { loadLessonStore, promptRules, rulesDigest } from "@video/learn";
import { RENDERER_REVISION } from "@video/video-renderer";
import {
  imageCacheKey,
  readImageCacheSidecar,
  selfRenderedSceneNumbers,
  storyboardSceneComponents,
  visualsGateState,
} from "./visual-cache.js";
import {
  EN_VOICE,
  resolveImageProvider,
  ttsCacheKey,
  workspaceRootFor,
  ZH_VOICE,
} from "./index.js";

/**
 * Read-only impact report for `video make --dry-run` (v0.8 plan G2).
 *
 * Computes — without constructing a provider or writing a byte — exactly
 * what a make would spend: which scene images regenerate (G1 cache keys),
 * which narration WAVs re-synthesize (TTS cache keys), which scene MP4s
 * re-render (scene-cache sidecars), whether the visuals approval gate
 * (G4) would block, and whether article content drifted past the
 * id-keyed storyboard sync.
 *
 * All file reads are guarded: a missing artifact reports as "will
 * generate/render", never throws.
 */

export interface ImpactOptions {
  imageProvider?: "minimax" | "openai" | "gemini" | "mock" | "none";
  fake?: boolean;
}

export interface MakeImpact {
  /** 1-based scene numbers whose image will (re)generate. */
  imageGenerate: number[];
  imageRegenerate: number[]; // existing jpg, stale key
  imageAdopt: number[]; // legacy jpg, no sidecar → kept
  imageCached: number[];
  /** Scene ids whose narration WAV will (re)synthesize. */
  ttsSynthesize: string[];
  ttsResynth: string[];
  ttsCached: string[];
  /** Scene ids the renderer will re-render (fragment hash vs sidecar). */
  scenesRender: string[];
  scenesCached: string[];
  /** G4 gate: absent ⇒ gate off; otherwise its state + stale scenes. */
  visualsGate:
    | { required: false }
    | {
        required: true;
        state: "ok" | "missing-checkpoint" | "stale";
        staleScenes: number[];
      };
  /** Article narration that no longer matches the on-disk storyboard
   *  (id-keyed sync keeps the old text — surfaced, not silently fixed). */
  storyboardDrift: string[];
  warnings: string[];
}

function readTextSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function computeMakeImpact(
  projectRoot: string,
  opts: ImpactOptions = {},
): MakeImpact {
  const warnings: string[] = [];
  const articlePath = path.join(projectRoot, "article.md");
  const articleMd = readTextSafe(articlePath);
  if (articleMd === null) {
    throw new Error(`impact: article.md not found at ${articlePath}`);
  }
  const article = parseArticleWithRecovery(articleMd).article;

  // ── Images (G1 keys) ─────────────────────────────────────────────────
  const imageGenerate: number[] = [];
  const imageRegenerate: number[] = [];
  const imageAdopt: number[] = [];
  const imageCached: number[] = [];
  const imageDir = path.join(projectRoot, "assets", "images");
  const provider = resolveImageProvider(
    opts.fake,
    opts.imageProvider,
    article.frontmatter.image_provider,
  );
  if (provider !== "none") {
    const selfRendered = selfRenderedSceneNumbers(projectRoot);
    const reqWidth = provider === "mock" ? 64 : 1920;
    const reqHeight = provider === "mock" ? 36 : 1080;
    const imageStyle = resolveImageStyle(article.frontmatter.image_style);
    // Same lookup as generateSceneVisuals, or the table predicts spend
    // the render never makes: shared resolver, shared root detection.
    const wsRoot = workspaceRootFor(projectRoot);
    const learnedDigest = rulesDigest(
      wsRoot === null
        ? ""
        : promptRules(loadLessonStore(wsRoot), "image-prompt"),
    );
    // Baked scene text is an image input here too: the impact table must
    // count an edited title as a regeneration, not a no-op.
    const bakeManifest = loadBakeManifestSync(
      path.join(projectRoot, "assets", "images"),
    );
    article.scenes.forEach((scene, i) => {
      const n = i + 1;
      const visual = scene.visual ?? "";
      if (!visual.trim() || selfRendered.has(n)) return;
      const key = imageCacheKey({
        sceneNumber: n,
        visual,
        imageStyle,
        provider,
        learnedDigest,
        promptRevision: IMAGE_PROMPT_REVISION,
        bakeDigest: bakeDigestFor(n, bakeManifest),
        width: reqWidth,
        height: reqHeight,
      });
      const jpg = path.join(imageDir, `scene_${n}.jpg`);
      if (!existsSync(jpg)) {
        imageGenerate.push(n);
        return;
      }
      const sidecar = readImageCacheSidecar(jpg);
      if (sidecar === null) imageAdopt.push(n);
      else if (sidecar.cacheKey === key) imageCached.push(n);
      else imageRegenerate.push(n);
    });
  }

  // ── TTS (content-keyed cache sidecars) ───────────────────────────────
  const ttsSynthesize: string[] = [];
  const ttsResynth: string[] = [];
  const ttsCached: string[] = [];
  const audioDir = path.join(projectRoot, "assets", "audio");
  const audioCfgText = readTextSafe(
    path.join(projectRoot, "audio-config.yaml"),
  );
  let pauseSec: number | undefined;
  if (audioCfgText !== null) {
    try {
      const cfg = parseYaml(audioCfgText) as {
        pause_between_sentences_sec?: number;
      };
      pauseSec = cfg.pause_between_sentences_sec;
    } catch {
      warnings.push("audio-config.yaml unreadable — TTS impact approximate");
    }
  }
  // Same resolution order as runTts: frontmatter.voice, else the language
  // default. (This used to read audio-config.yaml's `voice:`, which make
  // ignores on the synthesis path — the table lied whenever the two files
  // disagreed.)
  const effectiveVoice =
    article.frontmatter.voice ||
    (article.frontmatter.language === "en-US" ? EN_VOICE : ZH_VOICE);
  // --fake runs synthesize under the "fake" provider namespace; the impact
  // report has no fake flag, so it can over-report resynthesis there.
  // Names mirror the providers' `name` fields (MinimaxTTSProvider is
  // "minimax-tts"), since that is what runTts feeds ttsCacheKey.
  const effectiveTtsProvider =
    article.frontmatter.tts_provider === "voicebox"
      ? "voicebox"
      : article.frontmatter.tts_provider === "minimax"
        ? "minimax-tts"
        : "edge";
  article.scenes.forEach((scene) => {
    const idNum = scene.id.replace(/^scene[-_]?/, "");
    const wav = path.join(audioDir, `scene_${idNum}.wav`);
    if (!existsSync(wav)) {
      ttsSynthesize.push(scene.id);
      return;
    }
    const meta = readTextSafe(`${wav}.json`);
    const key = ttsCacheKey(
      scene.narration,
      effectiveVoice,
      pauseSec,
      effectiveTtsProvider,
    );
    if (meta !== null) {
      try {
        const m = JSON.parse(meta) as { cacheKey?: string };
        if (m.cacheKey === key) {
          ttsCached.push(scene.id);
          return;
        }
      } catch {
        /* fall through to resynth */
      }
    }
    ttsResynth.push(scene.id);
  });

  // ── Scene renders (fragment hash vs renderer cache sidecar) ─────────
  const scenesRender: string[] = [];
  const scenesCached: string[] = [];
  const storyboardText = readTextSafe(
    path.join(projectRoot, "storyboard", "storyboard.yaml"),
  );
  if (storyboardText === null) {
    scenesRender.push("(no storyboard — will derive from article.md)");
  } else {
    // Sidecars are named from the STORYBOARD's own scene ids and order
    // (renderer: `<index>-<slug>.mp4.json`, e.g. 00-scene-01.mp4.json) —
    // article ids may be unpadded (scene_1) and would never match.
    const sb = storyboardSceneComponents(projectRoot);
    article.scenes.forEach((scene, i) => {
      const sbId = sb.ids[i];
      if (sbId === undefined) {
        scenesRender.push(scene.id);
        return;
      }
      const slug = sbId.replace(/[^a-zA-Z0-9_-]+/g, "_") || "scene";
      const sidecar = readTextSafe(
        path.join(
          projectRoot,
          "scenes",
          `${String(i).padStart(2, "0")}-${slug}.mp4.json`,
        ),
      );
      if (sidecar === null) {
        scenesRender.push(scene.id);
        return;
      }
      try {
        const m = JSON.parse(sidecar) as {
          sceneHash?: string;
          rendererRevision?: string;
        };
        const frag = extractSceneFragment(storyboardText, sbId);
        const hash = frag === null ? null : hashSceneFragment(frag);
        // The renderer revision is a plain field in the sidecar, so the
        // dry-run can check it with a string compare — it has no compiled
        // renderPlan and must not rebuild one just to answer "will this
        // re-render?". projectHash (theme/brand/geometry) still gates
        // freshness at make time and is not predicted here; it only ever
        // forces MORE work than this table shows, never less.
        if (
          m.sceneHash &&
          hash &&
          m.sceneHash === hash &&
          m.rendererRevision === RENDERER_REVISION
        ) {
          scenesCached.push(scene.id);
        } else {
          scenesRender.push(scene.id);
        }
      } catch {
        scenesRender.push(scene.id);
      }
    });
  }

  // ── Visuals gate (G4) — visualsGateState is the single source of truth
  // (the make-time gate reads the same function).
  const requiresGate = article.frontmatter["require_visual_approval"] === true;
  let visualsGate: MakeImpact["visualsGate"] = { required: false };
  if (requiresGate) {
    const g = visualsGateState(projectRoot);
    visualsGate = { required: true, ...g };
  }

  // ── Storyboard drift (id-keyed sync limitation, plan §9) ─────────────
  const storyboardDrift: string[] = [];
  if (storyboardText !== null) {
    try {
      const parsed = parseYaml(storyboardText) as {
        scenes?: { id?: string; narration?: { text?: string } }[];
      };
      // Storyboard ids are zero-padded (scene-01) while article ids may
      // not be (scene_1) — key both sides by the scene NUMBER.
      const byNum = new Map<number, string>();
      for (const s of parsed.scenes ?? []) {
        const m = s.id?.match(/scene[-_]?(\d+)/);
        if (m) byNum.set(parseInt(m[1]!, 10), s.narration?.text ?? "");
      }
      article.scenes.forEach((scene, i) => {
        const onDisk = byNum.get(i + 1);
        if (onDisk !== undefined && onDisk.trim() !== scene.narration.trim()) {
          storyboardDrift.push(scene.id);
        }
      });
    } catch {
      /* unreadable storyboard — drift check skipped */
    }
  }

  return {
    imageGenerate,
    imageRegenerate,
    imageAdopt,
    imageCached,
    ttsSynthesize,
    ttsResynth,
    ttsCached,
    scenesRender,
    scenesCached,
    visualsGate,
    storyboardDrift,
    warnings,
  };
}

/** Human-readable rendering of an impact report (used by make --dry-run). */
export function formatImpact(impact: MakeImpact): string[] {
  const lines: string[] = [];
  const img =
    impact.imageGenerate.length === 0 &&
    impact.imageRegenerate.length === 0 &&
    impact.imageAdopt.length === 0
      ? `images: all ${impact.imageCached.length} cached`
      : `images: ${impact.imageGenerate.length} generate, ` +
        `${impact.imageRegenerate.length} regenerate (stale), ` +
        `${impact.imageAdopt.length} adopt (legacy), ` +
        `${impact.imageCached.length} cached`;
  lines.push(img);
  if (impact.imageRegenerate.length > 0)
    lines.push(
      `  regenerate: ${impact.imageRegenerate.map((n) => `scene_${n}`).join(", ")}`,
    );
  if (impact.imageGenerate.length > 0)
    lines.push(
      `  generate: ${impact.imageGenerate.map((n) => `scene_${n}`).join(", ")}`,
    );
  const tts =
    impact.ttsSynthesize.length === 0 && impact.ttsResynth.length === 0
      ? `tts: all ${impact.ttsCached.length} cached`
      : `tts: ${impact.ttsSynthesize.length} synthesize, ` +
        `${impact.ttsResynth.length} re-synth, ` +
        `${impact.ttsCached.length} cached`;
  lines.push(tts);
  if (impact.ttsResynth.length > 0)
    lines.push(`  re-synth: ${impact.ttsResynth.join(", ")}`);
  const scenes =
    impact.scenesRender.length === 0
      ? `render: all ${impact.scenesCached.length} scenes cached`
      : `render: ${impact.scenesRender.length} scene(s) will render, ` +
        `${impact.scenesCached.length} cached`;
  lines.push(scenes);
  if (impact.scenesRender.length > 0)
    lines.push(`  render: ${impact.scenesRender.join(", ")}`);
  if (impact.visualsGate.required) {
    const g = impact.visualsGate;
    lines.push(
      `visuals gate: ${g.state}` +
        (g.state === "stale"
          ? ` — stale scenes: ${g.staleScenes.map((n) => `scene_${n}`).join(", ")}`
          : g.state === "missing-checkpoint"
            ? " — run `video visuals <project>` then `video approve visuals <project>`"
            : ""),
    );
  }
  if (impact.storyboardDrift.length > 0) {
    lines.push(
      `storyboard drift: ${impact.storyboardDrift.join(", ")} (article text changed; id-keyed sync keeps the old storyboard text — plan §9)`,
    );
  }
  for (const w of impact.warnings) lines.push(`  ! ${w}`);
  return lines;
}
