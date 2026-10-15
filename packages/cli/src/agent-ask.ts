import { MUSIC_PROMPTS } from "@video/audio-assets";
import { IMAGE_STYLES } from "@video/draft";
import { THEME_NAMES, THEME_META } from "@video/video-components";
import type { DraftOptions } from "./draft-command.js";

/**
 * `video-ask/1` — agent-aware draft questions (v0.7 plan, ticket A1).
 *
 * Design source: `docs/v0.7-agent-ask-protocol-plan.md` (binding). This
 * module is PURE: no fs, no I/O beyond the two stdout/stderr emitters at
 * the bottom. Registry imports (`IMAGE_STYLES`, `MUSIC_PROMPTS`,
 * `THEME_NAMES`) are plain data — no provider is ever constructed. All
 * environment reads go through an `env` parameter (defaulting to
 * `process.env`) so tests inject fake environments.
 *
 * The only draft-command import is type-only, which keeps the runtime
 * module graph acyclic — draft-command (A2/A3) imports this module for
 * the `maybeAgentAsk` gate.
 */

/**
 * Alias kept for the ask module's public surface: DraftOptions already
 * carries every knob the questions read (`ask`, `noAsk`, `imageStyle`,
 * `bgm` landed via tickets A2/A3) plus the run's other options. This
 * module reads only those fields — never mutate options here (§9: pure).
 */
export type AskOpts = DraftOptions;

// ─── Detection (§7) ──────────────────────────────────────────────────────────

export interface AgentDetection {
  harness: string;
  via: string;
}

/** Harness detectors, most specific first. First match wins. */
const DETECTORS: readonly AgentDetection[] = [
  { harness: "zcode", via: "ZCODE_APP_VERSION" },
  { harness: "claude-code", via: "CLAUDECODE" },
];

/**
 * Table-driven agent detection (§7): the two known harness rows, then the
 * user-extendable `VIDEO_ASK_ENV` comma list (`VAR` = presence,
 * `VAR=VALUE` = exact match). First match wins; VIDEO_ASK_ENV entries
 * report as `"env (VIDEO_ASK_ENV)"`. Returns null when nothing matches —
 * an unknown harness degrades to today's behavior.
 */
export function detectAgentEnv(
  env: Record<string, string | undefined> = process.env,
): AgentDetection | null {
  for (const row of DETECTORS) {
    if (env[row.via] !== undefined) return row;
  }
  const list = env["VIDEO_ASK_ENV"];
  if (list) {
    for (const raw of list.split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const eq = entry.indexOf("=");
      if (eq === -1) {
        if (env[entry] !== undefined)
          return { harness: "env", via: "VIDEO_ASK_ENV" };
      } else if (env[entry.slice(0, eq)] === entry.slice(eq + 1)) {
        return { harness: "env", via: "VIDEO_ASK_ENV" };
      }
    }
  }
  return null;
}

// ─── Question set (§5 / §6) ─────────────────────────────────────────────────

export interface AskQuestion {
  id: string;
  /** CLI flag, e.g. "--lang". */
  flag: string;
  type: "choice" | "number" | "text";
  question: string;
  /** For type: "choice". */
  choices?: { value: string; note: string }[];
  /** For type: "number". */
  suggestions?: number[];
  default: string | number;
  recommended: string | number;
  /** Why the question is worth asking. */
  why: string;
  /** True when the caller passed the knob explicitly — never ask then. */
  specified: (opts: AskOpts) => boolean;
  /** True when the knob cannot be applied at all (bgm ⊆ audio plan). */
  dropped?: (opts: AskOpts) => boolean;
  /** The effective value (explicit or default) for the `resolved` map. */
  resolved: (opts: AskOpts) => string | number;
}

/**
 * `style` choices, generated from the THEMES registry (§2: single source,
 * no drift — adding a theme extends the question without a code change).
 * Notes come from `THEME_META[name].bestFor`, else the bare theme key.
 */
const STYLE_CHOICES: readonly { value: string; note: string }[] =
  THEME_NAMES.map((name) => ({
    value: name,
    note: THEME_META[name]?.bestFor ?? name,
  }));

