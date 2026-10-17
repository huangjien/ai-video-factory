/**
 * Prompt eval golden set — fixture + envelope-snapshot data layer.
 *
 * Fixtures live at `packages/prompts/evals/<agent>/<case-id>.yaml`, beside
 * the prompts they exercise, so a prompt edit and the cases that judge it
 * land in one review. The runner (`video prompts eval`) lives in @video/cli
 * because only the CLI sits above every agent package — this module stays
 * dependency-free of agents and only knows the file format.
 *
 * Two shapes live here:
 *   - the fixture (fixed input + rubric thresholds + provenance), and
 *   - the envelope (roles + content hashes + context-block layout), the
 *     layer-1 snapshot a deliberate prompt edit must invalidate.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";

/** packages/prompts/{src|dist} → ../evals (same either way). */
export function evalsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "evals");
}

export interface EvalExpectation {
  /** Rubric axis name — matched 1:1 by the judge. */
  axis: string;
  /** Lowest score (0-10) that keeps the case green. */
  min: number;
}

export interface EvalFixture {
  id: string;
  /** Agent id — must match an adapter in the CLI runner. */
  agent: string;
  /** The exact agent input for this case. Shape is the agent's own. */
  input: Record<string, unknown>;
  expects: EvalExpectation[];
  /** Why this case exists — the failure it encodes. Never omit: a golden
   *  set with no provenance is an invented one. */
  provenance: { source: string };
  /** Last judged result. Written by `--update-recorded` after a
   *  deliberate prompt change; absent until the case is judged once. */
  recorded?:
    { prompt_hash: string; scores: Record<string, number> } | undefined;
}

export interface EvalCaseRef {
  agent: string;
  id: string;
  /** Absolute path of the fixture file. */
  file: string;
  fixture: EvalFixture;
}

/** One message's layer-1 fingerprint. `blocks` is the context-block layout
 *  (which optional sections appeared, in what order) — it catches a
 *  reordering or a dropped context block even when every hash matches. */
export interface MessageEnvelope {
  role: string;
  bytes: number;
  content_sha256: string;
  blocks: string[];
}

export interface CaseEnvelope {
  case: string;
  agent: string;
  /** Lineage key — identical to the `prompt_hash` a run record stamps, so
   *  report rows and run records can be compared across prompt edits. */
  prompt_hash: string;
  messages: MessageEnvelope[];
}

export function sha256(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

/** Lineage hash over the exact messages sent to the provider. Byte-identical
 *  to the `prompt_hash` the CLI run-record commands compute — same
 *  canonical JSON, same digest — so eval rows and run records join. */
export function sha256OfMessages(
  messages: { role: string; content: string }[],
): string {
  return sha256(
    JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content }))),
  );
}

/**
 * Layout fingerprint of one message body: the `##`-style section headings
 * and the leading `Label:` field lines, in order, de-duplicated. Cheap and
 * deterministic — a reordered or dropped context block moves an entry, and a
 * stable one leaves the list identical.
 */
export function blockLayout(content: string): string[] {
  const out: string[] = [];
  const push = (marker: string): void => {
    if (!out.includes(marker)) out.push(marker);
  };
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      push(`§ ${heading[1]}`);
      continue;
    }
    const field = /^([A-Z][A-Za-z0-9 ()/-]{0,40}):/.exec(line);
    if (field?.[1]) push(`${field[1]}:`);
  }
  return out;
}

export function buildEnvelope(
  caseId: string,
  agent: string,
  messages: { role: string; content: string }[],
): CaseEnvelope {
  return {
    case: caseId,
    agent,
    prompt_hash: sha256OfMessages(messages),
    messages: messages.map((m) => ({
      role: m.role,
      bytes: Buffer.byteLength(m.content, "utf8"),
      content_sha256: sha256(m.content),
      blocks: blockLayout(m.content),
    })),
  };
}

/** Committed YAML form. Stable key order + explicit 2-space indent so a
 *  regenerated snapshot diffs cleanly against the committed one. */
export function renderYaml(value: unknown): string {
  return yamlStringify(value, { indent: 2, lineWidth: 0 });
}

export function renderEnvelopeYaml(envelope: CaseEnvelope): string {
  return renderYaml(envelope);
}

