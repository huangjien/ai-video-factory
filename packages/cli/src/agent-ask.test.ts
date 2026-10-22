import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_QUESTIONS,
  detectAgentEnv,
  emitQuestionsDoc,
  maybeAgentAsk,
  questionsFor,
  resolveAskTrigger,
  type AgentDetection,
  type AskOpts,
  type AskQuestion,
} from "./agent-ask.js";
import { THEMES, THEME_NAMES } from "@video/video-components";

/**
 * Tests for the `video-ask/1` agent-ask module (v0.7 plan §9–§11,
 * ticket A1). Everything is module-level: no fs, no providers. Env
 * access is injected through the `env` parameter; the two functions
 * that read `process.env` directly (emitQuestionsDoc / maybeAgentAsk)
 * are tested with vi.stubEnv.
 *
 * NOTE: `imageStyle` / `bgm` / `ask` / `noAsk` are not on DraftOptions
 * until tickets A2/A3 add them — the tests pass them via the module's
 * extended option type.
 */

/** Minimal base opts: every knob unspecified. */
function baseOpts(): AskOpts {
  return { topic: "鸿门宴" };
}

// Hermetic agent-env baseline (2026-10-16): tests asserting "no agent
// detected" must not inherit live harness markers from the enclosing
// session — e.g. OPENCODE_PID when vitest runs inside opencode, which
// made three "without agent env" tests fail. Tests that need a marker
// stub it explicitly; detectAgentEnv tests pass explicit env objects.
const DETECTOR_VARS = [
  "ZCODE_APP_VERSION",
  "CLAUDECODE",
  "OPENCODE_PID",
  "OMO_CODING_AGENT_DIR",
  "OMP_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
] as const;
beforeEach(() => {
  for (const v of DETECTOR_VARS) delete process.env[v];
});

/**
 * The suite itself runs inside an agent harness (this repo is developed
 * under zcode, which really exports ZCODE_APP_VERSION), so every test
 * that reaches `process.env` through emitQuestionsDoc / maybeAgentAsk
 * starts from a clean slate and stubs exactly what it declares.
 */