/**
 * FLUX scene-image presets — values derive from `IMAGE_STYLES`
 * (@video/draft, landed with v0.6) so a new preset extends the question
 * without a code change. Notes are the §5 envelope's presentation copy,
 * keyed by value; an unnoted preset falls back to its key.
 */
const IMAGE_STYLE_NOTES: Record<string, string> = {
  "flat-vector": "clean geometry; best cross-scene consistency",
  editorial: "visual metaphor; history/abstract topics",
  whiteboard: "marker sketch; pairs with draw-on animations",
};

const IMAGE_STYLE_CHOICES: readonly { value: string; note: string }[] =
  IMAGE_STYLES.map((value) => ({
    value,
    note: IMAGE_STYLE_NOTES[value] ?? value,
  }));

/**
 * Known BGM tags — keys of `MUSIC_PROMPTS`
 * (packages/audio-assets/src/minimax-music.ts), so a new prompt preset
 * extends the question without a code change. `none` (→ `bgm: null`) is
 * appended last. Notes are the §5 envelope's presentation copy.
 */
const BGM_NOTES: Record<string, string> = {
  calm: "piano + strings, restrained; safe for any topic",
  epic: "massed strings + timpani; dramatic topics",
  guofeng: "Chinese folk orchestra; history/culture topics",
  "liubang-xiaodiao": "Han-dynasty folk motif; strong period flavor",
  "fanzhuan-march": "tension-building march; twist/reversal narratives",
};

const BGM_CHOICES: readonly { value: string; note: string }[] = [
  ...Object.keys(MUSIC_PROMPTS).map((tag) => ({
    value: tag,
    note: BGM_NOTES[tag] ?? tag,
  })),
  { value: "none", note: "no BGM (bgm: null)" },
];

/** The five draft knobs worth asking about, stable order (§6). */
export const DRAFT_QUESTIONS: readonly AskQuestion[] = [
  {
    id: "lang",
    flag: "--lang",
    type: "choice",
    question: "Narration language?",
    choices: [
      { value: "zh-CN", note: "Chinese narration (repo default)" },
      { value: "en-US", note: "English narration" },
    ],
    default: "zh-CN",
    recommended: "zh-CN",
    why: "zh-CN is the silent default; a wrong guess costs a full regen (~4× one draft)",
    specified: (opts) => opts.lang !== undefined,
    resolved: (opts) => opts.lang ?? "zh-CN",
  },
  {
    id: "duration",
    flag: "--duration",
    type: "number",
    question: "Target length in seconds?",
    suggestions: [60, 90, 120, 180, 300],
    default: 180,
    recommended: 180,
    why: "storyboard scene count scales with duration",
    specified: (opts) => opts.duration !== undefined,
    resolved: (opts) => opts.duration ?? 180,
  },
  {
    id: "image_style",
    flag: "--image-style",
    type: "choice",
    question: "FLUX scene-image preset?",
    choices: [...IMAGE_STYLE_CHOICES],
    default: "flat-vector",
    recommended: "flat-vector",
    why: "editorial vs flat-vector is a taste call; neither is recoverable post-render",
    specified: (opts) => opts.imageStyle !== undefined,
    resolved: (opts) => opts.imageStyle ?? "flat-vector",
  },
  {
    id: "style",
    flag: "--style",
    type: "choice",
    question: "Storyboard visual theme?",
    choices: [...STYLE_CHOICES],
    default: "paper-light",
    recommended: "paper-light",
    why: "theme changes every scene",
    specified: (opts) => opts.style !== undefined,
    resolved: (opts) => opts.style ?? "paper-light",
  },
  {
    id: "bgm",
    flag: "--bgm",
    type: "choice",
    question: "Background music track?",
    choices: [...BGM_CHOICES],
    default: "calm",
    recommended: "calm",
    why: "BGM is generated per tag at make time; wrong mood is a paid re-render",
    specified: (opts) => opts.bgm !== undefined,
    dropped: (opts) => opts.noAudioPlan === true,
    resolved: (opts) => opts.bgm ?? "calm",
  },
];

