import path from "node:path";
import type { ChatMessage, Provider } from "@video/llm";
import {
  chatWithFallback,
  extractBalancedJson,
  GLMProvider,
  MiniMaxProvider,
} from "@video/llm";
import type { AgentInput } from "@video/agent-storyboard";
import {
  buildMessages as buildStoryboardMessages,
  callAgent as callStoryboardAgent,
} from "@video/agent-storyboard";
import type {
  DraftInput,
  ImageStyle,
  ScenePromptContext,
  ScenePromptInput,
} from "@video/draft";
import {
  buildArticleReviewMessages,
  buildMessages as buildDraftMessages,
  buildScenePromptMessages,
  callDraft,
  expandSceneBrief,
  resolveSceneIdentities,
  scoreArticle,
} from "@video/draft";
import { stringify as yamlStringify } from "yaml";
import {
  applyRecorded,
  buildEnvelope,
  evalSnapshotPath,
  evalsDir,
  listEvalAgents,
  listEvalCases,
  listSnapshotIds,
  loadEnvelope,
  loadPrompt,
  renderEnvelopeYaml,
  renderYaml,
  sha256OfMessages,
  type CaseEnvelope,
  type EvalCaseRef,
  type EvalExpectation,
} from "@video/prompts";

/**
 * Prompt eval runner — `video prompts eval`
 * (spec: docs/v0.10-prompt-evals-plan.md §4).
 *
 * Two layers:
 *
 *   Layer 1 — structural. `buildMessages(input)` for every fixture, fingerprinted
 *     into an envelope (roles + content hashes + context-block layout) and
 *     compared against the committed snapshot. Offline, deterministic, and the
 *     only layer CI runs: it catches an accidental prompt-body edit, a reordered
 *     context block, or a changed truncation limit before either reaches a render.
 *
 *   Layer 2 — judged. Opt-in via `--judge <provider>`. Sends the case's messages
 *     to the provider, scores the response against the case's rubric axes, and
 *     fails any case scoring below its axis `min`. Reuses the article-review
 *     judge pattern: anchored 0-10 axes, JSON-only reply, values coerced and
 *     clamped here, `total` computed by us and never read off the LLM.
 *
 * Report rows carry `prompt_hash` — the same lineage key a run record stamps —
 * so two runs can be diffed and a score delta attributed to an exact prompt edit.
 */

/** Rubric judge body — lives in the registry like every other prompt, so the
 *  judge is editable without touching this file. */
export const EVALS_JUDGE_SYSTEM_PROMPT = loadPrompt("evals-judge");

export interface EvalAgent {
  id: string;
  /** Layer 1 — pure, no provider call. */
  build(input: Record<string, unknown>): ChatMessage[];
  /** Layer 2 — the real agent call, so a judged run exercises the same path the
   *  pipeline takes rather than a re-implementation of it. */
  call(
    input: Record<string, unknown>,
    provider: Provider,
    fallback: Provider | null,
  ): Promise<{ output: string; providerName: string }>;
}

/**
 * Every agent the harness can evaluate. The fixture's `agent` field selects one;
 * adding a third agent is an entry here plus an `evals/<id>/` directory.
 */
/**
 * Fixture `input` is validated as a mapping in @video/prompts; the shape it
 * must satisfy is the agent's own `*Input` type. The cast is the one place
 * that boundary is crossed — an adapter is added per agent, so the wrong shape
 * shows up as a layer-1 snapshot diff, not as a silent bad prompt.
 */
function asAgentInput<T>(input: Record<string, unknown>): T {
  return input as unknown as T;
}

