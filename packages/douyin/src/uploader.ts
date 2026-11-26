import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { DouyinPackage, DouyinPublishResult } from "./schemas.js";

/**
 * The official Douyin publishing API (抖音开放平台 → 内容发布).
 *
 * The flow is three calls, exactly like YouTube's resumable upload but
 * simpler:
 *
 *   1. `video/create`  → a video_id and a one-time upload_url
 *   2. POST the file to that upload_url
 *   3. `video/upload`  → commit; the post is created and gets an item_id
 *
 * WHAT THE USER MUST PROVIDE (nothing else works without it):
 *   - an app on 开放平台 with the 内容发布 capability APPROVED
 *   - that app's `client_key` / `client_secret` in
 *     `~/.config/secrets/douyin-client-secret.json`
 *   - an `access_token` in `~/.config/secrets/ai.env` as
 *     `DOUYIN_ACCESS_TOKEN` (obtained by exchanging an authorization code)
 *
 * The endpoint paths and the request bodies below are isolated in ONE
 * place so they can be checked against the current documentation in a
 * minute — the platform moves, and an API that 400s with a clear body is
 * a five-minute fix, not a rewrite.
 */

export const DOUYIN_API_BASE = "https://open.douyin.com";
export const DOUYIN_TOKEN_PATH = "/oauth/access_token/";
export const DOUYIN_VIDEO_CREATE_PATH = "/video/create/";
export const DOUYIN_VIDEO_UPLOAD_PATH = "/video/upload/";

export class DouyinUploadError extends Error {
  constructor(
    message: string,
    readonly apiCode?: string | undefined,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DouyinUploadError";
  }
}

/** The app's credentials, as the developer console shows them. */
export interface DouyinClientSecret {
  client_key: string;
  client_secret: string;
}

export async function readClientSecret(
  path: string,
): Promise<DouyinClientSecret> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<DouyinClientSecret>;
  if (
    typeof parsed.client_key !== "string" ||
    typeof parsed.client_secret !== "string"
  ) {
    throw new DouyinUploadError(
      `${path} must contain client_key and client_secret`,
    );
  }
  return {
    client_key: parsed.client_key,
    client_secret: parsed.client_secret,
  };
}

