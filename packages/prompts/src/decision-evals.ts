/**
 * The decision corpus — the cases that judge a decision layer.
 *
 * Cases live at `packages/prompts/decisions/<surface>/<case-id>.yaml`,
 * beside the question bodies they exercise, so a question edit and the
 * cases that judge it land in one review. The runner (`video decision
 * bench`) lives in @video/cli because only the CLI sits above every
 * provider; this module stays dependency-free of agents and only knows
 * the file format.
 *
 * Two rules make the corpus worth something:
 *
 *  1. **Every case carries a label.** A corpus without labels cannot
 *     measure accuracy, and an unlabelled case is worse than no case —
 *     it looks like coverage.
 *  2. **Every case names the failure it encodes** (`provenance.source`).
 *     A golden set with no provenance is an invented one.
 *
 * The corpus lives beside `evals/` rather than inside it: the prompt
 * golden set has its own fixture shape (rubric axes, snapshots), and
 * mixing the two would make `video prompts eval` walk decision cases it
 * cannot judge.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  DECISION_QUESTIONS,
  type DecisionSurface,
} from "./decision-questions.js";

/** packages/prompts/{src|dist} → ../decisions (same either way). */
export function decisionsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "decisions");
}

/** What a case expects the decision to be. */
export interface DecisionExpectation {
  /** Must match the surface's question kind. */
  kind: "choice" | "score" | "noul";
  /** `choice`: the option. `score`: the level index. `noul`: "true" /
   *  "false" — the side the probability must land on. */
  value: string | number | boolean;
  /** `noul`: the band the probability must fall in. Omitted = any side
   *  of the threshold is acceptable. */
  probability?: [number, number] | undefined;
  /** `score`: how far the score may sit from `value`. */
  tolerance?: number | undefined;
}

/** The labelling rule that produced a case's label. Every surface has
 *  its own set — see `decisions/POLICY.md`, which is the prose version
 *  of this table. */
export type DecisionPolicyRule =
  | "qa-finding-level"
  | "review-verdict"
  | "structure-over-photo"
  | "photo"
  | "thesis"
  | "caption-band"
  | "motion-specificity";

/** The rules each surface may use. A case that names a rule from
 *  another surface is a labelling mistake the loader catches. */
export const DECISION_POLICY_RULES: Record<
  DecisionSurface,
  DecisionPolicyRule[]
> = {
  "qa-triage": ["qa-finding-level"],
  "draft-bar": ["review-verdict"],
  // The alternatives under evaluation carry the same rule: the label is
  // derived from the artifact's own verdict either way.
  "draft-bar-v2": ["review-verdict"],
  "draft-bar-v3": ["review-verdict"],
  "draft-bar-v4": ["review-verdict"],
  "visual-class": ["structure-over-photo", "photo", "thesis"],
  "motion-prescreen": ["motion-specificity"],
  "caption-overlap": ["caption-band"],
};

/** The verdict the artifact itself recorded. For the `draft-bar` surface
 *  the label is DERIVED from these facts, and the loader refuses a
 *  fixture whose label disagrees with its own rule — so a label cannot
 *  drift away from the artifact it claims to encode. */
export interface DecisionSourceVerdict {
  /** The review's own `passing` flag. */
  passing: boolean;
  /** The review raised a Critical finding, or a CRITICAL_BLOCKER flag. */
  critical?: boolean | undefined;
  /** The review raised a MAJOR_REVISION_NEEDED flag. */
  major_revision_needed?: boolean | undefined;
}

