import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  GLMProvider,
  MiniMaxProvider,
  type Provider,
} from "@vf/llm";
import { MiniMaxWebSearch } from "@vf/research";
import { callDraft } from "@vf/draft";
import { slugifyProjectName } from "./project-path.js";

export interface DraftOptions {
  topic: string;
  cwd?: string;
  model?: "minimax" | "glm";
  lang?: "zh-CN" | "en-US";
  duration?: number;
  audience?: string;
  /** Path to a file containing pre-existing content to revise. */
  from?: string;
  noWeb?: boolean;
}

function providerInstance(name: "minimax" | "glm"): Provider {
  if (name === "glm") return new GLMProvider();
  return new MiniMaxProvider();
}

export async function runDraft(opts: DraftOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const projectId = slugifyProjectName(opts.topic);
  const projectRoot = path.join(cwd, "projects", projectId);

  if (!existsSync(projectRoot)) {
    console.error(`project not found: ${projectRoot}`);
    console.error(`hint: scaffold it with \`vf new <id>\` first, then re-run`);
    return 1;
  }

  let fromContent: string | undefined;
  if (opts.from) {
    const fromPath = path.resolve(opts.from);
    if (!existsSync(fromPath)) {
      console.error(`--from file not found: ${fromPath}`);
      return 1;
    }
    fromContent = await readFile(fromPath, "utf8");
  }

  const provider = providerInstance(opts.model ?? "glm");
  const language = opts.lang ?? "zh-CN";
  const duration = opts.duration ?? 40;
  const audience = opts.audience ?? "developers";

  let webContext:
    | { url: string; title: string; snippet: string }[]
    | undefined;
  if (!opts.noWeb) {
    try {
      webContext = await new MiniMaxWebSearch().search(opts.topic);
    } catch {
      webContext = undefined;
    }
  }

  const { markdown, usage } = await callDraft(
    {
      topic: opts.topic,
      audience,
      language,
      duration,
      ...(fromContent !== undefined ? { fromContent } : {}),
      ...(webContext && webContext.length > 0 ? { webContext } : {}),
    },
    provider,
  );

  const articlePath = path.join(projectRoot, "article.md");
  await mkdir(path.dirname(articlePath), { recursive: true });
  await writeFile(articlePath, markdown, "utf8");

  console.log(`✓ drafted ${articlePath}`);
  console.log(
    `  model=${opts.model ?? "glm"}  tokens=${usage.input}+${usage.output}`,
  );
  console.log(
    `  next: edit article.md to refine the narrative, then \`vf audio-plan <topic>\``,
  );
  return 0;
}
