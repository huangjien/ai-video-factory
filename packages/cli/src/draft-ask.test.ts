import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Command } from "commander";
import { DRAFT_QUESTIONS } from "./agent-ask.js";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderAudioConfig, type AudioConfig } from "@video/audio-plan";
import {
  runDraft,
  registerDraft,
  draftCliOptsToDraftOptions,
} from "./draft-command.js";

/**
 * runDraft-level tests for the `video-ask/1` ask gate (v0.7 plan §11
 * items 1–5, ticket A2). The envelope shape itself is A1's suite
 * (agent-ask.test.ts); here the contract is about POSITION: the exit-2
 * path must precede project resolution, provider construction, and web
 * search — zero spend, zero files.
 *
 * `@video/research` / `@video/llm` are mocked so proceed-paths never
 * touch the network. The suite runs inside an agent harness (this repo
 * is developed under zcode, which really exports ZCODE_APP_VERSION), so
 * the agent env vars are saved/deleted around every test (same hygiene
 * as agent-ask.test.ts) and each test stubs exactly what it declares.
 */

const DRAFT_JSON = {
  title: "演示文章",
  hook: "开场一句话。",
  sections: [{ heading: "问题", body: "正文内容。" }],
  scenes: [
    {
      id: "scene_1",
      duration: 6,
      caption: "一",
      visual: "图标",
      narration: "第一场旁白。",
    },
  ],
};

const chatMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn(async () => []));
const callAudioPlanMock = vi.hoisted(() => vi.fn());
/** Provider-construction log — the gate test asserts it stays empty. */
const constructed = vi.hoisted(() => [] as string[]);

vi.mock("@video/audio-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/audio-plan")>();
  return { ...actual, callAudioPlan: callAudioPlanMock };
});

vi.mock("@video/research", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/research")>();
  return {
    ...actual,
    MiniMaxWebSearch: class {
      search = searchMock;
    },
  };
});

vi.mock("@video/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/llm")>();
  class FakeProvider {
    readonly name = "glm";
    chat = chatMock;
    constructor() {
      constructed.push("glm");
    }
  }
  return {
    ...actual,
    GLMProvider: FakeProvider,
    MiniMaxProvider: FakeProvider,
    // Fixed default shape (config.ts DEFAULT_CONFIG) — deterministic,
    // ignores any LL_CONFIG in the environment.
    loadProviderConfig: () => ({
      research: { primary: "glm", fallback: "minimax" },
      script: { primary: "minimax", fallback: "glm" },
      storyboard: { primary: "minimax", fallback: "glm" },
      visual: { primary: "minimax", fallback: "glm" },
      motion: { primary: "minimax", fallback: "glm" },
      review: { primary: "glm", fallback: "minimax" },
    }),
  };
});

/** Capture console so the envelope/hints are assertable and quiet. */
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

/** Cheap project fixture: resolveProjectDir only needs state.yaml. */
async function scaffoldProject(slug: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vf-draft-ask-"));
  const proj = path.join(root, "projects", slug);
  await mkdir(proj, { recursive: true });
  await writeFile(path.join(proj, "state.yaml"), `project: ${slug}\n`, "utf8");
  return root;
}

const AGENT_ENV_KEYS = [
  "ZCODE_APP_VERSION",
  "CLAUDECODE",
  "VIDEO_ASK_ENV",
  "VIDEO_ASK",
] as const;
let savedAgentEnv: Record<string, string | undefined> = {};
let tempRoots: string[] = [];

