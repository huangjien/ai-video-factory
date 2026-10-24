import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { pickVisualComponent } from "./visual-classifier.js";
import { VISUAL_BUILDERS } from "./visual-builders.js";
import type { VisualPropsBuilder } from "./visual-builders.js";
import { emitSceneAnimations } from "./animation-emitter.js";

/**
 * Draft output schema — markdown-first by design. The LLM produces the
 * article.md verbatim; we only validate that the structural pieces parse
 * (frontmatter + Scenes YAML block). Heavy shape validation belongs in
 * `video make`, where it matters; here, the LLM is creative with markdown
 * and the human editor refines it.
 */

export const ArticleFrontmatterSchema = z
  .object({
    project: z.string().min(1),
    language: z.enum(["zh-CN", "en-US"]),
    duration_target_sec: z.number().int().positive(),
    voice: z.string().min(1),
    /** TTS backend selector for `video make`: "voicebox" (local
     *  voicebox.sh server, `voice:` then names a Voicebox profile) or
     *  omitted/unknown → Edge TTS (voice is an Edge voice id). Plain
     *  string on purpose — article.md is hand-edited, and make warns
     *  and falls back to Edge on unrecognized values. */
    tts_provider: z.string().min(1).optional(),
    default_renderer: z.string().min(1).optional(),
    /** v0.4: visual theme (e.g. "paper-light", "dark-tech", "blueprint").
     *  Falls back to "paper-light" when omitted (v0.4.3 default flip). */
    theme: z.string().min(1).optional(),
    /** v0.4: when true, articleToStoryboardYaml omits the
     *  `captions: { source: narration }` block so the renderer skips
     *  the caption overlay. Default false (captions on). */
    no_captions: z.boolean().optional(),
    /** What the caption overlay burns in. `narration` (default) mirrors the
     *  spoken paragraph — right for a talking-head or plain-background scene,
     *  but it is a paragraph, and on a designed card the card already says
     *  it, so the frame ends up printing the same sentence twice. `caption`
     *  burns the scene's short `caption:` label instead.
     *
     *  This is also the only way an en-US article renders: the safe-area
     *  check allows ~24 CJK units/line (ASCII counts 0.5), so three lines
     *  cap an English scene at ~144 characters — which ordinary English
     *  narration exceeds on almost every scene (observed 2026-10-18: 19 of
     *  23 scenes failed validation). Splitting 19 scenes apart is the other
     *  way out; this is the one that does not rewrite the prose. */
    captions_source: z.enum(["narration", "caption"]).optional(),
    /** v0.6: image-style preset for generated scene visuals. Deliberately a
     *  plain string (article.md is human-edited — a typo must not brick
     *  parsing); resolveImageStyle coerces unknown values to
     *  flat-vector at the use site. */
    image_style: z.string().optional(),
    /** v0.10: the era, region and culture the whole video is set in, e.g.
     *  `Tang-dynasty China, 626 CE`. Spliced into every image brief so the
     *  expander can state period dress and appearance instead of leaving the
     *  image model to default — which for a bare "armored rider" means
     *  Western medieval. Optional and typo-tolerant like image_style; absent
     *  means unanchored, which is the pre-v0.10 behaviour. */
    setting: z.string().optional(),
    /** v0.8 (G4): when truthy, `video make` refuses to render until the
     *  current image set matches an approved visuals checkpoint
     *  (`video visuals` + `video approve visuals`). z.unknown + defensive
     *  boolean coercion at the use site — same typo-tolerance as
     *  image_style. */
    require_visual_approval: z.unknown().optional(),
    /** Scene-image provider for `video make`. Deliberately a plain string
     *  (article.md is human-edited — a typo must not brick parsing);
     *  resolveImageProvider coerces unknown values at the use site. */
    image_provider: z.string().optional(),
    /** CS-01: cross-video channel grammar (narrative voice, captions,
     *  motion defaults, brand chrome) — distinct from `image_style`,
     *  which is the per-film art style. Carried article → storyboard
     *  `style.channel_profile` → VDSL → RenderPlan.style. Typo-tolerant
     *  plain string like image_style: article.md is hand-edited, and an
     *  unknown profile must fall back to the neutral default rather
     *  than fail parsing. */
    channel_profile: z.string().optional(),
  })
  .passthrough();
export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatterSchema>;

