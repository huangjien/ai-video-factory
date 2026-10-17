import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { resolveProjectDir } from "./project-path.js";
import { existsSync } from "node:fs";
import { GLMProvider, loadProviderConfig, MiniMaxProvider } from "@video/llm";
import {
  callYouTube,
  chaptersToVtt,
  exchangeCodeForTokens,
  parseClientSecret,
  uploadPreparedProject,
  YouTubeUploadError,
  type PrivacyStatus,
  type YouTubeCredentials,
  type YouTubeInput,
} from "@video/youtube";
import { parseArticleWithRecovery, type Scene } from "@video/draft";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ChatMessage, Provider } from "@video/llm";
import { formatRunId } from "@video/workflow";
import {
  MARK_FAIL,
  MARK_OK,
  MARK_RUN,
  brandBannerLine,
  channelHeader,
} from "./ui.js";

export interface YouTubeOptions {
  project: string;
  cwd?: string | undefined;
  model?: "minimax" | "glm" | undefined;
  /** v0.9.1: upload output/final-mixed.mp4 after packaging. */
  upload?: boolean;
  /** Upload privacy (default private — testing-mode OAuth apps lock
   *  uploads private anyway until the app is verified). */
  privacy?: PrivacyStatus;
  /** Path to client_secret.json for --upload / --auth. */
  clientSecretPath?: string | undefined;
}

function providerInstance(name: string): Provider {
  if (name === "glm") return new GLMProvider();
  if (name === "minimax") return new MiniMaxProvider();
  throw new Error(`unsupported provider: ${name}`);
}

/** Model id stamped for a provider name — matches each provider's own
 * default (GLM: glm-5.3, MiniMax: MiniMax-M3). Re-derived from the
 * SERVING provider after failover so the run record never claims the
 * wrong model. */
function modelFor(name: string): string {
  return name === "glm" ? "glm-5.3" : "MiniMax-M3";
}

function sha256OfMessages(messages: ChatMessage[]): string {
  const canon = JSON.stringify(
    messages.map((m) => ({ role: m.role, content: m.content })),
  );
  return "sha256:" + createHash("sha256").update(canon).digest("hex");
}

function safeGitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Where client_secret.json lives unless --client-secret says otherwise. */
function defaultClientSecretPath(): string {
  return (
    process.env["YOUTUBE_CLIENT_SECRET_FILE"] ??
    path.join(
      process.env["HOME"] ?? "~",
      ".config",
      "secrets",
      "client_secret_youtube.json",
    )
  );
}

/** Load OAuth credentials for upload. Every failure message says what to
 *  do next — the one-time `video youtube --auth` is the usual fix. */
export async function resolveYouTubeCredentials(
  clientSecretPath?: string,
): Promise<YouTubeCredentials> {
  const file = clientSecretPath ?? defaultClientSecretPath();
  if (!existsSync(file)) {
    throw new YouTubeUploadError(
      `client secret not found: ${file}\n` +
        "  Create a Google Cloud project → enable YouTube Data API v3 → OAuth consent screen\n" +
        "  (add your account as Test user, scope youtube.upload) → Credentials → OAuth client\n" +
        "  ID (Desktop app) → download client_secret.json, then run `video youtube --auth`.",
    );
  }
  const { readFile } = await import("node:fs/promises");
  const { clientId, clientSecret } = parseClientSecret(
    await readFile(file, "utf8"),
  );
  const refreshToken = process.env["YOUTUBE_REFRESH_TOKEN"];
  if (!refreshToken) {
    throw new YouTubeUploadError(
      "YOUTUBE_REFRESH_TOKEN not set — run `video youtube --auth` once to mint it",
    );
  }
  return { clientId, clientSecret, refreshToken };
}

/** One-time OAuth consent (loopback redirect). Opens the browser, waits
 *  for the code, exchanges it, prints the env lines to store. */