export interface DecisionCaseFixture {
  id: string;
  surface: DecisionSurface;
  /** The state the decision is about. */
  state: string;
  expects: DecisionExpectation;
  /** What today's deterministic path answers for this state, when there
   *  is one. Absent means the surface has no deterministic path yet. */
  baseline?: string | number | boolean | undefined;
  /** True when the label is arguable — a competent judge could answer
   *  differently. Such a case still counts in the accuracy (hiding it
   *  would flatter the providers), and the bench reports how many cases
   *  are disputed plus the accuracy over the undisputed ones. */
  disputed?: boolean | undefined;
  /** Why the label is arguable. Required when `disputed` is true. */
  dispute?: string | undefined;
  /** Which labelling rule produced the label — the case is auditable
   *  against `decisions/POLICY.md`. */
  policy?: { rule: DecisionPolicyRule; note?: string | undefined } | undefined;
  /** The verdict the artifact recorded, when the rule derives the label
   *  from it. */
  source_verdict?: DecisionSourceVerdict | undefined;
  /** Why this case exists — the failure it encodes. Never omit. */
  provenance: { source: string };
}

export interface DecisionCaseRef {
  surface: DecisionSurface;
  id: string;
  file: string;
  fixture: DecisionCaseFixture;
}

function fail(file: string, reason: string): never {
  throw new Error(`invalid decision case ${file}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Parse one case file. Throws with the file and the specific field so
 *  a malformed case is debuggable without opening the YAML by hand. */
export function parseDecisionCase(
  file: string,
  raw: unknown,
): DecisionCaseFixture {
  if (!isRecord(raw)) return fail(file, "top level must be a mapping");
  const id = nonEmptyString(raw["id"]);
  if (!id) return fail(file, "`id` must be a non-empty string");
  const surface = nonEmptyString(raw["surface"]);
  if (!surface) return fail(file, "`surface` must be a non-empty string");
  if (!(surface in DECISION_QUESTIONS)) {
    return fail(file, `unknown surface "${surface}"`);
  }
  const state = raw["state"];
  if (typeof state !== "string" || state.trim().length === 0) {
    return fail(file, "`state` must be a non-empty string");
  }

  const rawExpects = raw["expects"];
  if (!isRecord(rawExpects)) return fail(file, "`expects` must be a mapping");
  const spec = DECISION_QUESTIONS[surface as DecisionSurface];
  const kind = nonEmptyString(rawExpects["kind"]);
  if (!kind) return fail(file, "`expects.kind` must be a string");
  if (kind !== spec.kind) {
    return fail(
      file,
      `expects.kind "${kind}" does not match the surface's question kind "${spec.kind}"`,
    );
  }
  const value = rawExpects["value"];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return fail(file, "`expects.value` must be a string, number or boolean");
  }
  if (spec.kind === "choice") {
    const options = spec.options ?? [];
    if (typeof value !== "string" || !options.includes(value)) {
      return fail(
        file,
        `expects.value ${JSON.stringify(value)} is not one of the surface's options (${options.join(", ")})`,
      );
    }
  }
  if (spec.kind === "score") {
    const levels = spec.levels ?? [];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return fail(file, "`expects.value` must be an integer level index");
    }
    if (value < 0 || value >= levels.length) {
      return fail(file, `expects.value ${value} is outside the surface's levels`);
    }
  }

  let probability: [number, number] | undefined;
  if (rawExpects["probability"] !== undefined) {
    const band = rawExpects["probability"];
    if (!Array.isArray(band) || band.length !== 2) {
      return fail(file, "`expects.probability` must be a [min, max] pair");
    }
    const min = band[0];
    const max = band[1];
    if (typeof min !== "number" || typeof max !== "number") {
      return fail(file, "`expects.probability` must hold two numbers");
    }
    probability = [min, max];
  }
  let tolerance: number | undefined;
  if (rawExpects["tolerance"] !== undefined) {
    const tol = rawExpects["tolerance"];
    if (typeof tol !== "number" || !Number.isFinite(tol)) {
      return fail(file, "`expects.tolerance` must be a number");
    }
    tolerance = tol;
  }

  const baseline = raw["baseline"];
  if (
    baseline !== undefined &&
    baseline !== null &&
    typeof baseline !== "string" &&
    typeof baseline !== "number" &&
    typeof baseline !== "boolean"
  ) {
    return fail(file, "`baseline` must be a string, number or boolean");
  }

  const disputed = raw["disputed"];
  if (disputed !== undefined && typeof disputed !== "boolean") {
    return fail(file, "`disputed` must be a boolean");
  }
  const dispute = raw["dispute"];
  if (dispute !== undefined && !nonEmptyString(dispute)) {
    return fail(file, "`dispute` must be a non-empty string");
  }
  if (disputed === true && dispute === undefined) {
    return fail(file, "a disputed case must say why in `dispute`");
  }

  const rawPolicy = raw["policy"];
  let policy: DecisionCaseFixture["policy"];
  if (rawPolicy !== undefined) {
    if (!isRecord(rawPolicy)) return fail(file, "`policy` must be a mapping");
    const rule = nonEmptyString(rawPolicy["rule"]);
    if (!rule) return fail(file, "`policy.rule` must be a non-empty string");
    const allowed = DECISION_POLICY_RULES[surface as DecisionSurface];
    if (!allowed.includes(rule as DecisionPolicyRule)) {
      return fail(
        file,
        `policy.rule "${rule}" is not a rule of the "${surface}" surface (allowed: ${allowed.join(", ")})`,
      );
    }
    const note = rawPolicy["note"];
    if (note !== undefined && !nonEmptyString(note)) {
      return fail(file, "`policy.note` must be a non-empty string");
    }
    policy = {
      rule: rule as DecisionPolicyRule,
      ...(note !== undefined ? { note: note as string } : {}),
    };
  }

  const rawVerdict = raw["source_verdict"];
  let sourceVerdict: DecisionSourceVerdict | undefined;
  if (rawVerdict !== undefined) {
    if (!isRecord(rawVerdict)) {
      return fail(file, "`source_verdict` must be a mapping");
    }
    const passing = rawVerdict["passing"];
    if (typeof passing !== "boolean") {
      return fail(file, "`source_verdict.passing` must be a boolean");
    }
    const readFlag = (key: string): boolean | undefined => {
      const value = rawVerdict[key];
      if (value === undefined) return undefined;
      if (typeof value !== "boolean") {
        return fail(file, `\`source_verdict.${key}\` must be a boolean`);
      }
      return value;
    };
    sourceVerdict = {
      passing,
      ...(readFlag("critical") !== undefined
        ? { critical: readFlag("critical") }
        : {}),
      ...(readFlag("major_revision_needed") !== undefined
        ? { major_revision_needed: readFlag("major_revision_needed") }
        : {}),
    };
    // The draft-bar label is DERIVED from the artifact's verdict. A
    // label that disagrees with the rule is a bug in the corpus.
    if (surface === "draft-bar") {
      const derived = verdictToLabel(sourceVerdict);
      if (value !== derived) {
        return fail(
          file,
          `expects.value ${JSON.stringify(value)} does not match the verdict rule (${derived})`,
        );
      }
    }
  }

  const provenance = raw["provenance"];
  if (!isRecord(provenance) || !nonEmptyString(provenance["source"])) {
    return fail(file, "`provenance.source` must name the failure this encodes");
  }

  return {
    id,
    surface: surface as DecisionSurface,
    state,
    expects: {
      kind: kind as DecisionExpectation["kind"],
      value,
      ...(probability !== undefined ? { probability } : {}),
      ...(tolerance !== undefined ? { tolerance } : {}),
    },
    ...(baseline !== undefined && baseline !== null ? { baseline } : {}),
    ...(disputed === true ? { disputed: true } : {}),
    ...(dispute !== undefined ? { dispute: dispute as string } : {}),
    ...(policy !== undefined ? { policy } : {}),
    ...(sourceVerdict !== undefined ? { source_verdict: sourceVerdict } : {}),
    provenance: { source: provenance["source"] as string },
  };
}

