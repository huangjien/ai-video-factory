import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  YouTubeUploadError,
  chaptersBlock,
  parseClientSecret,
  readPreparedProject,
  refreshAccessToken,
  setThumbnail,
  uploadPreparedProject,
  uploadVideo,
  type FetchImpl,
} from "./uploader.js";

const CREDS = {
  clientId: "cid.apps.googleusercontent.com",
  clientSecret: "csec",
  refreshToken: "rtok",
};

/** Sequence-backed fetch mock: each call pops the next handler. Requests
 *  are cloned so bodies stay readable in assertions afterwards. */
function fetchScript(
  handlers: ((req: Request) => Response | Promise<Response>)[],
): { fetch: FetchImpl; calls: Request[] } {
  const calls: Request[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input as URL, init);
    calls.push(req.clone());
    const handler = handlers.shift();
    if (!handler) throw new Error("unexpected extra fetch call");
    return handler(req);
  }) as FetchImpl;
  return { fetch, calls };
}

const json = (
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("parseClientSecret", () => {
  it("reads the installed (Desktop app) shape", () => {
    const { clientId, clientSecret } = parseClientSecret(
      JSON.stringify({
        installed: { client_id: "a", client_secret: "b", foo: 1 },
      }),
    );
    expect(clientId).toBe("a");
    expect(clientSecret).toBe("b");
  });

  it("reads the web shape as a fallback", () => {
    const { clientId } = parseClientSecret(
      JSON.stringify({ web: { client_id: "w", client_secret: "s" } }),
    );
    expect(clientId).toBe("w");
  });

  it("rejects JSON without client credentials", () => {
    expect(() => parseClientSecret('{"nope":1}')).toThrow(/Desktop app/);
    expect(() => parseClientSecret("not json")).toThrow(YouTubeUploadError);
  });
});

describe("chaptersBlock", () => {
  it("formats MM:SS title lines", () => {
    expect(
      chaptersBlock([
        { scene: 1, timestamp: "00:00", title: "开场" },
        { scene: 4, timestamp: "01:23", title: "Part 2" },
      ]),
    ).toBe("00:00 开场\n01:23 Part 2");
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant and returns the access token", async () => {
    const { fetch, calls } = fetchScript([
      () => json(200, { access_token: "at1", expires_in: 3600 }),
    ]);
    const token = await refreshAccessToken(CREDS, fetch);
    expect(token).toBe("at1");
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(await calls[0]?.text()).toContain("grant_type=refresh_token");
  });

  it("surfaces invalid_grant with the re-auth hint", async () => {
    const { fetch } = fetchScript([
      () =>
        json(400, {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
    ]);
    await expect(refreshAccessToken(CREDS, fetch)).rejects.toThrow(
      /invalid_grant/,
    );
  });
});

describe("uploadVideo", () => {
  const videoBytes = new Uint8Array([1, 2, 3, 4]);

  it("opens a resumable session, PUTs the bytes, returns the id", async () => {
    const { fetch, calls } = fetchScript([
      () => json(200, { access_token: "at1" }),
      () => json(200, {}, { location: "https://upload/session/1" }),
      () => json(200, { id: "vid123" }),
    ]);
    const result = await uploadVideo({
      creds: CREDS,
      videoBytes,
      title: "鸿门宴",
      description: "desc",
      privacyStatus: "private",
      fetchImpl: fetch,
      retrySleeps: [1],
    });
    expect(result.videoId).toBe("vid123");
    expect(result.watchUrl).toBe("https://youtu.be/vid123");
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1]?.url).toContain("uploadType=resumable");
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer at1");
    const initText = await calls[1]?.text();
    const initBody = JSON.parse(initText ?? "{}") as {
      snippet: { title: string };
      status: { privacyStatus: string };
    };
    expect(initBody.snippet.title).toBe("鸿门宴");
    expect(initBody.status.privacyStatus).toBe("private");
    expect(calls[2]?.url).toBe("https://upload/session/1");
    expect(calls[2]?.method).toBe("PUT");
  });

  it("does NOT retry a 403 quota error and names the quota window", async () => {
    let inits = 0;
    const { fetch } = fetchScript([
      () => json(200, { access_token: "at1" }),
      () => {
        inits += 1;
        return json(403, {
          error: {
            errors: [{ reason: "quotaExceeded" }],
            message: "quota",
          },
        });
      },
    ]);
    await expect(
      uploadVideo({
        creds: CREDS,
        videoBytes,
        title: "t",
        description: "d",
        privacyStatus: "private",
        fetchImpl: fetch,
        retrySleeps: [1, 1],
      }),
    ).rejects.toThrow(/quotaExceeded.*quota window/s);
    expect(inits).toBe(1);
  });

  it("retries a 5xx on the session init once, then succeeds", async () => {
    const { fetch } = fetchScript([
      () => json(200, { access_token: "at1" }),
      () => new Response("boom", { status: 502 }),
      () => json(200, {}, { location: "https://upload/session/2" }),
      () => json(200, { id: "vidRetry" }),
    ]);
    const result = await uploadVideo({
      creds: CREDS,
      videoBytes,
      title: "t",
      description: "d",
      privacyStatus: "unlisted",
      fetchImpl: fetch,
      retrySleeps: [1],
    });
    expect(result.videoId).toBe("vidRetry");
  });
});

describe("setThumbnail", () => {
  it("posts image bytes with the right content type", async () => {
    const { fetch, calls } = fetchScript([() => json(200, {})]);
    await setThumbnail({
      accessToken: "at1",
      videoId: "vid123",
      imageBytes: new Uint8Array([9, 9]),
      contentType: "image/png",
      fetchImpl: fetch,
    });
    expect(calls[0]?.url).toContain("thumbnails/set");
    expect(calls[0]?.url).toContain("videoId=vid123");
    expect(calls[0]?.headers.get("content-type")).toBe("image/png");
  });
});

describe("readPreparedProject / uploadPreparedProject", () => {
  let dir: string;
  it("packages a prepared project and uploads with chapters leading the description", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "yt-upload-"));
    mkdirSync(path.join(dir, "youtube"));
    mkdirSync(path.join(dir, "output"));
    writeFileSync(
      path.join(dir, "youtube", "package.yaml"),
      [
        "title: 测试标题",
        'description: "正文说明 #tag"',
        "chapters:",
        "  - scene: 1",
        "    timestamp: '00:00'",
        "    title: 开场",
        "  - scene: 3",
        "    timestamp: '00:42'",
        "    title: 第二幕",
        "thumbnail_prompt: n/a",
        "shorts_hook: n/a",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(dir, "output", "final-mixed.mp4"), "mp4bytes");
    writeFileSync(path.join(dir, "youtube", "thumbnail.png"), "png");

    const { fetch, calls } = fetchScript([
      () => json(200, { access_token: "at1" }),
      () => json(200, {}, { location: "https://upload/session/x" }),
      () => json(200, { id: "vidE2E" }),
      () => json(200, { access_token: "at2" }),
      () => json(200, {}),
    ]);
    const result = await uploadPreparedProject({
      creds: CREDS,
      projectRoot: dir,
      privacyStatus: "public",
      fetchImpl: fetch,
      retrySleeps: [1],
    });
    expect(result.videoId).toBe("vidE2E");
    expect(result.thumbnailSet).toBe(true);
    // The snippet sent at session init leads with the chapters block.
    const initText = await calls[1]?.text();
    expect(initText).toBeDefined();
    const initBody = JSON.parse(initText ?? "{}") as {
      snippet: { description: string };
    };
    expect(initBody.snippet.description).toBe(
      "00:00 开场\n00:42 第二幕\n\n正文说明 #tag",
    );
  });

  it("missing package and missing video get actionable pointers", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "yt-empty-"));
    await expect(readPreparedProject(empty)).rejects.toThrow(
      /video youtube <project>/,
    );
    mkdirSync(path.join(empty, "youtube"));
    writeFileSync(
      path.join(empty, "youtube", "package.yaml"),
      "title: t\ndescription: d\n",
    );
    await expect(readPreparedProject(empty)).rejects.toThrow(
      /video make <project>/,
    );
    rmSync(empty, { recursive: true, force: true });
  });

  it("no thumbnail → thumbnailSet false, upload still succeeds", async () => {
    const bare = mkdtempSync(path.join(tmpdir(), "yt-bare-"));
    mkdirSync(path.join(bare, "youtube"));
    mkdirSync(path.join(bare, "output"));
    writeFileSync(
      path.join(bare, "youtube", "package.yaml"),
      "title: t\ndescription: d\n",
    );
    writeFileSync(path.join(bare, "output", "final-mixed.mp4"), "x");
    const { fetch } = fetchScript([
      () => json(200, { access_token: "at1" }),
      () => json(200, {}, { location: "https://s/1" }),
      () => json(200, { id: "vidNoThumb" }),
    ]);
    const result = await uploadPreparedProject({
      creds: CREDS,
      projectRoot: bare,
      privacyStatus: "private",
      fetchImpl: fetch,
      retrySleeps: [1],
    });
    expect(result.thumbnailSet).toBe(false);
    rmSync(bare, { recursive: true, force: true });
  });

  it("cleans the e2e temp dir", () => {
    rmSync(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