export const EVAL_AGENTS: Record<string, EvalAgent> = {
  draft: {
    id: "draft",
    build: (input) => buildDraftMessages(asAgentInput<DraftInput>(input)),
    call: async (input, provider, fallback) => {
      const result = await callDraft(
        asAgentInput<DraftInput>(input),
        provider,
        fallback,
      );
      return { output: result.markdown, providerName: result.providerName };
    },
  },
  "image-prompt": {
    id: "image-prompt",
    /** The fixture input is the whole per-case context: the scene plus the
     *  style/setting the article declares. A pure path — no cache, no sidecar
     *  writes — so the harness measures the prompt, not the filesystem. */
    build: (input) => buildImagePromptMessages(input),
    call: async (input, provider) => {
      const out = await expandSceneBrief(
        imagePromptScene(input),
        provider,
        imagePromptContext(input),
      );
      return { output: out.prompt, providerName: out.providerName };
    },
  },
  storyboard: {
    id: "storyboard",
    build: (input) => buildStoryboardMessages(asAgentInput<AgentInput>(input)),
    call: async (input, provider, fallback) => {
      const result = await callStoryboardAgent(
        asAgentInput<AgentInput>(input),
        provider,
        {},
        fallback,
      );
      return {
        output: yamlStringify(result.storyboard),
        providerName: result.providerName,
      };
    },
  },
  "article-review": {
    id: "article-review",
    /** Fixture input carries the article markdown the judge will score.
     *  Same shape as `buildArticleReviewMessages` already takes — layer-1
     *  hashing is a pure path, no I/O, no provider. */
    build: (input) => {
      const markdown = pickMarkdown(input);
      return buildArticleReviewMessages(markdown);
    },
    /** Layer-2 path: the agent under test IS the judge, so this is the
     *  one place `scoreArticle` runs against a real provider. The output
     *  is the rubric JSON; the layer-2 evaluator inspects that JSON. */
    call: async (input, provider, fallback) => {
      const markdown = pickMarkdown(input);
      const score = await scoreArticle(markdown, provider, fallback ?? null);
      return { output: JSON.stringify(score), providerName: provider.name };
    },
  },
};

function pickMarkdown(input: Record<string, unknown>): string {
  const m = input["markdown"];
  return typeof m === "string" ? m : "";
}

/** The image-prompt fixture shape: { scene, style?, learned?, setting?,
 *  characterRoot? }. */
function imagePromptScene(input: Record<string, unknown>): ScenePromptInput {
  return asAgentInput<ScenePromptInput>(
    input["scene"] as Record<string, unknown>,
  );
}

function imagePromptContext(
  input: Record<string, unknown>,
): ScenePromptContext {
  // The 关键视觉锚点 are resolved here, from the 角色圣经 the fixture points
  // at — the same way `expandScenePrompt` resolves them for a real render.
  // A fixture with no `characterRoot` resolves to no identities and the
  // harness stays a pure path.
  const characterRoot =
    typeof input["characterRoot"] === "string" ? input["characterRoot"] : null;
  return {
    ...(typeof input["style"] === "string"
      ? { style: input["style"] as ImageStyle }
      : {}),
    ...(typeof input["learned"] === "string"
      ? { learned: input["learned"] as string }
      : {}),
    ...(typeof input["setting"] === "string"
      ? { setting: input["setting"] as string }
      : {}),
    identities: resolveSceneIdentities(
      imagePromptScene(input).characters,
      characterRoot,
    ),
  };
}

function buildImagePromptMessages(input: Record<string, unknown>) {
  return buildScenePromptMessages(
    imagePromptScene(input),
    imagePromptContext(input),
  );
}