const AGENT_ENV_KEYS = [
  "ZCODE_APP_VERSION",
  "CLAUDECODE",
  "VIDEO_ASK_ENV",
  "VIDEO_ASK",
] as const;
let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedAgentEnv = {};
  for (const k of AGENT_ENV_KEYS) {
    savedAgentEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const k of AGENT_ENV_KEYS) {
    const v = savedAgentEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Detection (§7) ──────────────────────────────────────────────────────────

describe("detectAgentEnv", () => {
  it("detects zcode via ZCODE_APP_VERSION", () => {
    expect(detectAgentEnv({ ZCODE_APP_VERSION: "3.15.3" })).toEqual({
      harness: "zcode",
      via: "ZCODE_APP_VERSION",
    });
  });

  it("detects claude-code via CLAUDECODE", () => {
    expect(detectAgentEnv({ CLAUDECODE: "1" })).toEqual({
      harness: "claude-code",
      via: "CLAUDECODE",
    });
  });

  it("detects oh-my-openagent via OMO_CODING_AGENT_DIR (verified in installed 5.1.30 source, A6)", () => {
    expect(detectAgentEnv({ OMO_CODING_AGENT_DIR: "/home/u/.omp" })).toEqual({
      harness: "oh-my-openagent",
      via: "OMO_CODING_AGENT_DIR",
    });
  });

  it("detects oh-my-pi via OMP_CODING_AGENT_DIR (documented-upstream row, A6)", () => {
    expect(detectAgentEnv({ OMP_CODING_AGENT_DIR: "/home/u/.omp" })).toEqual({
      harness: "oh-my-pi",
      via: "OMP_CODING_AGENT_DIR",
    });
  });

  it("detects pi via the deprecated-fallback PI_CODING_AGENT_DIR (A6)", () => {
    expect(detectAgentEnv({ PI_CODING_AGENT_DIR: "/home/u/.pi" })).toEqual({
      harness: "pi",
      via: "PI_CODING_AGENT_DIR",
    });
  });

  it("detects opencode via the runtime-set OPENCODE_PID marker (re-verified 2026-10-16)", () => {
    expect(detectAgentEnv({ OPENCODE_PID: "61981" })).toEqual({
      harness: "opencode",
      via: "OPENCODE_PID",
    });
    // OPENCODE=1 is set alongside it; either alone proves an opencode child.
    expect(
      detectAgentEnv({ OPENCODE: "1", OPENCODE_PID: "61981" })?.harness,
    ).toBe("opencode");
  });

  it("does not fire on opencode user-config overrides (OPENCODE_PID is the only stable marker)", () => {
    expect(detectAgentEnv({ OPENCODE_API_KEY: "x" })).toBeNull();
  });

  it("first table match wins", () => {
    const det = detectAgentEnv({
      ZCODE_APP_VERSION: "3.15.3",
      CLAUDECODE: "1",
    });
    expect(det?.harness).toBe("zcode");
  });

  it("returns null when nothing matches", () => {
    expect(detectAgentEnv({})).toBeNull();
    expect(detectAgentEnv({ VIDEO_ASK: "force" })).toBeNull();
  });

  it("VIDEO_ASK_ENV matches on presence", () => {
    expect(
      detectAgentEnv({ VIDEO_ASK_ENV: "AGENTX", AGENTX: "anything" }),
    ).toEqual({
      harness: "env",
      via: "VIDEO_ASK_ENV",
    });
  });

  it("VIDEO_ASK_ENV matches VAR=VALUE exactly", () => {
    expect(detectAgentEnv({ VIDEO_ASK_ENV: "AGENTX=1", AGENTX: "1" })).toEqual({
      harness: "env",
      via: "VIDEO_ASK_ENV",
    });
    expect(
      detectAgentEnv({ VIDEO_ASK_ENV: "AGENTX=1", AGENTX: "2" }),
    ).toBeNull();
    // Partial match is not exact.
    expect(
      detectAgentEnv({ VIDEO_ASK_ENV: "AGENTX=1", AGENTX: "1x" }),
    ).toBeNull();
    expect(detectAgentEnv({ VIDEO_ASK_ENV: "AGENTX=1" })).toBeNull();
  });

  it("VIDEO_ASK_ENV parses a comma list; first entry that matches wins", () => {
    expect(
      detectAgentEnv({ VIDEO_ASK_ENV: "NOPE,ALSO_NOPE,PRESENT", PRESENT: "1" }),
    ).toEqual({ harness: "env", via: "VIDEO_ASK_ENV" });
  });

  it("the table is consulted before VIDEO_ASK_ENV", () => {
    expect(
      detectAgentEnv({
        VIDEO_ASK_ENV: "ZCODE_APP_VERSION",
        ZCODE_APP_VERSION: "9",
      }),
    ).toEqual({ harness: "zcode", via: "ZCODE_APP_VERSION" });
  });
});

// ─── Question set (§5 / §6) ─────────────────────────────────────────────────

describe("DRAFT_QUESTIONS", () => {
  it("asks the documented knobs in stable order", () => {
    // Order is the §6 contract: narration, then pacing, then look, then
    // provider, then motion, then audio.
    expect(DRAFT_QUESTIONS.map((q) => q.id)).toEqual([
      "lang",
      "duration",
      "image_style",
      "image_provider",
      "style",
      "bgm",
    ]);
  });

  it("image_provider choices mirror the --image-provider value list", () => {
    const provider = DRAFT_QUESTIONS.find(
      (q) => q.id === "image_provider",
    ) as AskQuestion;
    expect(provider.flag).toBe("--image-provider");
    expect(provider.type).toBe("choice");
    expect(provider.choices?.map((c) => c.value)).toEqual([
      "minimax",
      "openai",
      "gemini",
      "mock",
      "none",
    ]);
    for (const c of provider.choices ?? []) {
      expect(c.note.length).toBeGreaterThan(0);
      expect(c.note).not.toBe(c.value);
    }
  });

  it("style choices are generated from the THEMES registry", () => {
    const style = DRAFT_QUESTIONS.find((q) => q.id === "style") as AskQuestion;
    expect(style.choices?.map((c) => c.value)).toEqual(THEME_NAMES);
    expect(THEME_NAMES).toContain("paper-light");
    // Every theme carries a one-line note.
    for (const c of style.choices ?? []) {
      expect(typeof c.note).toBe("string");
      expect(c.note.length).toBeGreaterThan(0);
      expect(c.note).not.toBe(c.value);
    }
  });

  // The shortlist is drawn from the curated library. It used to list the
  // MiniMax generation prompts (calm/epic/guofeng/…), which are not files —
  // every option pointed at a track that did not exist.
  it("bgm choices are library tags + none", () => {
    const bgm = DRAFT_QUESTIONS.find((q) => q.id === "bgm") as AskQuestion;
    // Shortlist of three mood-distinct tags plus `none`. The actual
    // roster is `BGM_DEFAULT_TAG` (light-gravity) plus two contrasting
    // tracks from `assets/bgm/`. When the catalogue grows or shrinks
    // this test enforces that BGM_SHORTLIST picks only real tags.
    expect(bgm.choices?.map((c) => c.value)).toEqual([
      "light-gravity",
      "classical-gymnopedie-no-3",
      "rock-not-the-only-one",
      "none",
    ]);
  });

  it("lang choices and texts match the §5 contract verbatim", () => {
    const lang = DRAFT_QUESTIONS.find((q) => q.id === "lang") as AskQuestion;
    expect(lang.flag).toBe("--lang");
    expect(lang.type).toBe("choice");
    expect(lang.question).toBe("Narration language?");
    expect(lang.choices).toEqual([
      { value: "zh-CN", note: "Chinese narration (repo default)" },
      { value: "en-US", note: "English narration" },
    ]);
    expect(lang.default).toBe("zh-CN");
    expect(lang.recommended).toBe("zh-CN");
    expect(lang.why).toBe(
      "zh-CN is the silent default; a wrong guess costs a full regen (~4× one draft)",
    );
  });

  it("duration question matches the §5 contract", () => {
    const duration = DRAFT_QUESTIONS.find(
      (q) => q.id === "duration",
    ) as AskQuestion;
    expect(duration.flag).toBe("--duration");
    expect(duration.type).toBe("number");
    expect(duration.suggestions).toEqual([60, 90, 120, 180, 300]);
    expect(duration.default).toBe(180);
    expect(duration.recommended).toBe(180);
    expect(duration.why).toBe("storyboard scene count scales with duration");
  });

  it("bgm dropped when --no-audio-plan", () => {
    const bgm = DRAFT_QUESTIONS.find((q) => q.id === "bgm") as AskQuestion;
    expect(bgm.dropped?.({ topic: "t", noAudioPlan: true })).toBe(true);
    expect(bgm.dropped?.({ topic: "t" })).toBeFalsy();
  });
});

// ─── questionsFor ────────────────────────────────────────────────────────────

describe("questionsFor", () => {
  it("returns every question when nothing is specified", () => {
    expect(questionsFor(baseOpts()).map((q) => q.id)).toEqual(
      DRAFT_QUESTIONS.map((q) => q.id),
    );
  });

  it("drops each knob passed explicitly", () => {
    const ids = (opts: Parameters<typeof questionsFor>[0]) =>
      questionsFor(opts).map((q) => q.id);
    const all = DRAFT_QUESTIONS.map((q) => q.id);
    // Each knob, when passed, removes exactly itself and nothing else.
    // Question ids are snake_case; the DraftOptions keys are camelCase,
    // so the pairing is explicit rather than inferred.
    const knobs = [
      ["lang", { lang: "en-US" }],
      ["duration", { duration: 90 }],
      ["image_style", { imageStyle: "editorial" }],
      ["image_provider", { imageProvider: "gemini" }],
      ["style", { style: "dark-tech" }],
      ["bgm", { bgm: "guofeng" }],
    ] as const;
    for (const [id, knob] of knobs) {
      expect(ids({ topic: "t", ...knob })).toEqual(
        all.filter((other) => other !== id),
      );
    }
  });

  it("every knob explicit → empty set", () => {
    expect(
      questionsFor({
        topic: "t",
        lang: "zh-CN",
        duration: 120,
        imageStyle: "flat-vector",
        imageProvider: "minimax",
        style: "paper-light",
        bgm: "light-gravity",
      }),
    ).toEqual([]);
  });

  it("--no-audio-plan drops the bgm question", () => {
    expect(
      questionsFor({ topic: "t", noAudioPlan: true }).map((q) => q.id),
    ).toEqual(["lang", "duration", "image_style", "image_provider", "style"]);
  });

  it("is pure: same input → same output, no env reads", () => {
    const a = questionsFor(baseOpts());
    const b = questionsFor(baseOpts());
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });
});

// ─── Trigger precedence (§4) ─────────────────────────────────────────────────

describe("resolveAskTrigger", () => {
  it("defaults to auto", () => {
    expect(resolveAskTrigger({}, {})).toEqual({ mode: "auto" });
  });

  it("--no-ask → off (beats everything)", () => {
    expect(
      resolveAskTrigger({ noAsk: true, ask: true }, { VIDEO_ASK: "force" }),
    ).toEqual({
      mode: "off",
    });
  });

  it("VIDEO_ASK=off → off", () => {
    expect(resolveAskTrigger({}, { VIDEO_ASK: "off" })).toEqual({
      mode: "off",
    });
  });

  it("--ask → force even without detection", () => {
    expect(resolveAskTrigger({ ask: true }, {})).toEqual({ mode: "force" });
  });

  it("VIDEO_ASK=force → force", () => {
    expect(resolveAskTrigger({}, { VIDEO_ASK: "force" })).toEqual({
      mode: "force",
    });
  });

  it("unknown VIDEO_ASK value → stderr warning + auto", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveAskTrigger({}, { VIDEO_ASK: "yes" })).toEqual({
      mode: "auto",
    });
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toContain("VIDEO_ASK");
    expect(err.mock.calls[0]?.[0]).toContain("yes");
  });

  it("VIDEO_ASK=off wins over --ask (spec order: --no-ask, then off)", () => {
    expect(resolveAskTrigger({ ask: true }, { VIDEO_ASK: "off" })).toEqual({
      mode: "off",
    });
  });
});