function fail(file: string, reason: string): never {
  throw new Error(`invalid eval fixture ${file}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Parse one fixture. Throws with the file path and the specific field so a
 * malformed case is debuggable without opening the YAML by hand — the same
 * discipline `loadPrompt` applies to a missing prompt file.
 */
export function parseEvalFixture(file: string, raw: unknown): EvalFixture {
  if (!isRecord(raw)) return fail(file, "top level must be a mapping");
  const id = nonEmptyString(raw["id"]);
  if (!id) return fail(file, "`id` must be a non-empty string");
  const agent = nonEmptyString(raw["agent"]);
  if (!agent) return fail(file, "`agent` must be a non-empty string");
  const input = raw["input"];
  if (!isRecord(input)) return fail(file, "`input` must be a mapping");

  const rawExpects = raw["expects"];
  if (!Array.isArray(rawExpects) || rawExpects.length === 0) {
    return fail(file, "`expects` must be a non-empty list");
  }
  const expects: EvalExpectation[] = [];
  for (const entry of rawExpects) {
    if (!isRecord(entry))
      return fail(file, "`expects` entries must be mappings");
    const axis = nonEmptyString(entry["axis"]);
    if (!axis) return fail(file, "every `expects` entry needs an `axis`");
    const min = entry["min"];
    if (typeof min !== "number" || !Number.isFinite(min)) {
      return fail(file, `expects.${axis}.min must be a number`);
    }
    if (expects.some((e) => e.axis === axis)) {
      return fail(file, `duplicate axis: ${axis}`);
    }
    expects.push({ axis, min });
  }

  const provenance = raw["provenance"];
  if (!isRecord(provenance) || !nonEmptyString(provenance["source"])) {
    return fail(file, "`provenance.source` must name the failure this encodes");
  }

  let recorded: EvalFixture["recorded"];
  if (raw["recorded"] !== undefined && raw["recorded"] !== null) {
    const rec = raw["recorded"];
    if (!isRecord(rec)) return fail(file, "`recorded` must be a mapping");
    const hash = nonEmptyString(rec["prompt_hash"]);
    if (!hash) return fail(file, "`recorded.prompt_hash` must be a string");
    const scores = rec["scores"];
    if (!isRecord(scores))
      return fail(file, "`recorded.scores` must be a mapping");
    const parsed: Record<string, number> = {};
    for (const [axis, value] of Object.entries(scores)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(file, `recorded.scores.${axis} must be a number`);
      }
      parsed[axis] = value;
    }
    recorded = { prompt_hash: hash, scores: parsed };
  }

  return {
    id,
    agent,
    input,
    expects,
    provenance: { source: provenance["source"] as string },
    ...(recorded !== undefined ? { recorded } : {}),
  };
}

export function loadEvalFixture(file: string): EvalFixture {
  return parseEvalFixture(file, parseYaml(readFileSync(file, "utf8")));
}

/** Agent directories under evals/ that actually hold cases (no dotfiles,
 *  no `__snapshots__`, no future metadata folders). */
export function listEvalAgents(root = evalsDir()): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((name) => listEvalFiles(root, name).length > 0)
    .sort();
}

/** Case file names (stems) for one agent, sorted. */
export function listEvalFiles(root: string, agent: string): string[] {
  const dir = path.join(root, agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -".yaml".length))
    .sort();
}

/** Every fixture on disk, agent-major then case-id order. `agent` and
 *  `caseId` narrow the walk; an unknown agent is an error, not an empty
 *  result — a typo'd `--agent` must not read as "everything passed". */
export function listEvalCases(
  opts: { agent?: string; caseId?: string } = {},
  root = evalsDir(),
): EvalCaseRef[] {
  const agents = opts.agent ? [opts.agent] : listEvalAgents(root);
  const out: EvalCaseRef[] = [];
  for (const agent of agents) {
    const dir = path.join(root, agent);
    if (!existsSync(dir)) {
      throw new Error(`unknown eval agent "${agent}" — no ${dir}`);
    }
    for (const id of listEvalFiles(root, agent)) {
      if (opts.caseId && id !== opts.caseId) continue;
      const file = path.join(dir, `${id}.yaml`);
      const fixture = loadEvalFixture(file);
      if (fixture.agent !== agent) {
        throw new Error(
          `invalid eval fixture ${file}: agent "${fixture.agent}" does not match its directory "${agent}"`,
        );
      }
      if (fixture.id !== id) {
        throw new Error(
          `invalid eval fixture ${file}: id "${fixture.id}" does not match its file name`,
        );
      }
      out.push({ agent, id, file, fixture });
    }
  }
  return out;
}

/** Where the committed layer-1 snapshot for a case lives. */
export function evalSnapshotPath(
  agent: string,
  id: string,
  root = evalsDir(),
): string {
  return path.join(root, agent, "__snapshots__", `${id}.envelope.yaml`);
}

/** Committed snapshot ids for an agent — the other half of the two-way
 *  orphan guard (a snapshot with no fixture is a deleted case left behind). */
export function listSnapshotIds(root: string, agent: string): string[] {
  const dir = path.join(root, agent, "__snapshots__");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".envelope.yaml"))
    .map((f) => f.slice(0, -".envelope.yaml".length))
    .sort();
}

export function loadEnvelope(file: string): CaseEnvelope {
  const parsed = parseYaml(readFileSync(file, "utf8")) as CaseEnvelope | null;
  if (!isRecord(parsed)) {
    throw new Error(
      `invalid eval snapshot ${file}: top level must be a mapping`,
    );
  }
  return parsed;
}

/** Re-emit a fixture with a fresh `recorded:` block. Only the fields the
 *  harness owns are rewritten; `input` and `expects` round-trip from the
 *  parsed object, so `--update-recorded` cannot silently edit a rubric. */
export function applyRecorded(
  fixture: EvalFixture,
  recorded: { prompt_hash: string; scores: Record<string, number> },
): Record<string, unknown> {
  return {
    id: fixture.id,
    agent: fixture.agent,
    input: fixture.input,
    expects: fixture.expects.map((e) => ({ axis: e.axis, min: e.min })),
    provenance: fixture.provenance,
    recorded,
  };
}