export function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported judge provider: ${name}`);
}

// ─── Layer 1: structural ─────────────────────────────────────────────────────

export type StructuralStatus =
  "pass" | "prompt-drift" | "layout-drift" | "missing-snapshot";

export interface StructuralResult {
  case: string;
  agent: string;
  status: StructuralStatus;
  /** One line naming what moved — the actionable half of the failure. */
  detail: string;
  promptHash: string;
}

/**
 * Compare a freshly built envelope against the committed snapshot. Hash drift
 * means a prompt body (or a truncation limit feeding one) changed; layout drift
 * means the same bodies were assembled in a different order or lost a context
 * block. Both are deliberate-edit events, not runtime failures.
 */
export function compareEnvelope(
  actual: CaseEnvelope,
  expected: CaseEnvelope | null,
): Pick<StructuralResult, "status" | "detail"> {
  if (!expected) {
    return {
      status: "missing-snapshot",
      detail: "no committed snapshot — re-run with --update-snapshots",
    };
  }
  if (actual.messages.length !== expected.messages.length) {
    return {
      status: "layout-drift",
      detail: `message count ${actual.messages.length} ≠ ${expected.messages.length}`,
    };
  }
  for (const [i, got] of actual.messages.entries()) {
    const want = expected.messages[i];
    if (!want) continue;
    if (got.role !== want.role) {
      return {
        status: "layout-drift",
        detail: `message ${i} role "${got.role}" ≠ "${want.role}"`,
      };
    }
    if (got.content_sha256 !== want.content_sha256) {
      return {
        status: "prompt-drift",
        detail: `message ${i} (${got.role}) body changed — prompt_hash ${actual.prompt_hash}`,
      };
    }
    if (JSON.stringify(got.blocks) !== JSON.stringify(want.blocks)) {
      return {
        status: "layout-drift",
        detail: `message ${i} (${got.role}) context blocks changed — now ${JSON.stringify(got.blocks)}, was ${JSON.stringify(want.blocks)}`,
      };
    }
  }
  return { status: "pass", detail: "" };
}

function agentAdapter(ref: EvalCaseRef): EvalAgent {
  const agent = EVAL_AGENTS[ref.agent];
  if (!agent) {
    throw new Error(
      `eval fixture ${ref.file} names agent "${ref.agent}" but the harness has no adapter for it`,
    );
  }
  return agent;
}

export function runStructural(
  refs: EvalCaseRef[],
  root = evalsDir(),
): StructuralResult[] {
  return refs.map((ref) => {
    const actual = buildEnvelope(
      ref.fixture.id,
      ref.agent,
      agentAdapter(ref).build(ref.fixture.input),
    );
    let expected: CaseEnvelope | null = null;
    try {
      expected = loadEnvelope(
        evalSnapshotPath(ref.agent, ref.fixture.id, root),
      );
    } catch {
      expected = null;
    }
    return {
      case: ref.fixture.id,
      agent: ref.agent,
      ...compareEnvelope(actual, expected),
      promptHash: actual.prompt_hash,
    };
  });
}

// ─── Layer 2: judged ─────────────────────────────────────────────────────────

export class JudgeError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    public readonly providerName: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "JudgeError";
    this.cause = cause;
  }
}

/** First balanced `{…}` object — the shared extractor in @video/llm
 *  (the same one the article-review judge relies on). */
export { extractBalancedJson } from "@video/llm";

/** Coerce one judge value into 0-10. LLMs emit floats and the occasional 11.
 *  A non-numeric value is a failure, not a silent zero: `Number(null)`,
 *  `Number(false)` and `Number([])` are all 0, and a judge that returned
 *  `null` for an axis must not read as "scored 0 and failed" — the two mean
 *  different things (a weak draft vs. a broken judge call). */
export function clampAxis(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
}

export interface JudgeScore {
  scores: Record<string, number>;
  comment: string;
  suggestions: string[];
  total: number;
}

/** Parse a judge reply against the case's axes. Every requested axis must be
 *  present and numeric — a missing axis is an error, because a case whose
 *  rubric was skipped must never read as a pass. */
export function parseJudgeReply(raw: unknown, axes: string[]): JudgeScore {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new JudgeError("judge payload is not a JSON object", "unknown");
  }
  const obj = raw as Record<string, unknown>;
  const scores: Record<string, number> = {};
  for (const axis of axes) {
    const value = clampAxis(obj[axis]);
    if (value === null) {
      throw new JudgeError(
        `judge omitted or mangled axis "${axis}"`,
        "unknown",
      );
    }
    scores[axis] = value;
  }
  const rawSuggestions = obj["suggestions"];
  return {
    scores,
    comment: typeof obj["comment"] === "string" ? obj["comment"] : "",
    suggestions: Array.isArray(rawSuggestions)
      ? rawSuggestions
          .filter((s): s is string => typeof s === "string")
          .slice(0, 5)
      : [],
    // Computed by us. A `total` supplied by the judge is never trusted.
    total: Object.values(scores).reduce((a, b) => a + b, 0),
  };
}

export function buildJudgeMessages(
  agent: string,
  axes: string[],
  output: string,
): ChatMessage[] {
  return [
    { role: "system", content: EVALS_JUDGE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Agent under test: ${agent}`,
        "",
        "Rate the output below on EXACTLY these axes:",
        ...axes.map((a) => `- ${a}`),
        "",
        "## Agent output",
        "",
        output.slice(0, 12000),
        "",
        "Produce the score JSON.",
      ].join("\n"),
    },
  ];
}

export type JudgedStatus = "pass" | "fail" | "error";

export interface JudgedResult {
  case: string;
  agent: string;
  status: JudgedStatus;
  promptHash: string;
  scores: Record<string, number>;
  /** Sum of the axis scores, computed by us — never read off the LLM. */
  total: number;
  comment: string;
  error?: string;
  /** Pre-formatted console line, so a concurrent batch can still log in
   *  fixture order instead of in whatever order the calls settled. */
  line: string;
  /** Wall-clock split for the two provider calls. The generation dominates:
   *  layer 2 is a full article/shotlist write, then a much cheaper rubric pass.
   *  Printed so the cost of a gate is visible before anyone wires one up. */
  timing?: { generationMs: number; judgeMs: number };
}