/** Unspecified + not-dropped questions, stable order (§9: pure). */
export function questionsFor(opts: AskOpts): AskQuestion[] {
  return DRAFT_QUESTIONS.filter(
    (q) => !q.specified(opts) && !(q.dropped?.(opts) ?? false),
  );
}

// ─── Trigger precedence (§4) ─────────────────────────────────────────────────

export type AskTrigger = { mode: "force" } | { mode: "off" } | { mode: "auto" };

/**
 * §4 precedence: `--no-ask` → off; `VIDEO_ASK=off` → off;
 * `--ask` / `VIDEO_ASK=force` → force; else auto. An unknown
 * `VIDEO_ASK` value prints one stderr warning and is treated as auto.
 */
export function resolveAskTrigger(
  opts: Pick<AskOpts, "ask" | "noAsk">,
  env: Record<string, string | undefined> = process.env,
): AskTrigger {
  if (opts.noAsk === true) return { mode: "off" };
  const value = env["VIDEO_ASK"];
  if (value === "off") return { mode: "off" };
  if (opts.ask === true || value === "force") return { mode: "force" };
  if (value !== undefined) {
    console.error(
      `agent-ask: unknown VIDEO_ASK="${value}" — treated as auto (expected off or force)`,
    );
  }
  return { mode: "auto" };
}

// ─── Envelope emission (§5) ──────────────────────────────────────────────────

/** argv with leading node/script paths stripped so it starts at "draft". */
function commandEcho(argv: string[]): string[] {
  const i = argv.indexOf("draft");
  return i === -1 ? [...argv] : argv.slice(i);
}

/**
 * Prints the `video-ask/1` envelope to stdout (pure JSON, 2-space) and
 * the human hint to stderr (exact §5 strings). Returns 2 — the exit code
 * for "questions pending; run not started, nothing spent".
 */
export async function emitQuestionsDoc(
  opts: AskOpts,
  argv: string[],
): Promise<number> {
  const detected = detectAgentEnv();
  const asked = questionsFor(opts);
  const byId = new Map(DRAFT_QUESTIONS.map((q) => [q.id, q]));
  const envelope = {
    protocol: "video-ask/1",
    command: commandEcho(argv),
    detected: detected ? `${detected.harness} (${detected.via})` : null,
    questions: asked.map((q) => ({
      id: q.id,
      flag: q.flag,
      type: q.type,
      question: q.question,
      ...(q.suggestions
        ? { suggestions: q.suggestions }
        : { choices: q.choices }),
      default: q.default,
      recommended: q.recommended,
      why: q.why,
    })),
    resolved: {
      lang: byId.get("lang")?.resolved(opts) ?? "zh-CN",
      duration: byId.get("duration")?.resolved(opts) ?? 180,
      audience: opts.audience ?? "developers",
      image_style: byId.get("image_style")?.resolved(opts) ?? "flat-vector",
      style: byId.get("style")?.resolved(opts) ?? "paper-light",
      bgm: byId.get("bgm")?.resolved(opts) ?? "calm",
    },
  };
  console.log(JSON.stringify(envelope, null, 2));
  console.error(
    `agent-ask: ${asked.length} question(s) pending (exit 2 — run not started, nothing spent)`,
  );
  console.error(
    "  re-run with the flags above, or --no-ask to accept the defaults",
  );
  return 2;
}

/**
 * One gate call from runDraft (§4 wiring is ticket A2). Returns null
 * (= run normally) or an exit code (2). Never throws.
 */
export async function maybeAgentAsk(
  opts: AskOpts,
  argv: string[],
): Promise<number | null> {
  try {
    const trigger = resolveAskTrigger(opts);
    if (trigger.mode === "off") return null;
    const asked = questionsFor(opts);
    if (asked.length === 0) {
      if (trigger.mode === "force") {
        console.error("agent-ask: nothing to ask — all knobs explicit");
      }
      return null;
    }
    if (trigger.mode === "auto" && !detectAgentEnv()) return null;
    return await emitQuestionsDoc(opts, argv);
  } catch {
    return null; // the gate must never take the run down (§9)
  }
}