/** The `draft-bar` rule, as code: the artifact's own verdict decides
 *  the label. A Critical finding or a CRITICAL_BLOCKER flag rejects; a
 *  MAJOR_REVISION_NEEDED flag revises; otherwise the review's `passing`
 *  flag decides. */
export function verdictToLabel(verdict: DecisionSourceVerdict): string {
  if (verdict.critical === true) return "reject";
  if (verdict.major_revision_needed === true) return "revise";
  if (verdict.passing) return "pass";
  return "revise";
}

export function loadDecisionCase(file: string): DecisionCaseFixture {
  return parseDecisionCase(file, parseYaml(readFileSync(file, "utf8")));
}

/** Surface directories under decisions/ that actually hold cases. */
export function listDecisionSurfacesWithCases(
  root = decisionsDir(),
): DecisionSurface[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((name): name is DecisionSurface => name in DECISION_QUESTIONS)
    .filter((name) => listDecisionCaseIds(root, name).length > 0)
    .sort();
}

/** Case file names (stems) for one surface, sorted. */
export function listDecisionCaseIds(
  root: string,
  surface: DecisionSurface,
): string[] {
  const dir = path.join(root, surface);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.slice(0, -".yaml".length))
    .sort();
}

/** Every case on disk. `surface` and `caseId` narrow the walk; an
 *  unknown surface is an error, not an empty result — a typo'd
 *  `--surface` must not read as "everything passed". */