export async function runYouTubeAuth(
  clientSecretPath?: string,
): Promise<number> {
  const file = clientSecretPath ?? defaultClientSecretPath();
  if (!existsSync(file)) {
    console.error(`${MARK_FAIL} client secret not found: ${file}`);
    console.error("  Get one (one-time, ~15 min):");
    console.error("  1. console.cloud.google.com → create project");
    console.error(
      "  2. APIs & Services → Library → enable YouTube Data API v3",
    );
    console.error(
      "  3. OAuth consent screen → External → add your Google account as Test user, scope youtube.upload",
    );
    console.error(
      "  4. Credentials → Create OAuth client ID → Desktop app → download client_secret.json",
    );
    console.error(
      `  5. Save it as ${file} (or pass --client-secret <path> / set YOUTUBE_CLIENT_SECRET_FILE)`,
    );
    return 1;
  }
  const { readFile } = await import("node:fs/promises");
  const { clientId, clientSecret } = parseClientSecret(
    await readFile(file, "utf8"),
  );

  const { buildAuthUrl } = await import("@video/youtube");
  const granted = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      let redirectUri = "";
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          code
            ? "<h3>Authorized. Return to the terminal.</h3>"
            : `<h3>Failed: ${error ?? "no code"}</h3>`,
        );
        server.close();
        if (code) resolve({ code, redirectUri });
        else reject(new Error(`consent denied: ${error ?? "no code"}`));
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        redirectUri = `http://127.0.0.1:${port}`;
        const authUrl = buildAuthUrl({ clientId, redirectUri });
        console.log("opening browser for Google consent…");
        console.log(`  (if nothing opens, visit:)\n  ${authUrl}\n`);
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        try {
          spawn(opener, [authUrl], { stdio: "ignore", detached: true }).unref();
        } catch {
          // URL is printed above; manual visit works the same.
        }
      });
      setTimeout(
        () => {
          server.close();
          reject(new Error("consent timed out after 5 minutes"));
        },
        5 * 60 * 1000,
      ).unref();
    },
  );
  const tokens = await exchangeCodeForTokens({
    clientId,
    clientSecret,
    redirectUri: granted.redirectUri,
    code: granted.code,
  });
  console.log(brandBannerLine());
  console.log(`${MARK_OK} YouTube OAuth authorized`);
  console.log(
    "\nAdd these lines to ~/.config/secrets/ai.env (then restart your shell):\n",
  );
  console.log(`  YOUTUBE_CLIENT_SECRET_FILE=${file}`);
  console.log(`  YOUTUBE_REFRESH_TOKEN=${tokens.refreshToken}\n`);
  console.log(
    "Notes: while the OAuth app stays in Testing status, refresh tokens",
  );
  console.log(
    "  expire after 7 days (re-run --auth) and uploads land LOCKED PRIVATE —",
  );
  console.log(
    "  flip them to public in YouTube Studio, or push the app through Google's",
  );
  console.log("  verification to unlock public uploads + long-lived tokens.");
  return 0;
}

