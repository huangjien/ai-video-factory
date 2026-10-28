import { BGM_DEFAULT_TAG, loadBgmCatalogue } from "@video/prompts";
import { IMAGE_STYLES } from "@video/draft";
import { DEFAULT_THEME_NAME, THEME_NAMES, THEME_META } from "@video/theme";
import type { DraftOptions } from "./draft-command.js";

/**
 * `video-ask/1` — agent-aware draft questions (v0.7 plan, ticket A1).
 *
 * Design source: `docs/v0.7-agent-ask-protocol-plan.md` (binding). This
 * module is PURE: no fs, no I/O beyond the two stdout/stderr emitters at
 * the bottom. Registry imports (`IMAGE_STYLES`, the BGM catalogue,
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

/** Harness detectors, most specific first. First match wins.
 *  A6 (2026-10-15, verified against the locally installed packages):
 *  - oh-my-openagent 5.1.30 (`~/.omp`) resolves its agent home from
 *    AGENT_DIR_ENV_NAMES = [`OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR`,
 *    `PI_CODING_AGENT_DIR`] — OMO_ is its own prefix.
 *  - oh-my-pi (can1357 fork) migrates `PI_` → `OMP_` and keeps `PI_` as a
 *    deprecated fallback (#8804). Not installed locally — docs only.
 *  - plain pi (@earendil-works/pi-coding-agent 1.1.0, verified by grepping
 *    the installed bundle) sets NO self-identification marker; its #2868
 *    is still open. The PI_ row only fires for fork users; pi sessions
 *    are detectable via the OMO_ row when launched through
 *    oh-my-openagent, else VIDEO_ASK_ENV.
 *  - opencode (re-verified 2026-10-16 in a live opencode bash session,
 *    fixing the stale A6 note): the runtime exports OPENCODE=1 and
 *    OPENCODE_PID=<server pid> to child processes. Both are runtime-set,
 *    not user-config overrides like the other OPENCODE_* names — so
 *    OPENCODE_PID (specific, numeric) is the detector row. */
const DETECTORS: readonly AgentDetection[] = [
  { harness: "zcode", via: "ZCODE_APP_VERSION" },
  { harness: "claude-code", via: "CLAUDECODE" },
  { harness: "opencode", via: "OPENCODE_PID" },
  { harness: "oh-my-openagent", via: "OMO_CODING_AGENT_DIR" },
  { harness: "oh-my-pi", via: "OMP_CODING_AGENT_DIR" },
  { harness: "pi", via: "PI_CODING_AGENT_DIR" },
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
 * Scene-image style presets — values derive from `IMAGE_STYLES`
 * (@video/draft, landed with v0.6) so a new preset extends the question
 * without a code change. Notes are the §5 envelope's presentation copy,
 * keyed by value; an unnoted preset falls back to its key.
 */
const IMAGE_STYLE_NOTES: Record<string, string> = {
  "flat-vector": "clean geometry; best cross-scene consistency",
  photoreal: "strong subject fidelity; people, products, real settings",
  watercolor: "painterly landscapes; foreground people stay readable",
  "ink-wash": "poetic atmosphere; figures remain clearly visible",
  "clay-3d": "playful stop-motion; stylized people and objects",
  manga: "dramatic ink and screentone; action and character scenes",
  "genki-anime": "bright 2D character scenes; upbeat explainers",
  medieval: "period history; illuminated look without lettering",
  editorial: "visual metaphor; history/abstract topics",
  whiteboard: "marker sketch; pairs with draw-on animations",
  isometric: "fixed axonometric view; systems and processes",
  "paper-cut": "layered tactile collage; narrative scenes",
  gongbi: "restrained ink linework, low-saturation washes; historical scenes",
  terminal:
    "dark CRT console with phosphor-green and cyan glow; code/CLI environments",
};

const IMAGE_STYLE_CHOICES: readonly { value: string; note: string }[] =
  IMAGE_STYLES.map((value) => ({
    value,
    note: IMAGE_STYLE_NOTES[value] ?? value,
  }));

/**
 * Scene-image providers — the exact `--image-provider` value list, so
 * adding a provider extends the question without a code change. Kept in
 * sync with `resolveImageProvider` in @video/make.
 */
const IMAGE_PROVIDER_NOTES: Record<string, string> = {
  minimax: "image-01; seconds per scene; needs MINIMAX_API_KEY",
  openai: "gpt-image-2.5-flare; needs OPENAI_API_KEY",
  gemini: "gemini-3.1-flash-image; needs GEMINI_API_KEY",
  mock: "deterministic placeholders; no API key, not shippable",
  none: "skip image generation; scenes render as vector shapes",
};

const IMAGE_PROVIDER_CHOICES: readonly { value: string; note: string }[] = (
  ["minimax", "openai", "gemini", "mock", "none"] as const
).map((value) => ({
  value,
  note: IMAGE_PROVIDER_NOTES[value] ?? value,
}));

/**
 * Shortlist of BGM tracks for the question, drawn from the curated library
 * (`music.json` / `assets/bgm/`). NOT the whole catalogue: a question with
 * 18 choices is unusable, and the audio planner picks from the full list
 * whenever the user does not answer here.
 *
 * These used to be MiniMax *generation prompts* — `calm`, `epic`,
 * `guofeng`. Those tags no longer exist as files, so every option this
 * question offered pointed at nothing.
 */
const BGM_SHORTLIST = [
  BGM_DEFAULT_TAG,
  "classical-gymnopedie-no-3",
  "rock-not-the-only-one",
] as const;

const BGM_CHOICES: readonly { value: string; note: string }[] = [
  ...BGM_SHORTLIST.map((tag) => {
    const entry = loadBgmCatalogue()[tag];
    return {
      value: tag,
      note: entry
        ? `${entry.track} — ${entry.use_when.split(";")[0] ?? entry.use_when}`
        : tag,
    };
  }),
  { value: "none", note: "no BGM (bgm: null)" },
];

const BGM_DEFAULT = BGM_DEFAULT_TAG;

/** The six draft knobs worth asking about, stable order (§6). */
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
    question: "Scene-image style preset?",
    choices: [...IMAGE_STYLE_CHOICES],
    default: "flat-vector",
    recommended: "flat-vector",
    why: "style is a taste call and cannot be changed after rendering",
    specified: (opts) => opts.imageStyle !== undefined,
    resolved: (opts) => opts.imageStyle ?? "flat-vector",
  },
  {
    id: "image_provider",
    flag: "--image-provider",
    type: "choice",
    question: "Scene-image provider?",
    choices: [...IMAGE_PROVIDER_CHOICES],
    default: "minimax",
    recommended: "minimax",
    why: "the provider decides both cost and visual character; every scene image is re-spent when it changes",
    specified: (opts) => opts.imageProvider !== undefined,
    resolved: (opts) => opts.imageProvider ?? "minimax",
  },
  {
    id: "style",
    flag: "--style",
    type: "choice",
    question: "Storyboard visual theme?",
    choices: [...STYLE_CHOICES],
    default: DEFAULT_THEME_NAME,
    recommended: DEFAULT_THEME_NAME,
    why: "theme changes every scene",
    specified: (opts) => opts.style !== undefined,
    resolved: (opts) => opts.style ?? DEFAULT_THEME_NAME,
  },
  {
    id: "bgm",
    flag: "--bgm",
    type: "choice",
    question: "Background music track?",
    choices: [...BGM_CHOICES],
    default: BGM_DEFAULT,
    recommended: BGM_DEFAULT,
    why: "picked from the local library in assets/bgm/ — no generation cost, but the wrong mood still re-renders every scene",
    specified: (opts) => opts.bgm !== undefined,
    dropped: (opts) => opts.noAudioPlan === true,
    resolved: (opts) => opts.bgm ?? BGM_DEFAULT,
  },
];