export function verdictFor(
  expects: EvalExpectation[],
  scores: Record<string, number>,
): { status: JudgedStatus; detail: string } {
  const below = expects.filter((e) => (scores[e.axis] ?? -1) < e.min);
  if (below.length > 0) {
    return {
      status: "fail",
      detail: below
        .map((e) => `${e.axis}=${scores[e.axis] ?? "missing"} < min ${e.min}`)
        .join("; "),
    };
  }
  const total = expects.reduce((a, e) => a + (scores[e.axis] ?? 0), 0);
  return { status: "pass", detail: `all axes ≥ min (total ${total})` };
}

/** Judge one already-generated output. Throws JudgeError on a provider
 *  failure or an unparseable reply — the caller records it as an error row
 *  rather than treating it as a pass. */
export async function scoreAgainstRubric(
  agent: string,
  axes: string[],
  output: string,
  provider: Provider,
  fallback: Provider | null,
): Promise<JudgeScore> {
  const out = await chatWithFallback(provider, fallback, {
    messages: buildJudgeMessages(agent, axes, output),
    response_format: { type: "json_object" },
  });
  const json = extractBalancedJson(out.response.content);
  if (!json) {
    throw new JudgeError("no JSON object in judge response", out.provider);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new JudgeError(
      `judge JSON parse failed: ${(err as Error).message}`,
      out.provider,
      err,
    );
  }
  return parseJudgeReply(raw, axes);
}

/** Cases are independent, so the judged layer runs them concurrently. Serial
 *  would make a 5-case golden set take as long as its slowest case times five
 *  — minutes of standing at the push gate. Bounded so a growing set does not
 *  fire one request per case at the provider at once. */
const JUDGE_CONCURRENCY = 4;

/** Per-case ceiling. A push gate must fail fast rather than hang: a wedged
 *  provider call should read as an error row, not an indefinite wait.
 *  240s, not 180s: a measured GLM generation ran 161s, so the earlier cap sat
 *  ~12% above the worst observation and produced spurious timeout rows. */
const JUDGE_CASE_TIMEOUT_MS = 240_000;

/** Run a promise under a deadline. The loser is abandoned, not cancelled —
 *  `Provider.chat` takes no AbortSignal — so the call still settles on its
 *  own; we just stop waiting for it. */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Split into consecutive batches of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Judge one case: generate with the real agent, then score the output against
 * the case's rubric. Never throws — a provider failure becomes an `error` row,
 * because a broken judge call must not read as a pass.
 */
async function judgeCase(
  ref: EvalCaseRef,
  adapter: EvalAgent,
  provider: Provider,
  fallback: Provider | null,
): Promise<JudgedResult> {
  const promptHash = sha256OfMessages(adapter.build(ref.fixture.input));
  const axes = ref.fixture.expects.map((e) => e.axis);
  const startedAt = Date.now();
  try {
    const generated = await withTimeout(
      adapter.call(ref.fixture.input, provider, fallback),
      JUDGE_CASE_TIMEOUT_MS,
      `${ref.agent}/${ref.fixture.id} generation`,
    );
    const afterGeneration = Date.now();
    const parsed = await withTimeout(
      scoreAgainstRubric(ref.agent, axes, generated.output, provider, fallback),
      JUDGE_CASE_TIMEOUT_MS,
      `${ref.agent}/${ref.fixture.id} judge`,
    );
    const timing = {
      generationMs: afterGeneration - startedAt,
      judgeMs: Date.now() - afterGeneration,
    };
    const verdict = verdictFor(ref.fixture.expects, parsed.scores);
    const mark = verdict.status === "pass" ? "ok  " : "FAIL";
    return {
      case: ref.fixture.id,
      agent: ref.agent,
      status: verdict.status,
      promptHash,
      scores: parsed.scores,
      total: parsed.total,
      comment: parsed.comment,
      timing,
      line: `${mark} ${ref.agent}/${ref.fixture.id}  layer2 ${verdict.status} — ${verdict.detail}  [gen ${(timing.generationMs / 1000).toFixed(1)}s + judge ${(timing.judgeMs / 1000).toFixed(1)}s]`,
    };
  } catch (err) {
    const message = (err as Error).message;
    return {
      case: ref.fixture.id,
      agent: ref.agent,
      status: "error",
      promptHash,
      scores: {},
      total: 0,
      comment: "",
      error: message,
      line: `FAIL ${ref.agent}/${ref.fixture.id}  layer2 error — ${message}`,
    };
  }
}