export async function runYouTube(opts: YouTubeOptions): Promise<number> {
  const cwd = path.resolve(opts.cwd ?? ".");
  const resolvedProject = resolveProjectDir(opts.project, opts.cwd);
  if (!resolvedProject.ok) {
    console.error(resolvedProject.message);
    return 1;
  }
  const projectRoot = resolvedProject.root;
  const { readFile } = await import("node:fs/promises");

  // Two input shapes supported: article.md (preferred) OR the legacy triple
  // (research.md + script.md + storyboard.yaml). The agent takes the
  // legacy triple; article.md is synthesized to that shape below.
  let articleInput: ReturnType<typeof synthFromArticle> | null = null;
  let legacyInput: YouTubeInput | null = null;
  const articlePath = path.join(projectRoot, "article.md");
  if (existsSync(articlePath)) {
    const articleMd = await readFile(articlePath, "utf8");
    // Prefer the RENDERED storyboard's durations when it covers the same
    // scenes — chapter offsets must sum to the real runtime.
    const renderedPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
    const rendered = existsSync(renderedPath)
      ? await readFile(renderedPath, "utf8")
      : undefined;
    const sceneCount = parseArticleWithRecovery(articleMd).article.scenes.length;
    articleInput = synthFromArticle(
      articleMd,
      readSyncedDurations(rendered, sceneCount),
    );
  } else {
    const sbPath = path.join(projectRoot, "storyboard", "storyboard.yaml");
    const scriptPath = path.join(projectRoot, "script", "script.zh-CN.md");
    const researchMdPath = path.join(projectRoot, "research", "research.md");
    for (const f of [sbPath, scriptPath, researchMdPath]) {
      if (!existsSync(f)) {
        console.error(`missing input: ${f}`);
        console.error(
          `  run \`video draft <topic>\` to generate article.md (preferred),`,
        );
        console.error(
          `  or run the legacy pipeline: video research / video script / video storyboard`,
        );
        return 1;
      }
    }
    legacyInput = {
      storyboard: await readFile(sbPath, "utf8"),
      script: await readFile(scriptPath, "utf8"),
      research: await readFile(researchMdPath, "utf8"),
    };
  }
  const input: YouTubeInput = articleInput ?? (legacyInput as YouTubeInput);
  const inputFiles = articleInput
    ? ["article.md"]
    : [
        "storyboard/storyboard.yaml",
        "script/script.zh-CN.md",
        "research/research.md",
      ];

  const cfg = loadProviderConfig();
  const reviewCfg = cfg["review"];
  const chosenName = opts.model ?? reviewCfg.primary;
  const provider = providerInstance(chosenName);
  const fallbackName =
    chosenName === reviewCfg.primary
      ? reviewCfg.fallback
      : chosenName === reviewCfg.fallback
        ? reviewCfg.primary
        : undefined;
  const fallback = fallbackName ? providerInstance(fallbackName) : null;

  let result;
  try {
    result = await callYouTube(input, provider, fallback);
  } catch (err) {
    const msg = (err as Error).message;
    // v0.4 (T4): retry once if the validator caught a text-overlay
    // thumbnail prompt. We append an explicit negative-constraint to
    // the user prompt; one retry is enough — second failure surfaces.
    if (msg.includes("banned tokens") || msg.includes("thumbnail_prompt")) {
      console.warn(
        `  ${MARK_RUN} retrying once with stricter negative constraints…`,
      );
      try {
        const tightened: YouTubeInput = {
          ...input,
          hook:
            (input.hook ?? "") +
            "\n\nREMINDER: The thumbnail prompt must be a pure visual scene, never a poster with text. Avoid any text, subtitles, watermarks, logos, or captions in the image.",
        };
        result = await callYouTube(tightened, provider, fallback);
      } catch (retryErr) {
        console.error(
          `${MARK_FAIL} ${chosenName} youtube agent failed:`,
          (retryErr as Error).message,
        );
        return 1;
      }
    } else {
      console.error(`${MARK_FAIL} ${chosenName} youtube agent failed:`, msg);
      return 1;
    }
  }

  await mkdir(path.join(projectRoot, "youtube"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "youtube", "title.txt"),
    result.youtube.title + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "description.md"),
    result.youtube.description + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "package.yaml"),
    yamlStringify(result.youtube),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "chapters.vtt"),
    chaptersToVtt(result.youtube.chapters),
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "thumbnail-prompt.txt"),
    result.youtube.thumbnail_prompt + "\n",
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, "youtube", "shorts-hook.txt"),
    result.youtube.shorts_hook + "\n",
    "utf8",
  );

  // Run record — model reflects the SERVING provider (may differ from the
  // chosen one after failover) and prompt_hash hashes the messages the
  // agent actually sent (result.messages), not a reconstructed placeholder.
  const runId = formatRunId("youtube");
  const servedModel = modelFor(result.providerName);
  const record = {
    run_id: runId,
    stage: "youtube",
    status: "succeeded" as const,
    actor: "agent" as const,
    tool: "video-youtube",
    input_commit: safeGitHead(projectRoot),
    input_files: inputFiles,
    output_files: [
      "youtube/title.txt",
      "youtube/description.md",
      "youtube/package.yaml",
      "youtube/chapters.vtt",
      "youtube/thumbnail-prompt.txt",
      "youtube/shorts-hook.txt",
    ],
    created_at: new Date().toISOString(),
    duration_ms: 0,
    provider: result.providerName,
    model: servedModel,
    prompt_hash: sha256OfMessages(result.messages),
    tokens: result.usage,
    estimated_cost_usd:
      (result.usage.input / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001) +
      (result.usage.output / 1000) *
        (result.providerName === "glm" ? 0.0008 : 0.001),
  };
  const { writeRun } = await import("@video/workflow");
  await writeRun(projectRoot, record);

  console.log(brandBannerLine());
  console.log(channelHeader(opts.project, `youtube · ${result.providerName}`));
  console.log("");
  console.log(`${MARK_OK} packaged projects/${opts.project}/youtube/`);
  console.log(`  title: ${result.youtube.title}`);
  console.log(
    `  chapters: ${result.youtube.chapters.length} · vtt=youtube/chapters.vtt`,
  );
  if (!opts.upload) {
    console.log(
      `  next: \`video youtube ${opts.project} --upload\` publishes directly, or copy title + description into YouTube Studio`,
    );
    return 0;
  }

  // v0.9.1: direct publish. Credentials failures surface the one-time
  // `--auth` fix; upload failures keep the packaged files on disk.
  let creds: YouTubeCredentials;
  try {
    creds = await resolveYouTubeCredentials(opts.clientSecretPath);
  } catch (err) {
    if (err instanceof YouTubeUploadError) {
      console.error(`${MARK_FAIL} ${err.message}`);
      return 1;
    }
    throw err;
  }
  const privacy = opts.privacy ?? "private";
  console.log(`  uploading final-mixed.mp4 (${privacy})…`);
  try {
    const uploaded = await uploadPreparedProject({
      creds,
      projectRoot,
      privacyStatus: privacy,
    });
    console.log(`${MARK_OK} uploaded ${uploaded.watchUrl}`);
    console.log(
      uploaded.thumbnailSet
        ? `  thumbnail set from youtube/thumbnail.png|jpg`
        : `  note: no youtube/thumbnail.png|jpg — run \`video thumbnail ${opts.project}\` and set it in Studio`,
    );
    if (privacy === "private") {
      console.log(
        "  note: uploaded PRIVATE — testing-mode OAuth apps lock uploads private;",
      );
      console.log("  flip to public in YouTube Studio when ready");
    }
  } catch (err) {
    if (err instanceof YouTubeUploadError) {
      console.error(`${MARK_FAIL} upload failed: ${err.message}`);
      console.error("  package files remain on disk — nothing was published");
      return 1;
    }
    throw err;
  }
  return 0;
}

