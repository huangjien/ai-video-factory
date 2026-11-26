import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { parse } from "yaml";
import {
  consultDecisionMany,
  createDecisionProvider,
  validateDecisionBatch,
  type DecisionInputPart,
  type DecisionProvider,
  type DecisionQuestion,
} from "@video/llm";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

interface InspectFileBlock {
  type: "image" | "audio" | "video" | "document";
  path: string;
  mimeType?: string;
}

export async function loadDecisionInspectRequest(requestPath: string) {
  const absoluteRequestPath = path.resolve(requestPath);
  const source = await readFile(absoluteRequestPath, "utf8");
  const doc = parse(source) as {
    input?: unknown;
    questions?: unknown;
  };
  if (!doc || !Array.isArray(doc.input) || !Array.isArray(doc.questions)) {
    throw new Error("request YAML must contain input and questions arrays");
  }
  const input: DecisionInputPart[] = [];
  const attachments: {
    file: string;
    mimeType: string;
    bytes: number;
    sha256: string;
  }[] = [];
  for (const [index, raw] of doc.input.entries()) {
    if (!raw || typeof raw !== "object")
      throw new Error(`input[${index}] must be a mapping`);
    const block = raw as Record<string, unknown>;
    if (block["type"] === "text" && typeof block["text"] === "string") {
      input.push({ type: "text", text: block["text"] });
      continue;
    }
    const type = block["type"];
    if (
      type !== "image" &&
      type !== "audio" &&
      type !== "video" &&
      type !== "document"
    ) {
      throw new Error(
        `input[${index}].type must be text, image, audio, video, or document`,
      );
    }
    if (typeof block["path"] !== "string" || block["path"].trim() === "") {
      throw new Error(`input[${index}].path is required`);
    }
    const filePath = path.resolve(
      path.dirname(absoluteRequestPath),
      block["path"],
    );
    const extensionMime =
      MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    const mimeType =
      typeof block["mimeType"] === "string" ? block["mimeType"] : extensionMime;
    if (!mimeType)
      throw new Error(`cannot infer MIME type for ${path.basename(filePath)}`);
    if (type === "document" && mimeType !== "application/pdf") {
      throw new Error("document input currently supports PDF only");
    }
    if (type !== "document" && !mimeType.startsWith(`${type}/`)) {
      throw new Error(
        `MIME type ${mimeType} does not match input type ${type}`,
      );
    }
    const data = await readFile(filePath);
    input.push({ type, mimeType, data, name: path.basename(filePath) });
    attachments.push({
      file: path.basename(filePath),
      mimeType,
      bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  const questions = doc.questions.map((raw, index) => {
    if (!raw || typeof raw !== "object")
      throw new Error(`questions[${index}] must be a mapping`);
    const { minConfidence, ...question } = raw as Record<string, unknown>;
    if (minConfidence !== undefined && typeof minConfidence !== "number") {
      throw new Error(`questions[${index}].minConfidence must be a number`);
    }
    return {
      question: question as unknown as DecisionQuestion,
      ...(minConfidence !== undefined ? { minConfidence } : {}),
    };
  });
  const request = { input, questions };
  validateDecisionBatch(request);
  return { request, attachments };
}

export async function inspectDecision(opts: {
  requestPath: string;
  provider?: DecisionProvider;
}) {
  const loaded = await loadDecisionInspectRequest(opts.requestPath);
  const provider =
    opts.provider ??
    createDecisionProvider({
      ...(process.env["DECISION_PROVIDER"] !== undefined
        ? { provider: process.env["DECISION_PROVIDER"] }
        : {}),
      ...(process.env["DECISION_MODEL"] !== undefined
        ? { model: process.env["DECISION_MODEL"] }
        : {}),
    });
  if (!provider.available())
    throw new Error(`provider unavailable: ${provider.name}`);
  const result = await consultDecisionMany({
    provider,
    request: loaded.request,
  });
  return { ...result, attachments: loaded.attachments };
}

/** `video decision` — the group. The layer's advisory surfaces consult
 *  it; this verb evaluates typed questions against shared text and local
 *  media. */
export function registerDecision(program: Command): void {
  const decision = program
    .command("decision")
    .description(
      "Decision layer tools: `video decision inspect` evaluates shared text and media.",
    );

  registerDecisionInspect(decision);
}

export function registerDecisionInspect(decision: Command): void {
  decision
    .command("inspect")
    .description(
      "Evaluate multiple typed questions against shared text and local media.",
    )
    .requiredOption(
      "--request <yaml>",
      "YAML request file; media paths are relative to it",
    )
    .option("--json", "print machine-readable JSON (the default)")
    .action(async (options: { request: string }) => {
      try {
        const result = await inspectDecision({ requestPath: options.request });
        console.log(JSON.stringify(result, null, 2));
        if (result.answers.some((answer) => answer.answer === null))
          process.exitCode = 1;
      } catch (err) {
        console.error(`decision inspect failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