/** Runtime context for conditionally-asked questions. The voicebox probe
 * itself lives in draft-command (this module stays I/O-free); a healthy
 * server with cloned profiles is what makes the tts question appear. */
export interface AskCtx {
  voiceboxProfiles: string[];
}

/** Narration backend question — offered only when the local voicebox
 * server is up and has at least one cloned profile (the caller's probe
 * decided that). Down server ⇒ no question, resolved default
 * "minimax-system". */
export function ttsQuestion(profiles: readonly string[]): AskQuestion {
  return {
    id: "tts",
    flag: "--tts",
    type: "choice",
    question: "Narration voice backend?",
    choices: [
      {
        value: "minimax-system",
        note: "MiniMax system voice, speech-2.8-hd — best quality, ~0.2× realtime, billed per char",
      },
      ...profiles.map((p) => ({
        value: `voicebox:${p}`,
        note: `local clone "${p}" — free, ~7× slower than realtime`,
      })),
    ],
    default: "minimax-system",
    // MiniMax is the recommended default everywhere (2026-10-28): an
    // A/B of seven backends on the same script put speech-2.8-hd ahead
    // on both quality and speed, and the local clone's prosody came last.
    recommended: "minimax-system",
    why: "switching later re-synthesizes every scene; the clone is free but slower and measurably flatter",
    specified: (opts) => opts.tts !== undefined,
    resolved: (opts) => opts.tts ?? "minimax-system",
  };
}

/** Unspecified + not-dropped questions, stable order (§9: pure). The
 * conditional tts question (AskCtx) is appended after bgm when the probe
 * found a healthy voicebox with cloned profiles. */
export function questionsFor(opts: AskOpts, ctx?: AskCtx): AskQuestion[] {
  const base = DRAFT_QUESTIONS.filter(
    (q) => !q.specified(opts) && !(q.dropped?.(opts) ?? false),
  );
  if (
    ctx !== undefined &&
    ctx.voiceboxProfiles.length > 0 &&
    opts.tts === undefined
  ) {
    base.push(ttsQuestion(ctx.voiceboxProfiles));
  }
  return base;
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
  ctx?: AskCtx,
): Promise<number> {
  const detected = detectAgentEnv();
  const asked = questionsFor(opts, ctx);
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
      image_provider: byId.get("image_provider")?.resolved(opts) ?? "minimax",
      style: byId.get("style")?.resolved(opts) ?? DEFAULT_THEME_NAME,
      bgm: byId.get("bgm")?.resolved(opts) ?? "calm",
      tts:
        opts.tts ??
        "minimax-system",
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
  ctx?: AskCtx,
): Promise<number | null> {
  try {
    const trigger = resolveAskTrigger(opts);
    if (trigger.mode === "off") return null;
    const asked = questionsFor(opts, ctx);
    if (asked.length === 0) {
      if (trigger.mode === "force") {
        console.error("agent-ask: nothing to ask — all knobs explicit");
      }
      return null;
    }
    if (trigger.mode === "auto" && !detectAgentEnv()) return null;
    return await emitQuestionsDoc(opts, argv, ctx);
  } catch {
    return null; // the gate must never take the run down (§9)
  }
}