/** Build a legacy-shaped YouTubeInput from the new article.md —
 * the YouTube agent consumes three string fields; this maps each.
 * v0.4 (T4): also extract the article's hook (first 1-3 prose sentences)
 * and topic so the agent can anchor the thumbnail's emotional tone.
 *
 * `syncedDurations`, when supplied, come from the RENDERED storyboard.yaml
 * (see readSyncedDurations). Chapter timestamps are cumulative offsets into
 * the finished MP4, so they must be summed from the durations the renderer
 * actually used — not from the article's declared ones. */
function synthFromArticle(
  articleMd: string,
  syncedDurations?: number[] | undefined,
): YouTubeInput {
  const { article } = parseArticleWithRecovery(articleMd);
  const storyboard = synthStoryboardYaml(article.scenes, syncedDurations);
  const script = `# ${article.frontmatter.project}\n\n${article.proseBody.trim()}\n`;
  const research = articleMd;
  return {
    storyboard,
    script,
    research,
    hook: extractHook(article.proseBody),
    topic: article.frontmatter.project,
  };
}

/** Read the per-scene durations from the rendered storyboard.yaml, when it
 * describes the same scene count as the article.
 *
 * `video make` rewrites those durations from the real TTS WAVs
 * (syncStoryboardDurations), so they are the only numbers that match the
 * rendered MP4. Without this, packaging sums the article's DECLARED
 * durations: chapters drift by the difference, and once the declared total
 * exceeds the real runtime the tail chapters point past the end of the
 * video — which YouTube silently drops, leaving the chapter list wrong for
 * everything after the first divergence.
 *
 * Returns null when there is no rendered storyboard, when it cannot be
 * parsed, or when its scene count differs from the article's (in which case
 * its index→scene mapping is unknown and trusting it would be worse than
 * falling back to the declared values). */