beforeEach(() => {
  savedAgentEnv = {};
  for (const k of AGENT_ENV_KEYS) {
    savedAgentEnv[k] = process.env[k];
    delete process.env[k];
  }
  chatMock.mockClear();
  chatMock.mockImplementation(async () => ({
    content: JSON.stringify(DRAFT_JSON),
    usage: { input: 5, output: 7 },
  }));
  searchMock.mockClear();
  // Fixed audio-plan answer (same trick as bgm-stamp.test.ts) so the
  // knob-explicit test can exercise the real --bgm stamping path.
  const audioPlanConfig: AudioConfig = {
    voice: "zh-CN-YunjianNeural",
    bgm: "calm",
    sfx: {},
  };
  callAudioPlanMock.mockReset();
  callAudioPlanMock.mockResolvedValue({
    config: audioPlanConfig,
    yaml: renderAudioConfig(audioPlanConfig),
    usage: { input: 3, output: 4 },
  });
  constructed.length = 0;
  tempRoots = [];
});

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  for (const k of AGENT_ENV_KEYS) {
    const v = savedAgentEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// ─── §11 item 1: agent env + unspecified knobs → exit 2, zero spend ─────────

describe("runDraft ask gate", () => {
  it("agent env + no style flags → exit 2 before project resolution, providers, or search", async () => {
    // Bare temp dir, NO scaffolded project: if the gate failed to fire
    // first, runDraft would fall through to resolveProjectDir and
    // return 1 — the expected 2 proves the gate runs before project
    // resolution. (spec §4 wiring position)
    const root = await mkdtemp(path.join(tmpdir(), "vf-draft-ask-gate-"));
    tempRoots.push(root);
    process.env["ZCODE_APP_VERSION"] = "1";
    const cap = capture();

    const code = await runDraft({ topic: "never-scaffolded", cwd: root });

    expect(code).toBe(2);
    // Zero fs writes in the temp tree.
    expect(await readdir(root)).toEqual([]);
    // Gate precedes spend: no search, no provider, no LLM call.
    expect(searchMock).not.toHaveBeenCalled();
    expect(constructed).toEqual([]);
    expect(chatMock).not.toHaveBeenCalled();
    // stdout is the pure video-ask/1 envelope (spec §5).
    const envelope = JSON.parse(cap.stdout) as {
      protocol: string;
      questions: unknown[];
    };
    expect(envelope.protocol).toBe("video-ask/1");
    expect(envelope.questions).toHaveLength(DRAFT_QUESTIONS.length);
    expect(cap.stderr[0]).toContain("agent-ask:");
  });
});

// ─── §11 items 2–4: suppressions and full-explicit runs proceed ─────────────

describe("runDraft ask gate — proceed paths", () => {
  /** Shared proceed assertions: gate silent, run reached the pipeline. */
  async function expectProceed(
    opts: Parameters<typeof runDraft>[0],
    root: string,
  ): Promise<void> {
    const cap = capture();
    const code = await runDraft(opts);
    expect(code).toBe(0);
    // The gate never fired: no envelope on stdout, no hint on stderr.
    expect(cap.stdout).not.toContain("video-ask/1");
    expect(cap.stderr.every((l) => !l.includes("agent-ask:"))).toBe(true);
    // First real spend step reached: web search ran.
    expect(searchMock).toHaveBeenCalledTimes(1);
    // The pipeline produced its artifacts in the scaffolded project.
    const projDir = path.join(root, "projects", opts.topic);
    const entries = await readdir(projDir);
    expect(entries).toContain("article.md");
  }

  it("VIDEO_ASK=off under agent env → proceeds (§11 item 3)", async () => {
    const root = await scaffoldProject("ask-off");
    tempRoots.push(root);
    process.env["ZCODE_APP_VERSION"] = "1";
    process.env["VIDEO_ASK"] = "off";
    await expectProceed(
      { topic: "ask-off", cwd: root, noReview: true, noAudioPlan: true },
      root,
    );
  });

  it("opts.noAsk (--no-ask) under agent env → proceeds (§11 item 3)", async () => {
    const root = await scaffoldProject("ask-noask");
    tempRoots.push(root);
    process.env["ZCODE_APP_VERSION"] = "1";
    await expectProceed(
      {
        topic: "ask-noask",
        cwd: root,
        noAsk: true,
        noReview: true,
        noAudioPlan: true,
      },
      root,
    );
  });

  it("every knob explicit under agent env → proceeds, no exit 2 (§11 item 2)", async () => {
    const root = await scaffoldProject("ask-explicit");
    tempRoots.push(root);
    process.env["ZCODE_APP_VERSION"] = "1";
    // All five askable knobs (lang, duration, image_style, style, bgm)
    // are explicit → questionsFor() is empty, the gate stays silent and
    // the run proceeds. bgm flows down the real audio-plan path: the
    // answer is stamped into audio-config.yaml (spec §11 items 2 + 6 in
    // one run — gate suppression and stamping coexist).
    await expectProceed(
      {
        topic: "ask-explicit",
        cwd: root,
        lang: "en-US",
        duration: 90,
        imageStyle: "editorial",
        imageProvider: "minimax",
        style: "dark-tech",
        bgm: "guofeng",
        noReview: true,
      },
      root,
    );
    const audioConfig = await readFile(
      path.join(root, "projects", "ask-explicit", "audio-config.yaml"),
      "utf8",
    );
    expect(audioConfig).toContain('bgm: "guofeng"');
  });

  it("human env + no flags → proceeds down today's path (§11 item 5 baseline)", async () => {
    const root = await scaffoldProject("ask-human");
    tempRoots.push(root);
    // beforeEach stripped every agent var — the auto trigger finds
    // nothing and must not fire even with all knobs unspecified.
    await expectProceed(
      { topic: "ask-human", cwd: root, noReview: true, noAudioPlan: true },
      root,
    );
  });
});

// ─── §10 A2: --ask / --no-ask registration ──────────────────────────────────

describe("registerDraft ask flags", () => {
  it("registers --ask and --no-ask", () => {
    const program = new Command();
    registerDraft(program);
    const draft = program.commands.find((c) => c.name() === "draft");
    const longs = (draft?.options ?? []).map((o) => o.long);
    expect(longs).toContain("--ask");
    expect(longs).toContain("--no-ask");
  });
});

// ─── §4 / §8 rule 6: commander opts → DraftOptions mapping (parse level) ────

describe("draftCliOptsToDraftOptions — --ask/--no-ask folding", () => {
  it("--no-ask: commander folds it into ask:false; the mapping turns that into noAsk", () => {
    // Parse-level proof that commander never produces a `noAsk` key —
    // `--no-ask` reaches the action as `{ ask: false }`. Asserting that
    // reality first keeps the mapping honest: a `opts.noAsk === true`
    // branch is dead code and `--no-ask` would be silently ignored.
    const program = new Command();
    registerDraft(program);
    const draft = program.commands.find((c) => c.name() === "draft");
    if (!draft) throw new Error("draft command not registered");
    draft.parseOptions(["e2e-check", "--no-ask"]);
    const cli = draft.opts() as Parameters<
      typeof draftCliOptsToDraftOptions
    >[0];
    // The fold itself: `ask === false`, and NO `noAsk` key exists.
    expect(cli.ask).toBe(false);
    expect("noAsk" in cli).toBe(false);

    const mapped = draftCliOptsToDraftOptions({ ask: false });
    expect(mapped).toMatchObject({ noAsk: true });
    expect(mapped.ask).toBeUndefined();
  });

  it("--ask stays ask:true; no flag → neither key (gate stays auto)", () => {
    const forced = draftCliOptsToDraftOptions({ ask: true });
    expect(forced).toMatchObject({ ask: true });
    expect("noAsk" in forced).toBe(false);
    const bare = draftCliOptsToDraftOptions({});
    expect("ask" in bare).toBe(false);
    expect("noAsk" in bare).toBe(false);
  });
});
