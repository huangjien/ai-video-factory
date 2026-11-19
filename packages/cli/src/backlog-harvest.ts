import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import { extractFencedYaml } from "@video/llm";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId, writeRun } from "@video/workflow";
import { findRepoRoot } from "./learn-command.js";
import { backlogToday } from "./backlog-command.js";
import {
  loadBacklogStore,
  nextBacklogId,
  saveBacklogStore,
  type BacklogEntry,
} from "./backlog-store.js";
import { scanOverlap } from "./backlog-overlap.js";
import { slugifyProjectName } from "./project-path.js";
import { MARK_FAIL, MARK_OK, MARK_WARN } from "./ui.js";

/**
 * `video backlog harvest` — LLM extraction of video-topic candidates from
 * repo docs (design: docs/plans/2026-11-18-backlog-feature-design.md).
 *
 * Each candidate doc gets ONE call; survivors are deduped against existing
 * backlog topics (slug equality), overlap-scanned against the project
 * catalog, then appended as `proposed` entries. One run record covers the
 * whole harvest. A doc whose LLM output cannot be parsed never blocks the
 * rest — its raw output is dumped under runs/ and the harvest continues.
 */

export interface BacklogHarvestOptions {
  dryRun?: boolean;
  /** Comma-separated repo-relative dirs to scan. */
  paths?: string;
  model?: "minimax" | "glm";
  cwd?: string;
}

const MAX_FILES = 30;
const MIN_FILE_CHARS = 200;
const MAX_FILE_CHARS = 12000;
const MAX_TOPICS_PER_DOC = 10;

interface TopicCandidate {
  topic: string;
  note?: string;
  why?: string;
  anchors?: string[];
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unknown provider: ${name}`);
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Skippable by name: nav/index files describe the docs, not topics. */
const NON_TOPIC_FILES = new Set(["index.md", "readme.md"]);

function collectMarkdownFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectMarkdownFiles(full, out);
    else if (name.endsWith(".md") && !NON_TOPIC_FILES.has(name.toLowerCase())) {
      out.push(full);
    }
  }
}

function harvestPrompt(docText: string): string {
  return [
    "You are curating video topic candidates for a documentary-style video channel.",
    "From the document below, extract up to 10 TOPICS that would make a good standalone video.",
    "Good topics are self-contained and video-worthy: mechanisms, why-questions, stories, concepts.",
    "NOT video-worthy: tasks, plans, code work, tooling notes, meta commentary about the document itself.",
    "Only include a topic if it can be explained to a general audience without reading the document.",
    "",
    "Answer with ONLY a fenced yaml block of this exact shape:",
    "```yaml",
    "topics:",
    "  - topic: <short topic title>",
    "    note: <one-line mechanism summary>",
    "    anchors: [<research anchor: person, place, system>]",
    "    why: <why this would make a compelling video>",
    "```",
    "",
    "Document:",
    "-----",
    docText,
  ].join("\n");
}

/** Parse the model reply into candidates. Returns null on garbage — the
 * caller dumps the raw output rather than guessing. */
function parseCandidates(reply: string): TopicCandidate[] | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(extractFencedYaml(reply));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  if (!("topics" in parsed) || !Array.isArray(parsed.topics)) return null;
  const items: unknown[] = parsed.topics;
  const out: TopicCandidate[] = [];
  for (const item of items.slice(0, MAX_TOPICS_PER_DOC)) {
    if (item === null || typeof item !== "object") continue;
    if (!("topic" in item) || typeof item.topic !== "string") continue;
    const topic = item.topic.trim();
    if (topic === "") continue;
    const note =
      "note" in item && typeof item.note === "string"
        ? item.note
        : undefined;
    const why =
      "why" in item && typeof item.why === "string" ? item.why : undefined;
    const anchors =
      "anchors" in item && Array.isArray(item.anchors)
        ? item.anchors.filter(
            (a): a is string => typeof a === "string" && a.trim() !== "",
          )
        : undefined;
    out.push({
      topic,
      ...(note !== undefined ? { note } : {}),
      ...(why !== undefined ? { why } : {}),
      ...(anchors !== undefined ? { anchors } : {}),
    });
  }
  return out;
}