// ─── Envelope (§5) ───────────────────────────────────────────────────────────

describe("emitQuestionsDoc", () => {
  /** Capture console.log (stdout JSON) and console.error (hints). */
  function capture() {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    return {
      get stdout(): string {
        return log.mock.calls.map((c) => c.join(" ")).join("\n");
      },
      get stderr(): string[] {
        return err.mock.calls.map((c) => c.join(" "));
      },
    };
  }

  it("emits the full video-ask/1 envelope (snapshot)", async () => {
    vi.stubEnv("ZCODE_APP_VERSION", "3.15.3");
    const cap = capture();
    const code = await emitQuestionsDoc(baseOpts(), [
      "node",
      "/repo/cli.js",
      "draft",
      "鸿门宴",
    ]);
    expect(code).toBe(2);
    const envelope = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(envelope).toMatchSnapshot();
    const asked = (envelope["questions"] as unknown[]).length;
    expect(cap.stderr).toEqual([
      `agent-ask: ${asked} question(s) pending (exit 2 — run not started, nothing spent)`,
      "  re-run with the flags above, or --no-ask to accept the defaults",
    ]);
  });

  it("envelope field order matches the contract", async () => {
    vi.stubEnv("ZCODE_APP_VERSION", "3.15.3");
    const cap = capture();
    await emitQuestionsDoc(baseOpts(), ["draft", "t"]);
    const envelope = JSON.parse(cap.stdout) as {
      protocol: string;
      command: string[];
      detected: string;
      questions: {
        id: string;
        flag: string;
        type: string;
        question: string;
        default: string | number;
        recommended: string | number;
        why: string;
      }[];
      resolved: Record<string, string | number>;
    };
    expect(Object.keys(envelope)).toEqual([
      "protocol",
      "command",
      "detected",
      "questions",
      "resolved",
    ]);
    expect(envelope.protocol).toBe("video-ask/1");
    expect(envelope.command).toEqual(["draft", "t"]);
    expect(envelope.detected).toBe("zcode (ZCODE_APP_VERSION)");
    expect(envelope.questions.map((q) => q.id)).toEqual(
      DRAFT_QUESTIONS.map((q) => q.id),
    );
    for (const q of envelope.questions) {
      expect(Object.keys(q)).toEqual([
        "id",
        "flag",
        "type",
        "question",
        ...(q.id === "duration" ? ["suggestions"] : ["choices"]),
        "default",
        "recommended",
        "why",
      ]);
    }
    expect(envelope.resolved).toEqual({
      lang: "zh-CN",
      duration: 180,
      audience: "developers",
      image_style: "flat-vector",
      image_provider: "minimax",
      style: "paper-light",
      bgm: "light-gravity",
      tts: "minimax-system",
    });
  });

  it("resolved echoes explicit values; audience never asked but always resolved", async () => {
    const cap = capture();
    await emitQuestionsDoc(
      {
        topic: "t",
        lang: "en-US",
        audience: "ops",
        duration: 90,
        imageProvider: "openai",
      },
      ["draft", "t"],
    );
    const envelope = JSON.parse(cap.stdout) as {
      resolved: Record<string, unknown>;
    };
    expect(envelope.resolved).toEqual({
      lang: "en-US",
      duration: 90,
      audience: "ops",
      image_style: "flat-vector",
      image_provider: "openai",
      style: "paper-light",
      bgm: "light-gravity",
      tts: "minimax-system",
    });
  });

  it("command echo strips leading node/script paths", async () => {
    const cap = capture();
    await emitQuestionsDoc(baseOpts(), [
      "/usr/local/bin/video",
      "draft",
      "x y",
      "--ask",
    ]);
    const envelope = JSON.parse(cap.stdout) as { command: string[] };
    expect(envelope.command).toEqual(["draft", "x y", "--ask"]);
  });

  it("--ask without agent env → detected: null", async () => {
    const cap = capture();
    await emitQuestionsDoc({ topic: "t", ask: true }, ["draft", "t"]);
    const envelope = JSON.parse(cap.stdout) as { detected: string | null };
    expect(envelope.detected).toBeNull();
  });

  it("--no-audio-plan omits bgm from questions (resolved keeps it)", async () => {
    const cap = capture();
    await emitQuestionsDoc({ topic: "t", noAudioPlan: true }, ["draft", "t"]);
    const envelope = JSON.parse(cap.stdout) as {
      questions: { id: string }[];
      resolved: Record<string, unknown>;
    };
    expect(envelope.questions.map((q) => q.id)).not.toContain("bgm");
    expect(envelope.resolved).toHaveProperty("bgm");
  });
});

