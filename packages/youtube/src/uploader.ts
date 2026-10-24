/**
 * v0.9.1 — YouTube upload (direct publishing).
 *
 * `video youtube` packages metadata (title/description/chapters); this
 * module closes the loop: OAuth token refresh, resumable video upload,
 * thumbnail set. Chapters activate in the YouTube UI when the description
 * starts with a `00:00 …` timestamp block, so `uploadPreparedProject`
 * assembles description = chapters block + agent description.
 *
 * Credentials (one-time, via `video youtube --auth`):
 *   YOUTUBE_CLIENT_SECRET_FILE — path to a Desktop-app client_secret.json
 *   YOUTUBE_REFRESH_TOKEN      — minted by the consent flow
 * Scope: youtube.upload (also covers thumbnails.set). API-key auth cannot
 * upload — OAuth is required by the YouTube Data API.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { withRetry } from "@video/llm";
import type { Chapter } from "./schemas.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const THUMBNAIL_URL =
  "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
export const YOUTUBE_UPLOAD_SCOPE =
  "https://www.googleapis.com/auth/youtube.upload";
/** The broader manage scope: videos.update (privacy status) and
 * videos.delete. The upload-only scope CANNOT do either — the API answers
 * 403 "insufficient authentication scopes" (2026-10-24: replacing an
 * uploaded video needed exactly these two calls). */
export const YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube";

export type FetchImpl = typeof fetch;

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type PrivacyStatus = "private" | "unlisted" | "public";

export class YouTubeUploadError extends Error {
  override readonly cause: unknown;
  constructor(
    message: string,
    /** HTTP status when the API answered, undefined for local errors. */
    public readonly status?: number,
    /** API error reason (quotaExceeded, invalid_grant, …). */
    public readonly reason?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "YouTubeUploadError";
    this.cause = cause;
  }
}

/** Accepts both `{"installed": {...}}` (Desktop app) and `{"web": {...}}`. */
export function parseClientSecret(json: string): {
  clientId: string;
  clientSecret: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new YouTubeUploadError(
      "client_secret.json is not valid JSON",
      undefined,
      undefined,
      err,
    );
  }
  const sec =
    (parsed as { installed?: unknown; web?: unknown }).installed ??
    (parsed as { web?: unknown }).web;
  const clientId = (sec as { client_id?: unknown } | undefined)?.client_id;
  const clientSecret = (sec as { client_secret?: unknown } | undefined)
    ?.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new YouTubeUploadError(
      "client_secret.json has no installed/web client_id + client_secret — create an OAuth client of type Desktop app",
    );
  }
  return { clientId, clientSecret };
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  /** Scope to request. Defaults to the upload-only scope; pass
   * `YOUTUBE_MANAGE_SCOPE` (or a space-joined list) to also allow
   * privacy changes and deletes. */
  scope?: string | undefined;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope ?? YOUTUBE_UPLOAD_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange the authorization code (loopback redirect) for tokens. */
export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetchImpl?: FetchImpl;
}): Promise<{ refreshToken: string; accessToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });
  const tokens = await tokenRequest(body, opts.fetchImpl ?? fetch);
  if (tokens.refreshToken === undefined) {
    throw new YouTubeUploadError(
      "consent response had no refresh_token — retry `video youtube --auth` (the auth URL forces prompt=consent)",
    );
  }
  return { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken };
}

export async function refreshAccessToken(
  creds: Pick<YouTubeCredentials, "clientId" | "clientSecret" | "refreshToken">,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const json = await tokenRequest(body, fetchImpl);
  return json.accessToken;
}

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: FetchImpl = fetch,
): Promise<{ accessToken: string; refreshToken?: string }> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new YouTubeUploadError(
      `token endpoint unreachable: ${(err as Error).message}`,
      undefined,
      "network",
      err,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const reason = parseErrorReason(text);
    throw new YouTubeUploadError(
      `token endpoint ${res.status}${reason ? ` (${reason})` : ""}: ${text.slice(0, 200)}`,
      res.status,
      reason,
    );
  }
  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (typeof parsed.access_token !== "string") {
    throw new YouTubeUploadError("token response had no access_token");
  }
  return {
    accessToken: parsed.access_token,
    ...(parsed.refresh_token !== undefined
      ? { refreshToken: parsed.refresh_token }
      : {}),
  };
}