function readSyncedDurations(
  storyboardYaml: string | undefined,
  sceneCount: number,
): number[] | undefined {
  if (storyboardYaml === undefined) return undefined;
  let parsed: { scenes?: { duration?: unknown }[] };
  try {
    parsed = parseYaml(storyboardYaml) as typeof parsed;
  } catch {
    return undefined;
  }
  const scenes = parsed.scenes;
  if (!Array.isArray(scenes) || scenes.length !== sceneCount) return undefined;
  const durations = scenes.map((s) =>
    typeof s.duration === "number" && Number.isFinite(s.duration)
      ? s.duration
      : Number.NaN,
  );
  return durations.every((d) => Number.isFinite(d)) ? durations : undefined;
}

/** Pull the first 1-3 sentences of the prose body. Falls back to empty
 *  string when the body starts with a heading (e.g. when the LLM wrote
 *  an empty body). */
function extractHook(proseBody: string): string {
  const trimmed = proseBody.trim();
  // Skip leading H1 / H2 heading lines.
  const lines = trimmed.split("\n").filter((l) => !l.startsWith("#"));
  const text = lines.join(" ").trim();
  if (!text) return "";
  const sentences: string[] = [];
  const re = /[^。.!?！？\n]+[。.!?！？]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && sentences.length < 3) {
    sentences.push(m[0].trim());
  }
  return sentences.join(" ").slice(0, 400);
}

function synthStoryboardYaml(
  scenes: Scene[],
  syncedDurations?: number[] | undefined,
): string {
  const lines = [
    `scenes:`,
    ...scenes.flatMap((s, i) => [
      `  - id: ${s.id}`,
      `    duration: ${syncedDurations?.[i] ?? s.duration}`,
      `    caption: ${yamlScalar(s.caption)}`,
      `    visual: ${yamlScalar(s.visual)}`,
    ]),
  ];
  return lines.join("\n") + "\n";
}

function yamlScalar(s: string): string {
  if (/[:#\n]/.test(s)) return JSON.stringify(s);
  return s;
}

export function registerYouTube(program: Command): void {
  program
    .command("youtube")
    .argument(
      "[project]",
      "project to package: topic, folder name, path, or unique prefix (omit with --auth)",
    )
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--model <provider>",
      "model provider: minimax|glm (default: review-role config)",
    )
    .option(
      "--upload",
      "after packaging, upload output/final-mixed.mp4 + thumbnail to YouTube (needs `video youtube --auth` once)",
    )
    .option(
      "--privacy <status>",
      "upload privacy: private|unlisted|public (default private)",
      "private",
    )
    .option(
      "--auth",
      "one-time OAuth consent: mint YOUTUBE_REFRESH_TOKEN (no project needed)",
    )
    .option(
      "--client-secret <path>",
      "client_secret.json location (default: $YOUTUBE_CLIENT_SECRET_FILE or ~/.config/secrets/client_secret_youtube.json)",
    )
    .action(
      async (
        project: string | undefined,
        opts: {
          cwd?: string;
          model?: "minimax" | "glm";
          upload?: boolean;
          privacy?: string;
          auth?: boolean;
          clientSecret?: string;
        },
      ) => {
        if (opts.auth) {
          process.exitCode = await runYouTubeAuth(opts.clientSecret);
          return;
        }
        if (!project) {
          console.error(
            "project required (or use `video youtube --auth` for the one-time OAuth setup)",
          );
          process.exitCode = 1;
          return;
        }
        if (
          opts.privacy !== undefined &&
          !["private", "unlisted", "public"].includes(opts.privacy)
        ) {
          console.error(
            `--privacy must be private|unlisted|public (got ${opts.privacy})`,
          );
          process.exitCode = 1;
          return;
        }
        process.exitCode = await runYouTube({
          project,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
          ...(opts.upload ? { upload: true } : {}),
          ...(opts.privacy !== undefined
            ? { privacy: opts.privacy as PrivacyStatus }
            : {}),
          ...(opts.clientSecret !== undefined
            ? { clientSecretPath: opts.clientSecret }
            : {}),
        });
      },
    );
}