// ─── Report + orphan guard ───────────────────────────────────────────────────

/** `evals/report.yaml` — one row per case, agent-major. Written on every run
 *  so a later run can diff it and attribute a score delta to a prompt edit. */
export function renderReportYaml(
  structural: StructuralResult[],
  judged: JudgedResult[],
): string {
  const byKey = new Map(judged.map((j) => [`${j.agent}/${j.case}`, j]));
  return renderYaml({
    schema: "prompt-evals-report/1",
    cases: structural.map((s) => {
      const j = byKey.get(`${s.agent}/${s.case}`);
      return {
        case: s.case,
        agent: s.agent,
        prompt_hash: j?.promptHash ?? s.promptHash,
        structural: s.status,
        ...(j
          ? {
              judged: j.status,
              scores: j.scores,
              total: j.total,
              ...(j.comment ? { comment: j.comment } : {}),
              ...(j.error ? { error: j.error } : {}),
            }
          : { judged: "skipped" }),
      };
    }),
  });
}

export interface OrphanReport {
  /** Fixture with no committed snapshot. */
  missingSnapshots: string[];
  /** Committed snapshot with no fixture — a deleted case left behind. */
  orphanSnapshots: string[];
}

/**
 * The two-way orphan guard (plan §5): every fixture must have a committed
 * snapshot and every committed snapshot must have a fixture. Runs in CI, so
 * neither direction survives a prompt review unnoticed.
 *
 * Always walks every agent — the guard is a repo-level invariant, so narrowing
 * the *run* with `--agent`/`--case` must not make the cases left out look like
 * orphans.
 */