export async function runBacklogHarvest(
  opts: BacklogHarvestOptions,
): Promise<number> {
  const startedAt = Date.now();
  const repoRoot = findRepoRoot(opts.cwd ?? process.cwd());

  // Candidate docs: all scanned dirs merged, sorted, capped — determinism
  // matters because the cap decides WHICH docs get the LLM budget.
  const dirs = (opts.paths ?? "docs/plans,learnings")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "");
  const files: string[] = [];
  for (const dir of dirs) collectMarkdownFiles(path.join(repoRoot, dir), files);
  const docs = files
    .sort()
    .slice(0, MAX_FILES)
    .map((full) => {
      const text = readFileSync(full, "utf8");
      return { rel: path.relative(repoRoot, full), text };
    })
    .filter((d) => d.text.length >= MIN_FILE_CHARS)
    .map((d) => ({
      rel: d.rel,
      text: d.text.slice(0, MAX_FILE_CHARS),
    }));
  if (docs.length === 0) {
    console.log(`${MARK_WARN} no candidate docs (min ${MIN_FILE_CHARS} chars) under: ${dirs.join(", ")}`);
    return 0;
  }

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = opts.model ?? reviewCfg.primary;
  const fallbackName =
    chosenName === reviewCfg.primary
      ? reviewCfg.fallback
      : chosenName === reviewCfg.fallback
        ? reviewCfg.primary
        : undefined;
  const provider = providerInstance(chosenName);
  const fallback = fallbackName ? providerInstance(fallbackName) : undefined;

  const store = loadBacklogStore(repoRoot);
  const existingSlugs = new Set(
    store.ideas.map((e) => slugifyProjectName(e.topic)),
  );

  const added: BacklogEntry[] = [];
  const allPrompts: string[] = [];
  let deduped = 0;
  let overlapped = 0;
  let failedDocs = 0;
  const perDoc: { rel: string; scanned: number; added: number }[] = [];
  let servedName = chosenName;

  for (const doc of docs) {
    const messages: ChatMessage[] = [
      { role: "system", content: "You extract video topic candidates as YAML." },
      { role: "user", content: harvestPrompt(doc.text) },
    ];
    allPrompts.push(messages[1]?.content ?? "");
    let reply: string | undefined;
    try {
      reply = (await provider.chat({ messages, temperature: 0.4 })).content;
    } catch (err) {
      if (fallback !== undefined) {
        try {
          reply = (await fallback.chat({ messages, temperature: 0.4 })).content;
          servedName = fallbackName ?? chosenName;
        } catch {
          console.error(`${MARK_FAIL} ${doc.rel}: both providers failed`);
        }
      } else {
        console.error(`${MARK_FAIL} ${doc.rel}: ${(err as Error).message}`);
      }
    }
    if (reply === undefined) {
      failedDocs += 1;
      perDoc.push({ rel: doc.rel, scanned: 0, added: 0 });
      continue;
    }
    const candidates = parseCandidates(reply);
    if (candidates === null) {
      failedDocs += 1;
      // --dry-run promises zero file writes; the dump is the only write
      // this path would make, so it is gated on the same flag.
      if (opts.dryRun !== true) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const dumpDir = path.join(repoRoot, "runs");
        mkdirSync(dumpDir, { recursive: true });
        writeFileSync(
          path.join(dumpDir, `backlog-harvest-failed-${stamp}.yaml`),
          `# unparseable harvest output from ${doc.rel}\n${reply}\n`,
          "utf8",
        );
      }
      console.error(
        `${MARK_WARN} ${doc.rel}: unparseable LLM output — dumped to runs/, continuing`,
      );
      perDoc.push({ rel: doc.rel, scanned: 0, added: 0 });
      continue;
    }

    let docAdded = 0;
    for (const cand of candidates) {
      const slug = slugifyProjectName(cand.topic);
      if (existingSlugs.has(slug)) {
        deduped += 1;
        continue;
      }
      // Overlap is ADVISORY on harvested ideas (2026-11-19 dry-run: the
      // old auto-skip discarded fresh topics on shingle noise). The hit
      // is recorded in the note; the human approve step owns the call.
      const hits = scanOverlap(repoRoot, {
        topic: cand.topic,
        ...(cand.note !== undefined ? { note: cand.note } : {}),
        ...(cand.anchors !== undefined ? { anchors: cand.anchors } : {}),
      });
      const overlapText = hits
        .slice(0, 3)
        .map(
          (h) => `${h.project} (${h.keywords.slice(0, 3).join("、")})`,
        )
        .join("; ");
      if (hits.length > 0) {
        overlapped += 1;
        console.log(
          `  ${MARK_WARN} possible overlap — still proposing: ${overlapText} — "${cand.topic}"`,
        );
      }
      const whyText = [cand.why, cand.note]
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .join(" — ");
      const noteParts = [
        whyText !== "" ? whyText : `harvested from ${doc.rel}`,
        ...(hits.length > 0
          ? [`⚠ possible overlap: ${overlapText}`]
          : []),
      ];
      const entry: BacklogEntry = {
        id: nextBacklogId(cand.topic, [...store.ideas, ...added], backlogToday()),
        topic: cand.topic,
        status: "proposed",
        source: `harvest:${doc.rel}`,
        created: backlogToday(),
        note: `${noteParts.join(" — ")} (from ${doc.rel})`,
        ...(cand.anchors !== undefined && cand.anchors.length > 0
          ? { anchors: cand.anchors }
          : {}),
      };
      existingSlugs.add(slug);
      added.push(entry);
      store.ideas.push(entry);
      docAdded += 1;
    }
    perDoc.push({ rel: doc.rel, scanned: candidates.length, added: docAdded });
  }

  // Summary first — even a dry run reports what it would have done.
  console.log("");
  for (const d of perDoc) {
    console.log(
      `${MARK_OK} ${d.rel}: ${d.scanned} candidate(s), ${d.added} added`,
    );
  }
  console.log(
    `harvest totals: ${added.length} added, ${deduped} deduped, ${overlapped} overlap-skipped, ${failedDocs} failed doc(s)`,
  );

  if (opts.dryRun === true) {
    for (const e of added) {
      console.log(`would add: ${e.topic} [${e.id}] (${e.source})`);
    }
    console.log(`${MARK_WARN} dry run — nothing written`);
    return 0;
  }

  if (added.length > 0) {
    saveBacklogStore(repoRoot, store);
  }
  if (failedDocs === docs.length) {
    console.error(
      `${MARK_FAIL} every doc failed extraction — nothing trustworthy harvested`,
    );
    await writeRun(repoRoot, {
      run_id: formatRunId("backlog-harvest"),
      stage: "backlog-harvest",
      status: "failed",
      actor: "agent",
      tool: "video-backlog",
      input_commit: safeGitHead(repoRoot),
      input_files: docs.map((d) => d.rel),
      output_files: [],
      created_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error: `all ${docs.length} doc(s) failed extraction`,
      provider: servedName,
      model: servedName,
    });
    return 1;
  }

  await writeRun(repoRoot, {
    run_id: formatRunId("backlog-harvest"),
    stage: "backlog-harvest",
    status: "succeeded",
    actor: "agent",
    tool: "video-backlog",
    input_commit: safeGitHead(repoRoot),
    input_files: docs.map((d) => d.rel),
    output_files: added.length > 0 ? ["backlog.yaml"] : [],
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    provider: servedName,
    model: servedName,
    prompt_hash: `sha256:${createHash("sha256").update(allPrompts.join("\n\n")).digest("hex")}`,
    tokens: undefined,
    estimated_cost_usd: undefined,
  });
  console.log(`${MARK_OK} harvest run recorded in runs/`);
  return 0;
}

export function addHarvestCommand(backlog: Command): void {
  backlog
    .command("harvest")
    .description(
      "LLM-extract video topic candidates from docs into the backlog (status: proposed)",
    )
    .option("--dry-run", "print would-be additions; write nothing")
    .option(
      "--paths <paths>",
      "comma-separated repo-relative dirs to scan",
      "docs/plans,learnings",
    )
    .option("--model <model>", "force a provider: minimax | glm")
    .option("--cwd <dir>", "repo root (default: walk up to pnpm-workspace.yaml)")
    .action(async (opts) => {
      process.exitCode = await runBacklogHarvest({
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...(opts.paths !== undefined ? { paths: opts.paths } : {}),
        ...(opts.model !== undefined
          ? { model: opts.model as "minimax" | "glm" }
          : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
    });
}