export function listDecisionCases(
  opts: { surface?: DecisionSurface; caseId?: string } = {},
  root = decisionsDir(),
): DecisionCaseRef[] {
  const surfaces = opts.surface
    ? [opts.surface]
    : listDecisionSurfacesWithCases(root);
  if (opts.surface && !(opts.surface in DECISION_QUESTIONS)) {
    throw new Error(`unknown decision surface "${opts.surface}"`);
  }
  const out: DecisionCaseRef[] = [];
  for (const surface of surfaces) {
    const dir = path.join(root, surface);
    if (!existsSync(dir)) {
      throw new Error(`unknown decision surface "${surface}" — no ${dir}`);
    }
    for (const id of listDecisionCaseIds(root, surface)) {
      if (opts.caseId && id !== opts.caseId) continue;
      const file = path.join(dir, `${id}.yaml`);
      const fixture = loadDecisionCase(file);
      if (fixture.surface !== surface) {
        throw new Error(
          `invalid decision case ${file}: surface "${fixture.surface}" does not match its directory "${surface}"`,
        );
      }
      if (fixture.id !== id) {
        throw new Error(
          `invalid decision case ${file}: id "${fixture.id}" does not match its file name`,
        );
      }
      out.push({ surface, id, file, fixture });
    }
  }
  return out;
}

/** One provider's price. `null` means "unknown" — the report shows `n/a`
 *  and never a fabricated zero. */
export interface DecisionPrice {
  input_per_1k: number | null;
  output_per_1k: number | null;
}

export interface DecisionPriceTable {
  prices: Record<string, Record<string, DecisionPrice>>;
}

/** The price table, from `decisions/prices.yaml`. A missing file yields an
 *  empty table: every cost column then reads `n/a`. */
export function loadDecisionPrices(root = decisionsDir()): DecisionPriceTable {
  const file = path.join(root, "prices.yaml");
  if (!existsSync(file)) return { prices: {} };
  const parsed = parseYaml(readFileSync(file, "utf8")) as
    | DecisionPriceTable
    | null;
  if (!isRecord(parsed) || !isRecord(parsed.prices)) return { prices: {} };
  const prices: Record<string, Record<string, DecisionPrice>> = {};
  for (const [provider, models] of Object.entries(parsed.prices)) {
    if (!isRecord(models)) continue;
    const perModel: Record<string, DecisionPrice> = {};
    for (const [model, price] of Object.entries(models)) {
      if (!isRecord(price)) continue;
      const read = (key: string): number | null => {
        const value = price[key];
        return typeof value === "number" && Number.isFinite(value)
          ? value
          : null;
      };
      perModel[model] = {
        input_per_1k: read("input_per_1k"),
        output_per_1k: read("output_per_1k"),
      };
    }
    prices[provider] = perModel;
  }
  return { prices };
}