export function findOrphans(root = evalsDir()): OrphanReport {
  const missingSnapshots: string[] = [];
  const orphanSnapshots: string[] = [];
  for (const agent of listEvalAgents(root)) {
    const caseIds = new Set(
      listEvalCases({ agent }, root).map((r) => r.fixture.id),
    );
    for (const id of caseIds) {
      try {
        loadEnvelope(evalSnapshotPath(agent, id, root));
      } catch {
        missingSnapshots.push(`${agent}/${id}`);
      }
    }
    for (const id of listSnapshotIds(root, agent)) {
      if (!caseIds.has(id)) orphanSnapshots.push(`${agent}/${id}`);
    }
  }
  return { missingSnapshots, orphanSnapshots };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Collapse a run's results into one exit code.
 *
 * A measured regression and an unmeasured run are different verdicts: a
 * provider timeout refutes nothing. Keeping them apart is what lets the
 * pre-push hook block on a real quality drop without becoming flaky every time
 * the provider is slow.
 */
export function verdictExitCode(
  judged: JudgedResult[],
  structuralFailures: number,
  orphanFailures: number,
): EvalExitCode {
  const qualityFailures =
    structuralFailures +
    orphanFailures +
    judged.filter((j) => j.status === "fail").length;
  const infrastructureErrors = judged.filter(
    (j) => j.status === "error",
  ).length;
  if (qualityFailures > 0) return 1;
  return infrastructureErrors > 0 ? 2 : 0;
}

/**
 * Process exit code for a run.
 *
 *   0 — everything passed
 *   1 — a real failure: a prompt drifted from its snapshot, or a judged score
 *       fell below its axis `min`
 *   2 — only infrastructure errors: a provider timeout, a provider outage, a
 *       schema rejection. Nothing was measured, so nothing was refuted.
 *
 * The split matters for automation. A gate that blocks on 2 is a gate that
 * blocks on its own flakiness — a slow provider is not a prompt regression.
 */
export type EvalExitCode = 0 | 1 | 2;

export interface RunPromptEvalsOptions {
  agent?: string | undefined;
  caseId?: string | undefined;
  /** Judge provider name. Omitted ⇒ layer 2 does not run. */
  judge?: string | undefined;
  /** Force layer-1-only even when a judge is named. */
  offline?: boolean | undefined;
  updateRecorded?: boolean | undefined;
  updateSnapshots?: boolean | undefined;
  log?: ((line: string) => void) | undefined;
}

export function reportPath(root = evalsDir()): string {
  return path.join(root, "report.yaml");
}

async function writeText(file: string, body: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
}

/**
 * Run both layers; returns the process exit code (see `EvalExitCode`).
 *
 * Layer 1 always runs. Layer 2 runs only when a judge provider is named and
 * `--offline` is absent — a default structural run must never silently spend
 * tokens, and an eval harness nobody can run free is one nobody runs.
 */
export async function runPromptEvals(
  opts: RunPromptEvalsOptions = {},
): Promise<EvalExitCode> {
  const log = opts.log ?? console.log;
  const root = evalsDir();
  const refs = listEvalCases(
    {
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.caseId ? { caseId: opts.caseId } : {}),
    },
    root,
  );

  if (opts.updateSnapshots) {
    for (const ref of refs) {
      const envelope = buildEnvelope(
        ref.fixture.id,
        ref.agent,
        agentAdapter(ref).build(ref.fixture.input),
      );
      await writeText(
        evalSnapshotPath(ref.agent, ref.fixture.id, root),
        renderEnvelopeYaml(envelope),
      );
      log(`snapshot  ${ref.agent}/${ref.fixture.id}  ${envelope.prompt_hash}`);
    }
  }

  if (refs.length === 0) {
    log(`no eval case matched — see ${root}`);
    return 1;
  }

  const structural = runStructural(refs, root);
  for (const s of structural) {
    const mark = s.status === "pass" ? "ok  " : "FAIL";
    log(
      `${mark} ${s.agent}/${s.case}  layer1 ${s.status}${s.detail ? ` — ${s.detail}` : ""}`,
    );
  }

  const judged: JudgedResult[] = [];
  if (opts.judge && opts.offline) {
    log(`\n--offline: layer 2 skipped for all ${refs.length} case(s)`);
  } else if (!opts.judge) {
    log("\nlayer 2 not run — pass --judge glm to score against the rubric");
  } else {
    const judgeName = opts.judge;
    const provider = providerInstance(judgeName);
    const fallback = providerInstance(judgeName === "glm" ? "minimax" : "glm");
    const byRef = new Map(refs.map((r) => [r, agentAdapter(r)]));
    for (const batch of chunk([...refs], JUDGE_CONCURRENCY)) {
      const settled = await Promise.all(
        batch.map((ref) => judgeCase(ref, byRef.get(ref)!, provider, fallback)),
      );
      // Logged after the batch settles so output stays in fixture order
      // instead of in whatever order the provider calls happened to return.
      for (const j of settled) {
        judged.push(j);
        log(j.line);
      }
    }
  }

  await writeText(reportPath(root), renderReportYaml(structural, judged));
  log(`\nreport  ${reportPath(root)}`);

  if (opts.updateRecorded) {
    for (const j of judged) {
      if (j.status === "error") continue;
      const ref = refs.find(
        (r) => r.agent === j.agent && r.fixture.id === j.case,
      );
      if (!ref) continue;
      await writeText(
        ref.file,
        renderYaml(
          applyRecorded(ref.fixture, {
            prompt_hash: j.promptHash,
            scores: j.scores,
          }),
        ),
      );
      log(`recorded  ${ref.agent}/${ref.fixture.id}  ${j.promptHash}`);
    }
  }

  const orphans: OrphanReport = opts.updateSnapshots
    ? { missingSnapshots: [], orphanSnapshots: [] }
    : findOrphans(root);
  for (const id of orphans.missingSnapshots) {
    log(`FAIL orphan-guard  ${id}  fixture with no committed snapshot`);
  }
  for (const id of orphans.orphanSnapshots) {
    log(`FAIL orphan-guard  ${id}  snapshot with no fixture`);
  }

  // A measured regression and an unmeasured run are different verdicts.
  const structuralFailures = structural.filter(
    (s) => s.status !== "pass",
  ).length;
  const judgedFails = judged.filter((j) => j.status === "fail");
  const judgedErrors = judged.filter((j) => j.status === "error");
  const orphanFailures =
    orphans.missingSnapshots.length + orphans.orphanSnapshots.length;

  const exitCode = verdictExitCode(judged, structuralFailures, orphanFailures);
  log(
    exitCode === 1
      ? `\n${structuralFailures + judgedFails.length + orphanFailures} failure(s) across ${refs.length} case(s)`
      : exitCode === 2
        ? `\n${judgedErrors.length} case(s) could not be measured (provider/schema error) — no quality verdict`
        : `\n${refs.length} case(s) pass (${structural.length} layer1, ${judged.length} layer2)`,
  );
  return exitCode;
}