/** Exchange an authorization code for an access token. */
export async function exchangeCodeForToken(opts: {
  clientKey: string;
  clientSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; openId?: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_key: opts.clientKey,
    client_secret: opts.clientSecret,
    code: opts.code,
    grant_type: "authorization_code",
  });
  const res = await fetchImpl(`${DOUYIN_API_BASE}${DOUYIN_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { access_token?: string; open_id?: string };
    error_code?: number;
    description?: string;
    message?: string;
  };
  const token = json.data?.access_token;
  if (!res.ok || token === undefined) {
    throw new DouyinUploadError(
      `token exchange failed: ${json.description ?? json.message ?? res.status}`,
      json.error_code !== undefined ? String(json.error_code) : undefined,
    );
  }
  return {
    accessToken: token,
    ...(json.data?.open_id !== undefined ? { openId: json.data.open_id } : {}),
  };
}

/** The API's error shape, as far as we can tell. */
interface ApiError {
  error_code?: number;
  description?: string;
  message?: string;
  log_id?: string;
}

/** Pull the post id out of a response that may nest it several ways. */
function pickItemId(json: unknown): string | undefined {
  const root = json as {
    data?: {
      item_id?: string;
      video_id?: string;
      video?: { video_id?: string; item_id?: string };
      aweme_id?: string;
    };
    aweme_id?: string;
    item_id?: string;
  };
  return (
    root?.data?.item_id ??
    root?.data?.video?.item_id ??
    root?.data?.aweme_id ??
    root?.aweme_id ??
    root?.item_id
  );
}

function pickVideoId(json: unknown): string | undefined {
  const root = json as {
    data?: { video_id?: string; video?: { video_id?: string } };
    video_id?: string;
  };
  return root?.data?.video?.video_id ?? root?.data?.video_id ?? root?.video_id;
}

function pickUploadUrl(json: unknown): string | undefined {
  const root = json as {
    data?: { video?: { upload_url?: string }; upload_url?: string };
    upload_url?: string;
  };
  return (
    root?.data?.video?.upload_url ?? root?.data?.upload_url ?? root?.upload_url
  );
}

export interface UploadDouyinOptions {
  /** The vertical video (1080×1920). */
  videoPath: string;
  /** The cover image, when one exists. */
  coverPath?: string | undefined;
  pkg: DouyinPackage;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Publish to Douyin.
 *
 * Throws `DouyinUploadError` with the API's own message — a Douyin
 * rejection is usually a policy or capability problem the human has to
 * read, not a bug to retry.
 */
export async function uploadDouyin(
  opts: UploadDouyinOptions,
): Promise<DouyinPublishResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { pkg } = opts;

  // 1. create — the API reserves the video and hands back an upload URL.
  const createBody = new URLSearchParams({
    title: pkg.title,
    text: pkg.description,
    ...(pkg.topics.length > 0 ? { topics: pkg.topics.join(",") } : {}),
  });
  const createRes = await fetchImpl(
    `${DOUYIN_API_BASE}${DOUYIN_VIDEO_CREATE_PATH}?access_token=${encodeURIComponent(opts.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createBody.toString(),
    },
  );
  const createJson = (await createRes.json().catch(() => ({}))) as ApiError & {
    data?: unknown;
  };
  const uploadUrl = pickUploadUrl(createJson);
  const videoId = pickVideoId(createJson);
  if (!createRes.ok || uploadUrl === undefined) {
    const err = createJson as ApiError;
    throw new DouyinUploadError(
      `video/create failed: ${err.description ?? err.message ?? createRes.status}`,
      err.error_code !== undefined ? String(err.error_code) : undefined,
    );
  }

  // 2. upload — the file goes to the one-time URL the create call returned.
  const bytes = await readFile(opts.videoPath);
  const form = new FormData();
  form.append(
    "data",
    new Blob([bytes], { type: "video/mp4" }),
    basename(opts.videoPath),
  );
  if (opts.coverPath !== undefined && existsSync(opts.coverPath)) {
    const cover = await readFile(opts.coverPath);
    form.append(
      "cover",
      new Blob([cover], { type: "image/jpeg" }),
      basename(opts.coverPath),
    );
  }
  const upRes = await fetchImpl(uploadUrl, { method: "POST", body: form });
  if (!upRes.ok) {
    const text = await upRes.text().catch(() => "");
    throw new DouyinUploadError(
      `file upload failed: ${text.slice(0, 200) || upRes.status}`,
    );
  }

  // 3. commit — the post exists only after this call.
  const commitBody = new URLSearchParams({
    ...(videoId !== undefined ? { video_id: videoId } : {}),
    title: pkg.title,
    text: pkg.description,
    ...(pkg.topics.length > 0 ? { topics: pkg.topics.join(",") } : {}),
  });
  const commitRes = await fetchImpl(
    `${DOUYIN_API_BASE}${DOUYIN_VIDEO_UPLOAD_PATH}?access_token=${encodeURIComponent(opts.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: commitBody.toString(),
    },
  );
  const commitJson = (await commitRes.json().catch(() => ({}))) as ApiError & {
    data?: unknown;
  };
  const itemId = pickItemId(commitJson);
  if (!commitRes.ok || itemId === undefined) {
    const err = commitJson as ApiError;
    throw new DouyinUploadError(
      `video/upload failed: ${err.description ?? err.message ?? commitRes.status}`,
      err.error_code !== undefined ? String(err.error_code) : undefined,
    );
  }

  return {
    item_id: itemId,
    ...(videoId !== undefined ? { video_id: videoId } : {}),
  };
}
