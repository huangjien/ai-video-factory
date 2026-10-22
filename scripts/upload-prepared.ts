/**
 * Upload an already-packaged project to YouTube, bypassing `video youtube
 * --upload` (which re-runs the LLM packaging agent first — it has failed
 * twice on malformed YAML / banned-token rejections, and it would throw away
 * a package that is already on disk and reviewed).
 *
 * Reads projects/<id>/youtube/package.yaml + youtube/thumbnail.jpg, so run
 * `video youtube <project>` and `video thumbnail <project>` first.
 *
 * Usage: node --experimental-strip-types scripts/upload-prepared.ts <project> [private|unlisted|public]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseClientSecret,
  uploadPreparedProject,
} from "../packages/youtube/dist/index.js";

const [, , projectArg, privacyArg] = process.argv;
if (!projectArg) {
  console.error("usage: upload-prepared.ts <project> [privacy]");
  process.exit(1);
}
const privacyStatus = (privacyArg ?? "private") as
  "private" | "unlisted" | "public";

const repoRoot = path.resolve(import.meta.dirname, "..");
const projectRoot = path.join(repoRoot, "projects", projectArg);

const secretPath =
  process.env["YOUTUBE_CLIENT_SECRET_FILE"] ??
  path.join(
    process.env["HOME"] ?? "",
    ".config/secrets/client_secret_youtube.json",
  );
const { clientId, clientSecret } = parseClientSecret(
  await readFile(secretPath, "utf8"),
);
const refreshToken = process.env["YOUTUBE_REFRESH_TOKEN"];
if (!refreshToken) {
  throw new Error("YOUTUBE_REFRESH_TOKEN not set — run `video youtube --auth`");
}

console.log(`uploading ${projectRoot} as ${privacyStatus} …`);
const result = await uploadPreparedProject({
  creds: { clientId, clientSecret, refreshToken },
  projectRoot,
  privacyStatus,
});
console.log(JSON.stringify(result, null, 2));