// ─── maybeAgentAsk (§4 composition) ──────────────────────────────────────────

describe("maybeAgentAsk", () => {
  function capture() {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    return {
      get stdout(): string {
        return log.mock.calls.map((c) => c.join(" ")).join("\n");
      },
      get stderr(): string[] {
        return err.mock.calls.map((c) => c.join(" "));
      },
    };
  }

  it("auto + agent env + unspecified knob → exit 2", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    const cap = capture();
    const code = await maybeAgentAsk(baseOpts(), ["draft", "t"]);
    expect(code).toBe(2);
    const envelope = JSON.parse(cap.stdout) as { detected: string | null };
    expect(envelope.detected).toBe("claude-code (CLAUDECODE)");
  });

  it("auto + no agent env → null (run normally), no output", async () => {
    const cap = capture();
    expect(await maybeAgentAsk(baseOpts(), ["draft", "t"])).toBeNull();
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toEqual([]);
  });

  it("auto + agent env + all knobs explicit → null (normal run)", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    const cap = capture();
    expect(
      await maybeAgentAsk(
        {
          topic: "t",
          lang: "zh-CN",
          duration: 120,
          imageStyle: "editorial",
          imageProvider: "gemini",
          style: "dark-tech",
          bgm: "guofeng",
        },
        ["draft", "t"],
      ),
    ).toBeNull();
    expect(cap.stdout).toBe("");
  });

  it("--no-ask under agent env → null, no output", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    const cap = capture();
    expect(
      await maybeAgentAsk({ topic: "t", noAsk: true }, ["draft", "t"]),
    ).toBeNull();
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toEqual([]);
  });

  it("VIDEO_ASK=off under agent env → null", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("VIDEO_ASK", "off");
    expect(await maybeAgentAsk(baseOpts(), ["draft", "t"])).toBeNull();
  });

  it("--ask without agent env → questions emitted, detected null", async () => {
    const cap = capture();
    const code = await maybeAgentAsk({ topic: "t", ask: true }, ["draft", "t"]);
    expect(code).toBe(2);
    const envelope = JSON.parse(cap.stdout) as { detected: string | null };
    expect(envelope.detected).toBeNull();
  });

  it("VIDEO_ASK=force without agent env → questions emitted", async () => {
    vi.stubEnv("VIDEO_ASK", "force");
    const cap = capture();
    expect(await maybeAgentAsk(baseOpts(), ["draft", "t"])).toBe(2);
    expect(JSON.parse(cap.stdout)).toHaveProperty("protocol", "video-ask/1");
  });

  it("force with nothing to ask → stderr line, null", async () => {
    vi.stubEnv("VIDEO_ASK", "force");
    const cap = capture();
    expect(
      await maybeAgentAsk(
        {
          topic: "t",
          lang: "zh-CN",
          duration: 120,
          imageStyle: "editorial",
          imageProvider: "gemini",
          style: "dark-tech",
          bgm: "guofeng",
        },
        ["draft", "t"],
      ),
    ).toBeNull();
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toEqual([
      "agent-ask: nothing to ask — all knobs explicit",
    ]);
  });

  it("unknown VIDEO_ASK + agent env → treated as auto (asks)", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("VIDEO_ASK", "pleeease");
    const cap = capture();
    expect(await maybeAgentAsk(baseOpts(), ["draft", "t"])).toBe(2);
    expect(cap.stderr.some((l) => l.includes("VIDEO_ASK"))).toBe(true);
  });

  it("never throws (garbage env, odd argv)", async () => {
    const cap = capture();
    await expect(
      maybeAgentAsk({ topic: "t", ask: true }, []),
    ).resolves.not.toBeNull();
    expect(cap.stdout.length).toBeGreaterThan(0);
  });
});

// ─── detection type smoke ────────────────────────────────────────────────────

describe("AgentDetection", () => {
  it("exposes harness + via", () => {
    const det: AgentDetection = { harness: "zcode", via: "ZCODE_APP_VERSION" };
    expect(`${det.harness} (${det.via})`).toBe("zcode (ZCODE_APP_VERSION)");
  });
});