/** `00:00 Intro` lines — YouTube activates chapters when the description's
 *  timestamp block starts at 00:00. */
export function chaptersBlock(chapters: Chapter[]): string {
  return chapters.map((c) => `${c.timestamp} ${c.title}`).join("\n");
}

export interface UploadResult {
  videoId: string;
  watchUrl: string;
  /** False when no thumbnail file existed (warned by the caller). */
  thumbnailSet: boolean;
}

/** Upload one video: mint access token, open a resumable session, PUT the
 *  file. Transient failures (5xx / network) retry bounded; 4xx surface
 *  immediately with the API's reason. */
export async function uploadVideo(opts: {
  creds: YouTubeCredentials;
  videoBytes: Uint8Array;
  title: string;
  description: string;
  privacyStatus: PrivacyStatus;
  fetchImpl?: FetchImpl;
  retrySleeps?: number[];
}): Promise<{ videoId: string; watchUrl: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const accessToken = await refreshAccessToken(opts.creds, doFetch);

  const init = await withRetry(
    async () => {
      const res = await doFetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          snippet: {
            title: opts.title.slice(0, 100),
            description: opts.description,
          },
          status: {
            privacyStatus: opts.privacyStatus,
            selfDeclaredMadeForKids: false,
          },
        }),
      });
      if (!res.ok) {
        throw httpError("resumable session init", res.status, await res.text());
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new YouTubeUploadError(
          "resumable session init returned no Location header",
        );
      }
      return location;
    },
    {
      sleeps: opts.retrySleeps,
      isRetriable: (err) =>
        err instanceof YouTubeUploadError &&
        (err.reason === "network" || (err.status ?? 0) >= 500),
    },
  );

  const upload = await withRetry(
    async () => {
      const res = await doFetch(init, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: opts.videoBytes,
      });
      if (!res.ok) {
        throw httpError("video upload", res.status, await res.text());
      }
      return (JSON.parse(await res.text()) as { id?: string }).id;
    },
    {
      sleeps: opts.retrySleeps,
      isRetriable: (err) =>
        err instanceof YouTubeUploadError &&
        (err.reason === "network" || (err.status ?? 0) >= 500),
    },
  );
  if (typeof upload !== "string" || upload.length === 0) {
    throw new YouTubeUploadError("upload response had no video id");
  }
  return { videoId: upload, watchUrl: `https://youtu.be/${upload}` };
}

/** Flip an existing upload's visibility (videos.update, part=status).
 * Needs the MANAGE scope — an upload-only token answers 403. */
export async function setVideoPrivacy(opts: {
  accessToken: string;
  videoId: string;
  privacyStatus: PrivacyStatus;
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(opts.videoId)}&part=status`;
  const res = await doFetch(url, {
    // PUT, not PATCH: the YouTube Data API's videos.update is a PUT.
    // A PATCH answers 404 with an empty body (verified 2026-10-24 — every
    // PATCH variant, with and without snippet, 404'd while the same
    // payload as PUT returned 200 and flipped privacyStatus).
    method: "PUT",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: opts.videoId,
      status: { privacyStatus: opts.privacyStatus },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw httpError("setVideoPrivacy", res.status, body);
  }
}

/** Delete an upload (videos.delete). Needs the MANAGE scope. */
export async function deleteVideo(opts: {
  accessToken: string;
  videoId: string;
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(opts.videoId)}`;
  const res = await doFetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw httpError("deleteVideo", res.status, body);
  }
}

