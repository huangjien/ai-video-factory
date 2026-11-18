#!/usr/bin/env node
/**
 * A/B the OpenAI image model against MiniMax image-01 — the pipeline's
 * default — on a REAL shipped scene prompt.
 *
 * Same prompt, same aspect, same machine, same minute: measure wall
 * clock, the billed tokens, and write both PNGs side by side so the
 * quality question can be answered by looking, not by guessing.
 *
 *   node scripts/measure-image-providers.mjs [--prompt <file>] [--out <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MiniMaxImageProvider } from "../packages/media-generators/dist/minimax-image.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const promptFile = argOf(
  "--prompt",
  path.join(
    repoRoot,
    "projects/孙子兵法的数学原理-en/assets/images/scene_1.prompt.txt",
  ),
);
const outDir = argOf("--out", path.join(repoRoot, "runs/image-provider-ab"));
mkdirSync(outDir, { recursive: true });

const prompt = readFileSync(promptFile, "utf8");
const WIDTH = 1920;
const HEIGHT = 1080;

/** The OpenAI image model, called directly so the usage comes back. */
async function openaiImage(model, quality, size) {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1,
      output_format: "png",
    }),
  });
  const body = await res.json();
  const ms = Date.now() - started;
  if (!res.ok) {
    return {
      error: `${res.status}: ${JSON.stringify(body).slice(0, 200)}`,
      ms,
    };
  }
  const usage = body.usage ?? {};
  const bytes = Buffer.from(body.data?.[0]?.b64_json ?? "", "base64");
  return {
    ms,
    bytes,
    usage,
    // $30 / 1M image output tokens, $5 / 1M text input (standard tier).
    cost:
      ((usage.output_tokens ?? 0) / 1e6) * 30 +
      ((usage.input_tokens ?? 0) / 1e6) * 5,
  };
}

const rows = [];

for (const [model, quality, size] of [
  ["gpt-image-2.6-flare", "low", "1536x1024"],
  ["gpt-image-2.6-flare", "medium", "1536x1024"],
  ["gpt-image-2.6-flare", "high", "1536x1024"],
  ["gpt-image-2.6-sunburst", "medium", "1536x1024"],
]) {
  const r = await openaiImage(model, quality, size);
  if (r.error) {
    rows.push({ provider: `${model} ${quality}`, error: r.error, ms: r.ms });
    continue;
  }
  const file = path.join(outDir, `openai-${model}-${quality}.png`);
  writeFileSync(file, r.bytes);
  rows.push({
    provider: `${model} ${quality}`,
    ms: r.ms,
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cost: r.cost,
    bytes: r.bytes.length,
    file,
  });
}

// MiniMax image-01 through the repo's own provider — the pipeline path.
{
  const provider = new MiniMaxImageProvider();
  const started = Date.now();
  try {
    const result = await provider.generate({
      prompt,
      width: WIDTH,
      height: HEIGHT,
    });
    const ms = Date.now() - started;
    const file = path.join(outDir, "minimax-image-01.png");
    writeFileSync(file, result.bytes);
    rows.push({
      provider: "minimax image-01 (repo provider)",
      ms,
      bytes: result.bytes.length,
      file,
    });
  } catch (err) {
    rows.push({ provider: "minimax image-01", error: String(err) });
  }
}

console.log(
  `prompt: ${path.relative(repoRoot, promptFile)} (${prompt.length} chars)`,
);
console.log(`out:    ${path.relative(repoRoot, outDir)}\n`);
for (const r of rows) {
  if (r.error) {
    console.log(`${r.provider.padEnd(34)} ERROR ${r.error}`);
    continue;
  }
  console.log(
    `${r.provider.padEnd(34)} ${String(Math.round(r.ms / 100) / 10).padStart(6)} s  ` +
      (r.outputTokens !== undefined
        ? `in ${String(r.inputTokens).padStart(5)} / out ${String(r.outputTokens).padStart(5)} tok  ` +
          `$${(r.cost ?? 0).toFixed(5)}  `
        : "") +
      `${(r.bytes / 1024).toFixed(0)} KB`,
  );
}