export const SceneBlockSchema = z
  .object({
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            duration: z.number().int().positive(),
            caption: z.string().min(1),
            visual: z.string().min(1),
            narration: z.string().min(1),
            /** CS-12: the characters on screen, cited by their stable
             *  character-bible id and (optionally) the appearance variant.
             *  The image brief then splices that character's anchors in, so
             *  the same person reads the same across scenes and films. */
            characters: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    variant: z.string().min(1).optional(),
                  })
                  .passthrough(),
              )
              .optional(),
            /** CS-03: seconds of silence held AFTER this scene's narration.
             *  The channel's 留白 — the still frame keeps breathing after the
             *  voice stops, which is what brings the spoken share down to
             *  55–70% of the runtime. It is padded into the narration WAV,
             *  so the scene's measured length IS speech + hold. */
            hold_after_sec: z.number().min(0).max(30).optional(),
            /** Seconds of silence BEFORE this scene's narration. The
             *  opening beat of a video: the title card settles (and the
             *  music bed rises) before the voice starts, so the opening
             *  doesn't slam out on an empty frame. Padded into the front
             *  of the narration WAV, so the scene's measured length is
             *  lead-in + speech + hold. */
            lead_in_sec: z.number().min(0).max(10).optional(),
            /** CS-14: the map geometry for a MapInsert scene — authored,
             *  not generated. The image model invents geography, so the
             *  shapes and routes come from the article (the source of
             *  truth) and carry their own source note. */
            map: z
              .object({
                landforms: z
                  .array(
                    z
                      .object({
                        d: z.string().min(1),
                        kind: z.enum(["ridge", "river", "plain"]).optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
                routes: z
                  .array(z.object({ d: z.string().min(1) }).passthrough())
                  .optional(),
                markers: z
                  .array(
                    z
                      .object({
                        x: z.number(),
                        y: z.number(),
                        kind: z.enum(["start", "city", "battle"]).optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
export type SceneBlock = z.infer<typeof SceneBlockSchema>;
export type Scene = SceneBlock["scenes"][number];

export interface ParsedArticle {
  frontmatter: ArticleFrontmatter;
  proseBody: string;
  scenes: SceneBlock["scenes"];
  /** CS-06: the article's first H1 — the film's title. It is overlaid on
   *  the opening shot rather than given a title card of its own. */
  title?: string;
  /** Original markdown, preserved verbatim for round-trip editing. */
  markdown: string;
}

/** Convert a parsed article into the renderer's VDSL storyboard YAML.
 * Keeps `video make`'s video length in sync with `article.md` scenes —
 * without this, the default `storyboard.yaml` from `video new` (1 scene)
 * would render only 8s of video while `video make` synthesizes all N scenes.
 *
 * v0.4 changes:
 *  - `style.theme` honours `frontmatter.theme` (T8 --style flag).
 *  - `captions: { source: narration }` is emitted for every scene
 *    unless `frontmatter.no_captions === true` (T1 --no-captions).
 *  - The visual component is chosen by `pickVisualComponent` (T2) so
 *    the LLM's "vary visuals" instructions actually take effect.
 *
 * v0.6: `opts.visualOverrides` (scene index → component) lets the Laya
 * assist (laya-assist.ts) replace FALL-THROUGH component choices. The
 * function itself stays pure and synchronous — overrides must be
 * resolved before calling. An override with no VISUAL_BUILDER is
 * ignored (defensive; laya-assist already validates against the
 * component list).
 */
export function articleToStoryboardYaml(
  article: ParsedArticle,
  opts: { visualOverrides?: ReadonlyMap<number, string> } = {},
): string {
  const f = article.frontmatter;
  const theme = f.theme ?? "paper-light";
  const lines: string[] = [
    `schema_version: "0.2"`,
    ``,
    ...(f.default_renderer
      ? [`defaults:`, `  renderer: ${f.default_renderer}`, ``]
      : []),
    `project:`,
    `  id: ${f.project}`,
    `  language: ${f.language}`,
    `  fps: 30`,
    `  width: 1920`,
    `  height: 1080`,
    ``,
    `style:`,
    `  theme: ${yamlStr(theme)}`,
    ...(f.channel_profile
      ? [`  channel_profile: ${yamlStr(f.channel_profile)}`]
      : []),
    ``,
    `scenes:`,
  ];
  const captionsOn = f.no_captions !== true;
  const captionSource =
    f.captions_source === "caption" ? "caption" : "narration";
  // Map scenes → prose sections (same 1:N rule as recoverEmptyNarrations)
  // so visual builders can pull structured data from the article body.
  const sections = parseProseSections(article.proseBody);
  const perSection =
    sections.length === 0
      ? 0
      : Math.max(1, Math.ceil(article.scenes.length / sections.length));
  // CS-05: a channel profile opts out of the Title first-scene default, so
  // the opening shot goes through the normal narrative-image path. Gated
  // on the profile because the plan scopes v1 to chinese-storybook and
  // explicitly does not migrate existing films — flipping this globally
  // would turn every shipped project's title card into a generated image.
  const keepTitleCard = f.channel_profile === undefined;
  let previousSectionIdx = -1;
  article.scenes.forEach((s, i) => {
    const id = `scene-${String(i + 1).padStart(2, "0")}`;
    const isFirst = keepTitleCard && i === 0;
    const overrideKey = opts.visualOverrides?.get(i);
    const override =
      overrideKey !== undefined && VISUAL_BUILDERS[overrideKey] !== undefined
        ? overrideKey
        : null;
    const component =
      override ?? pickVisualComponent(s.visual ?? "", isFirst).component;
    const sectionIdx =
      sections.length === 0
        ? 0
        : Math.min(Math.floor(i / perSection), sections.length - 1);
    const section = sections[sectionIdx] ?? null;
    const builder: VisualPropsBuilder =
      VISUAL_BUILDERS[component] ?? VISUAL_BUILDERS.AnimatedIllustration!;
    const props = builder(s, {
      section,
      language: f.language,
      ...(article.title !== undefined ? { title: article.title } : {}),
    });
    const propsLines = propsToYamlLines(props, "        ");
    lines.push(`  - id: ${id}`);
    lines.push(`    duration: ${s.duration ?? 0}`);
    if (s.hold_after_sec !== undefined) {
      // CS-03: the held silence. sync-durations reads it to work out the
      // scene's SPOKEN length, which is what the caption cues are timed
      // against.
      lines.push(`    hold_after_sec: ${s.hold_after_sec}`);
    }
    if (s.lead_in_sec !== undefined) {
      // The opening beat: silence before the voice, so the title card is
      // readable before the narration starts. sync-durations subtracts it
      // from the spoken length, and the compiler offsets the caption cues
      // by it.
      lines.push(`    lead_in_sec: ${s.lead_in_sec}`);
    }
    lines.push(`    narration:`);
    lines.push(`      text: ${yamlStr(s.narration ?? "")}`);
    lines.push(`    visual:`);
    lines.push(`      component: ${component}`);
    if (component === "DoodleScene") {
      lines.push(`      renderer: canvas`);
    }
    if (propsLines.length === 0) {
      // An empty props object must be written as `{}` — a bare `props:`
      // key parses as null, and the VDSL visual schema requires an object.
      lines.push(`      props: {}`);
    } else {
      lines.push(`      props:`);
      for (const pl of propsLines) lines.push(pl);
    }
    // CS-06: the film's title rides on the OPENING SHOT (it fades out
    // after a few seconds), and a chapter name appears only where a
    // section actually turns — never as a card of its own. Gated on the
    // profile: no other project gets a title overlay.
    if (f.channel_profile !== undefined) {
      const overlay: string[] = [];
      if (i === 0 && article.title !== undefined) {
        overlay.push(`      title: ${yamlStr(article.title)}`);
      }
      // A section turn: this scene opens a new prose section (not the first).
      if (section !== null && i > 0 && sectionIdx !== previousSectionIdx) {
        overlay.push(`      chapter: ${yamlStr(section.heading)}`);
      }
      if (overlay.length > 0) {
        lines.push(`    overlay:`);
        for (const o of overlay) lines.push(o);
        lines.push(`      position: top`);
        if (i === 0 && article.title !== undefined) {
          // The title is a brief arrival, not a permanent frame label.
          lines.push(`      start_sec: 0.6`);
          lines.push(`      end_sec: ${Math.min(5, s.duration ?? 5)}`);
        } else {
          lines.push(`      start_sec: 0.4`);
          lines.push(`      end_sec: ${Math.min(4, s.duration ?? 4)}`);
        }
      }
      previousSectionIdx = sectionIdx;
    }
    const animations = emitSceneAnimations(component, props, {
      sceneDurationSec: s.duration ?? 0,
    });
    if (animations.length > 0) {
      lines.push(`    animations:`);
      for (const a of animations) {
        lines.push(`      - id: ${yamlStr(a.id)}`);
        lines.push(`        target: ${yamlStr(a.target)}`);
        lines.push(`        type: ${a.type}`);
        lines.push(`        start: ${a.start}`);
        lines.push(`        duration: ${a.duration}`);
        lines.push(`        easing: ${a.easing}`);
      }
    }
    if (captionsOn) {
      lines.push(`    captions:`);
      if (captionSource === "caption") {
        lines.push(`      source: caption`);
        const label = (s.caption ?? "").replace(/\s+/g, " ").trim();
        if (label.length > 0) {
          lines.push(`      text: ${yamlStr(label)}`);
        }
      } else {
        lines.push(`      source: narration`);
      }
    }
  });
  return lines.join("\n") + "\n";
}

/** Serialize an arbitrary `Record<string, unknown>` to indented YAML
 *  lines. Top-level scalars use `yamlStr`; arrays of strings become
 *  block sequences; nested objects become nested mappings. */
function propsToYamlLines(
  props: Record<string, unknown>,
  indent: string,
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${indent}${k}: []`);
        continue;
      }
      if (v.every((item) => typeof item === "string")) {
        out.push(`${indent}${k}:`);
        for (const item of v) {
          out.push(`${indent}- ${yamlStr(String(item))}`);
        }
        continue;
      }
      // Mixed / object array — write inline JSON for fidelity (rare path).
      out.push(`${indent}${k}: ${JSON.stringify(v)}`);
      continue;
    }
    if (typeof v === "string") {
      out.push(`${indent}${k}: ${yamlStr(v)}`);
      continue;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out.push(`${indent}${k}: ${String(v)}`);
      continue;
    }
    if (v && typeof v === "object") {
      out.push(`${indent}${k}:`);
      const nested = propsToYamlLines(
        v as Record<string, unknown>,
        indent + "  ",
      );
      out.push(...nested);
      continue;
    }
    out.push(`${indent}${k}: ${yamlStr(String(v))}`);
  }
  return out;
}

function yamlStr(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Title.subtext is rendered as one <p> at 36px on the title card — long
 *  descriptions overflow and become unreadable. Trim to one short clause. */
function truncateForSubtext(s: string): string {
  const MAX = 50;
  if (s.length <= MAX) return s;
  const cut = s.slice(0, MAX);
  const lastPunct = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf(","),
    cut.lastIndexOf("."),
    cut.lastIndexOf(" "),
  );
  const trimmed = lastPunct > 20 ? cut.slice(0, lastPunct) : cut;
  return `${trimmed}…`;
}

/** Parse the article.md shape: frontmatter (YAML), prose body, and a
 * `## Scenes` section containing a fenced YAML block. Tolerates extra
 * structure (sections, hooks, etc.) — keeps them in `proseBody`. */
export function parseArticle(md: string): ParsedArticle {
  const { frontmatter, body } = splitFrontmatter(md);
  const fm = ArticleFrontmatterSchema.parse(frontmatter);
  const { proseBody, scenesYaml } = splitScenesBlock(body);
  const parsedScenes = parseYaml(scenesYaml) as unknown;
  const sb = SceneBlockSchema.parse(parsedScenes);
  const title = extractTitle(proseBody);
  return {
    frontmatter: fm,
    proseBody,
    scenes: sb.scenes,
    ...(title !== undefined ? { title } : {}),
    markdown: md,
  };
}

export function parseArticleLenient(md: string): ParsedArticle {
  const { frontmatter, body } = splitFrontmatter(md);
  const fm = ArticleFrontmatterSchema.parse(frontmatter);
  const { proseBody, scenesYaml } = splitScenesBlock(body);
  const parsedScenes = parseYaml(scenesYaml) as unknown;
  const sb = SceneBlockLenientSchema.parse(parsedScenes);
  const title = extractTitle(proseBody);
  return {
    frontmatter: fm,
    proseBody,
    scenes: sb.scenes,
    ...(title !== undefined ? { title } : {}),
    markdown: md,
  };
}

export interface ArticleWithRecovery {
  article: ParsedArticle;
  recoveredCount: number;
}

/** Strict parse first; on the empty-narration failure mode, fall back to
 *  lenient + section-body recovery. All article.md consumers (make,
 *  audio-plan, draft storyboard-sync, youtube) should go through this so
 *  a malformed LLM draft degrades uniformly instead of crashing one verb
 *  but not another. Other parse errors still throw. */
export function parseArticleWithRecovery(md: string): ArticleWithRecovery {
  try {
    return { article: parseArticle(md), recoveredCount: 0 };
  } catch (err) {
    if (!isEmptyNarrationZodError(err)) throw err;
    const loose = parseArticleLenient(md);
    const { article, recoveredCount } = recoverEmptyNarrations(loose);
    if (recoveredCount === 0) throw err;
    return { article, recoveredCount };
  }
}

function isEmptyNarrationZodError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("too_small") &&
    msg.includes("scenes") &&
    msg.includes("narration")
  );
}

export function recoverEmptyNarrations(article: ParsedArticle): {
  article: ParsedArticle;
  recoveredCount: number;
} {
  const sections = parseProseSections(article.proseBody);
  if (sections.length === 0) {
    return { article, recoveredCount: 0 };
  }
  const perSection = Math.max(
    1,
    Math.ceil(article.scenes.length / sections.length),
  );
  const scenes = article.scenes.map((s) => ({ ...s }));
  let recoveredCount = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    if (scene.narration && scene.narration.trim().length > 0) continue;
    const sectionIdx = Math.min(
      Math.floor(i / perSection),
      sections.length - 1,
    );
    const section = sections[sectionIdx]!;
    const slice = sliceSectionForScene(
      section.body,
      i % perSection,
      perSection,
    );
    if (slice.length > 0) {
      scene.narration = slice;
      recoveredCount++;
    }
  }

  return {
    article: { ...article, scenes },
    recoveredCount,
  };
}

interface ProseSection {
  heading: string;
  body: string;
}

function parseProseSections(proseBody: string): ProseSection[] {
  const sections: ProseSection[] = [];
  const lines = proseBody.split("\n");
  let current: ProseSection | null = null;
  for (const line of lines) {
    const isNumberedSection = /^##\s+\d+\.\s+/.test(line);
    if (isNumberedSection) {
      if (current) sections.push(current);
      current = {
        heading: line.replace(/^##\s+/, "").trim(),
        body: "",
      };
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.trim() }))
    .filter((s) => s.heading.length > 0);
}

function sliceSectionForScene(
  body: string,
  slot: number,
  totalSlots: number,
): string {
  if (body.length === 0) return "";
  const sentenceEnds: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (
      ch === "。" ||
      ch === "！" ||
      ch === "？" ||
      ch === "." ||
      ch === "!" ||
      ch === "?"
    ) {
      sentenceEnds.push(i);
    }
  }
  if (sentenceEnds.length >= totalSlots) {
    const perSlot = sentenceEnds.length / totalSlots;
    const startIdx = Math.floor(slot * perSlot);
    const endIdx = Math.min(
      sentenceEnds.length - 1,
      Math.floor((slot + 1) * perSlot) - 1,
    );
    const start = startIdx === 0 ? 0 : sentenceEnds[startIdx - 1]! + 1;
    const end = sentenceEnds[endIdx]! + 1;
    return body.slice(start, end).trim();
  }
  const idealStart = Math.floor((slot * body.length) / totalSlots);
  const idealEnd = Math.floor(((slot + 1) * body.length) / totalSlots);
  return body.slice(idealStart, idealEnd).trim();
}

const SceneBlockLenientSchema = z
  .object({
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            duration: z.number().int().positive(),
            caption: z.string(),
            visual: z.string(),
            narration: z.string(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

function splitFrontmatter(md: string): {
  frontmatter: unknown;
  body: string;
} {
  const re = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = md.match(re);
  if (!m) {
    throw new Error(
      "article.md is missing YAML frontmatter (--- ... --- at top)",
    );
  }
  const fmRaw = m[1] ?? "";
  const body = md.slice(m[0].length);
  let fm: unknown;
  try {
    fm = parseYaml(fmRaw);
  } catch (err) {
    throw new Error(`frontmatter YAML parse failed: ${(err as Error).message}`);
  }
  return { frontmatter: fm, body };
}

/** The article's first H1 — the film's title. CS-06 overlays it on the
 *  opening shot rather than giving it a title card of its own. */
function extractTitle(body: string): string | undefined {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  if (!m) return undefined;
  const title = (m[1] ?? "").trim();
  return title === "" ? undefined : title;
}

function splitScenesBlock(body: string): {
  proseBody: string;
  scenesYaml: string;
} {
  const headingRe = /^#{1,6}\s*Scenes[^\n]*$/im;
  const headingMatch = body.match(headingRe);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error("article.md has no `## Scenes` heading");
  }
  const proseBody = body.slice(0, headingMatch.index);
  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length);
  const fenceRe = /```(?:yaml)?\s*\n([\s\S]*?)\n```/;
  const fenceMatch = afterHeading.match(fenceRe);
  if (!fenceMatch || fenceMatch[1] === undefined) {
    throw new Error("`## Scenes` heading is not followed by a YAML code block");
  }
  return { proseBody, scenesYaml: fenceMatch[1] };
}