export async function setThumbnail(opts: {
  accessToken: string;
  videoId: string;
  imageBytes: Uint8Array;
  contentType: "image/png" | "image/jpeg";
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${THUMBNAIL_URL}?videoId=${encodeURIComponent(opts.videoId)}&uploadType=media`;
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": opts.contentType,
    },
    body: opts.imageBytes,
  });
  if (!res.ok) {
    throw httpError("thumbnail set", res.status, await res.text());
  }
}

export interface PreparedProject {
  title: string;
  description: string;
  videoPath: string;
  thumbnailPath: string | null;
  chapters: Chapter[];
}

/** Read a packaged project (`youtube/` + `output/`) into upload inputs.
 *  The upload description = chapters block + agent description, because
 *  chapter markers only activate when they lead the description. */
export async function readPreparedProject(
  projectRoot: string,
): Promise<PreparedProject> {
  const pkgPath = path.join(projectRoot, "youtube", "package.yaml");
  const videoPath = path.join(projectRoot, "output", "final-mixed.mp4");
  if (!existsSync(pkgPath)) {
    throw new YouTubeUploadError(
      "youtube/package.yaml missing — run `video youtube <project>` first",
    );
  }
  if (!existsSync(videoPath)) {
    throw new YouTubeUploadError(
      "output/final-mixed.mp4 missing — run `video make <project>` first",
    );
  }
  let pkg: { title?: unknown; description?: unknown; chapters?: unknown };
  try {
    pkg = parseYaml(await readFile(pkgPath, "utf8")) as typeof pkg;
  } catch (err) {
    throw new YouTubeUploadError(
      `youtube/package.yaml is not valid YAML: ${(err as Error).message}`,
      undefined,
      undefined,
      err,
    );
  }
  const title = pkg.title;
  const description = pkg.description;
  const chapters = pkg.chapters;
  if (typeof title !== "string" || typeof description !== "string") {
    throw new YouTubeUploadError("package.yaml has no title/description");
  }
  const chapterList = Array.isArray(chapters)
    ? (chapters as Chapter[]).filter(
        (c) =>
          c !== null &&
          typeof c === "object" &&
          typeof c.timestamp === "string" &&
          typeof c.title === "string",
      )
    : [];
  const thumbnailPath =
    ["png", "jpg"]
      .map((ext) => path.join(projectRoot, "youtube", `thumbnail.${ext}`))
      .find((p) => existsSync(p)) ?? null;
  return {
    title,
    description,
    videoPath,
    thumbnailPath,
    chapters: chapterList,
  };
}

/** Full path: package → upload → thumbnail. Throws YouTubeUploadError with
 *  actionable messages on every local failure. */
export async function uploadPreparedProject(opts: {
  creds: YouTubeCredentials;
  projectRoot: string;
  privacyStatus: PrivacyStatus;
  fetchImpl?: FetchImpl;
  retrySleeps?: number[];
}): Promise<UploadResult> {
  const prepared = await readPreparedProject(opts.projectRoot);
  const description =
    prepared.chapters.length > 0
      ? `${chaptersBlock(prepared.chapters)}\n\n${prepared.description}`
      : prepared.description;
  const videoBytes = new Uint8Array(await readFile(prepared.videoPath));
  const { videoId, watchUrl } = await uploadVideo({
    creds: opts.creds,
    videoBytes,
    title: prepared.title,
    description,
    privacyStatus: opts.privacyStatus,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.retrySleeps !== undefined
      ? { retrySleeps: opts.retrySleeps }
      : {}),
  });
  let thumbnailSet = false;
  if (prepared.thumbnailPath !== null) {
    const accessToken = await refreshAccessToken(
      opts.creds,
      opts.fetchImpl ?? fetch,
    );
    const imageBytes = new Uint8Array(await readFile(prepared.thumbnailPath));
    await setThumbnail({
      accessToken,
      videoId,
      imageBytes,
      contentType: prepared.thumbnailPath.endsWith(".jpg")
        ? "image/jpeg"
        : "image/png",
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
    thumbnailSet = true;
  }
  return { videoId, watchUrl, thumbnailSet };
}

function httpError(stage: string, status: number, body: string): Error {
  const reason = parseErrorReason(body);
  const hint =
    reason === "quotaExceeded" || reason === "uploadLimitExceeded"
      ? " — daily upload quota spent (default ~6 uploads/day); retry after the quota window resets (midnight PT)"
      : reason === "invalid_grant"
        ? " — refresh token expired/revoked; re-run `video youtube --auth`"
        : reason === "forbidden"
          ? " — the Google account has no YouTube channel, or the OAuth app is not approved for it"
          : "";
  return new YouTubeUploadError(
    `${stage} failed: ${status}${reason ? ` (${reason})` : ""}${hint}: ${body.slice(0, 200)}`,
    status,
    reason,
  );
}

function parseErrorReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[]; message?: string };
    };
    const reason = parsed.error?.errors?.[0]?.reason;
    if (typeof reason === "string") return reason;
    if (parsed.error?.message === "invalid_grant") return "invalid_grant";
    return undefined;
  } catch {
    return undefined;
  }
}
