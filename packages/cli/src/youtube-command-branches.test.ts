import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { YouTubeUploadError } from "@video/youtube";

/** The YouTube API is the boundary under test — every network call it
 *  makes is stubbed here so the CLI's own branches can be driven. */
const callYouTubeMock = vi.hoisted(() => vi.fn());
const uploadPreparedProjectMock = vi.hoisted(() => vi.fn());
const refreshAccessTokenMock = vi.hoisted(() => vi.fn());
const setVideoPrivacyMock = vi.hoisted(() => vi.fn());
const deleteVideoMock = vi.hoisted(() => vi.fn());
const buildAuthUrlMock = vi.hoisted(() => vi.fn());
const exchangeCodeForTokensMock = vi.hoisted(() => vi.fn());
const generateThumbnailImageMock = vi.hoisted(() => vi.fn());

vi.mock("@video/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@video/youtube")>();
  return {
    ...actual,
    callYouTube: callYouTubeMock,
    uploadPreparedProject: uploadPreparedProjectMock,
    refreshAccessToken: refreshAccessTokenMock,
    setVideoPrivacy: setVideoPrivacyMock,
    deleteVideo: deleteVideoMock,
    buildAuthUrl: buildAuthUrlMock,
    exchangeCodeForTokens: exchangeCodeForTokensMock,
  };
});

vi.mock("./thumbnail-command.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./thumbnail-command.js")>();
  return { ...actual, generateThumbnailImage: generateThumbnailImageMock };
});

const { registerYouTube, runYouTube, runYouTubeAuth, runYouTubeManage } =
  await import("./youtube-command.js");

const ARTICLE = `---
project: yt-branches
language: zh-CN
duration_target_sec: 20
voice: narrator-zh
image_style: editorial
---

# 视频标题

这是第一句话。这是第二句话。这是第三句话。这是第四句话。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: 标题场景
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      第一段的旁白内容。
  - id: scene_2
    duration: 10
    caption: 第二场景
    visual: 一本摊开的技术书，细金线串起光点
    narration: |
      第二段的旁白内容。
\`\`\`
`;

const PACKAGE = {
  title: "思维链有什么用？",
  description: "本视频讲解 CoT。",
  chapters: [
    { scene: 1, title: "Hook" },
    { scene: 2, title: "Problem" },
  ],
  thumbnail_prompt: "Young woman · eyes wide with surprise",
  shorts_hook: "A person leans toward camera",
};

describe("youtube command branches", () => {
  let root: string;
  let logs: string[];
  let errors: string[];
  let warnings: string[];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vf-yt-branches-"));
    logs = [];
    errors = [];
    warnings = [];
    savedEnv = {
      YOUTUBE_CLIENT_SECRET_FILE: process.env["YOUTUBE_CLIENT_SECRET_FILE"],
      YOUTUBE_REFRESH_TOKEN: process.env["YOUTUBE_REFRESH_TOKEN"],
    };
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((m?: unknown) => {
      warnings.push(String(m));
    });
    callYouTubeMock.mockResolvedValue({
      youtube: PACKAGE,
      usage: { input: 10, output: 20 },
      providerName: "glm",
      messages: [{ role: "user", content: "package me" }],
    });
    uploadPreparedProjectMock.mockResolvedValue({
      watchUrl: "https://youtu.be/abc123",
      thumbnailSet: true,
    });
    refreshAccessTokenMock.mockResolvedValue("access-token");
    generateThumbnailImageMock.mockResolvedValue(
      path.join(root, "youtube", "thumbnail.png"),
    );
  });

  afterEach(async () => {
    // resetAllMocks (not clearAllMocks): a mockRejectedValue set by one
    // test must not leak into the next one.
    vi.resetAllMocks();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  /** A project directory with an article.md — the preferred input shape. */
  async function makeProject(
    name: string,
    opts: { article?: boolean } = {},
  ): Promise<string> {
    const proj = path.join(root, "projects", name);
    await mkdir(proj, { recursive: true });
    await writeFile(
      path.join(proj, "state.yaml"),
      `status: DRAFT\ncurrent_stage: init\ncheckpoint:\n  id: ${name}-init-v1\n  status: DRAFT\nhistory_tail: []\n`,
      "utf8",
    );
    if (opts.article !== false) {
      await writeFile(path.join(proj, "article.md"), ARTICLE, "utf8");
    }
    return proj;
  }

  /** A client_secret.json plus the refresh token the uploader needs. */
  async function makeCredentials(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "vf-yt-creds-"));
    const file = path.join(dir, "client_secret.json");
    await writeFile(
      file,
      JSON.stringify({
        installed: { client_id: "cid", client_secret: "csec" },
      }),
      "utf8",
    );
    process.env["YOUTUBE_CLIENT_SECRET_FILE"] = file;
    process.env["YOUTUBE_REFRESH_TOKEN"] = "rtok";
    return file;
  }

  describe("runYouTube", () => {
    it("fails when the project cannot be resolved", async () => {
      const code = await runYouTube({ project: "ghost", cwd: root });
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/no project matching "ghost"/);
    });

    it("fails when the legacy inputs are missing", async () => {
      await makeProject("yt-legacy-missing", { article: false });
      const code = await runYouTube({
        project: "yt-legacy-missing",
        cwd: root,
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("missing input:");
    });

    it("rejects an unknown model provider", async () => {
      await makeProject("yt-bad-provider");
      await expect(
        runYouTube({
          project: "yt-bad-provider",
          cwd: root,
          model: "bogus" as "glm",
        }),
      ).rejects.toThrow(/unsupported provider/);
    });

    it("packages an article.md project", async () => {
      const proj = await makeProject("yt-article");
      const code = await runYouTube({ project: "yt-article", cwd: root });
      expect(code).toBe(0);
      expect(existsSync(path.join(proj, "youtube", "title.txt"))).toBe(true);
      expect(existsSync(path.join(proj, "youtube", "package.yaml"))).toBe(true);
      expect(existsSync(path.join(proj, "youtube", "chapters.vtt"))).toBe(true);
      expect(logs.join("\n")).toContain(
        "packaged projects/yt-article/youtube/",
      );
    });

    it("reports the agent failure", async () => {
      await makeProject("yt-agent-fail");
      callYouTubeMock.mockRejectedValue(new Error("provider is down"));
      const code = await runYouTube({ project: "yt-agent-fail", cwd: root });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("youtube agent failed");
      expect(errors.join("\n")).toContain("provider is down");
    });

    it("retries once with stricter thumbnail constraints", async () => {
      await makeProject("yt-retry");
      callYouTubeMock
        .mockRejectedValueOnce(new Error("banned tokens in thumbnail_prompt"))
        .mockResolvedValueOnce({
          youtube: PACKAGE,
          usage: { input: 1, output: 1 },
          providerName: "glm",
          messages: [{ role: "user", content: "package me" }],
        });
      const code = await runYouTube({ project: "yt-retry", cwd: root });
      expect(code).toBe(0);
      expect(callYouTubeMock).toHaveBeenCalledTimes(2);
      // The retry carries the extra negative constraint.
      const retryInput = callYouTubeMock.mock.calls[1]?.[0] as {
        hook?: string;
      };
      expect(retryInput.hook).toContain("never a poster with text");
    });

    it("fails when the retry also fails", async () => {
      await makeProject("yt-retry-fail");
      callYouTubeMock.mockRejectedValue(
        new Error("banned tokens in thumbnail_prompt"),
      );
      const code = await runYouTube({ project: "yt-retry-fail", cwd: root });
      expect(code).toBe(1);
      expect(callYouTubeMock).toHaveBeenCalledTimes(2);
    });

    it("warns when the chapter scene positions are not ascending", async () => {
      await makeProject("yt-desc");
      callYouTubeMock.mockResolvedValue({
        youtube: {
          ...PACKAGE,
          chapters: [
            { scene: 2, title: "Later" },
            { scene: 1, title: "Earlier" },
          ],
        },
        usage: { input: 1, output: 1 },
        providerName: "glm",
        messages: [{ role: "user", content: "x" }],
      });
      const code = await runYouTube({ project: "yt-desc", cwd: root });
      expect(code).toBe(0);
      expect(warnings.join("\n")).toContain("not ascending");
    });
  });

  describe("runYouTube — upload", () => {
    it("fails when the OAuth credentials are missing", async () => {
      await makeProject("yt-nocreds");
      process.env["YOUTUBE_CLIENT_SECRET_FILE"] =
        "/tmp/definitely-missing-secret.json";
      delete process.env["YOUTUBE_REFRESH_TOKEN"];
      const code = await runYouTube({
        project: "yt-nocreds",
        cwd: root,
        upload: true,
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("client secret not found");
    });

    it("uses the thumbnail that is already on disk", async () => {
      const proj = await makeProject("yt-thumb-on-disk");
      await makeCredentials();
      await mkdir(path.join(proj, "youtube"), { recursive: true });
      await writeFile(path.join(proj, "youtube", "thumbnail.png"), "x");
      const code = await runYouTube({
        project: "yt-thumb-on-disk",
        cwd: root,
        upload: true,
      });
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("thumbnail: using");
      expect(generateThumbnailImageMock).not.toHaveBeenCalled();
    });

    it("generates a missing thumbnail and uploads the video", async () => {
      await makeProject("yt-upload");
      await makeCredentials();
      const code = await runYouTube({
        project: "yt-upload",
        cwd: root,
        upload: true,
      });
      expect(code).toBe(0);
      expect(generateThumbnailImageMock).toHaveBeenCalledTimes(1);
      expect(logs.join("\n")).toContain("uploading final-mixed.mp4 (private)");
      expect(logs.join("\n")).toContain("uploaded https://youtu.be/abc123");
    });

    it("uploads without a thumbnail when the generation fails", async () => {
      await makeProject("yt-thumb-fail");
      await makeCredentials();
      generateThumbnailImageMock.mockResolvedValue(null);
      const code = await runYouTube({
        project: "yt-thumb-fail",
        cwd: root,
        upload: true,
      });
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("thumbnail generation failed");
    });

    it("reports an upload failure and keeps the package on disk", async () => {
      const proj = await makeProject("yt-upload-fail");
      await makeCredentials();
      uploadPreparedProjectMock.mockRejectedValue(
        new YouTubeUploadError("quota exceeded"),
      );
      const code = await runYouTube({
        project: "yt-upload-fail",
        cwd: root,
        upload: true,
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("upload failed: quota exceeded");
      expect(existsSync(path.join(proj, "youtube", "title.txt"))).toBe(true);
    });

    it("skips the thumbnail when --no-thumbnail is passed", async () => {
      await makeProject("yt-nothumb");
      await makeCredentials();
      const code = await runYouTube({
        project: "yt-nothumb",
        cwd: root,
        upload: true,
        noThumbnail: true,
      });
      expect(code).toBe(0);
      expect(generateThumbnailImageMock).not.toHaveBeenCalled();
    });
  });

  describe("runYouTubeAuth", () => {
    it("prints the setup steps when the client secret is missing", async () => {
      const code = await runYouTubeAuth("/tmp/definitely-missing-secret.json");
      expect(code).toBe(1);
      const out = errors.join("\n");
      expect(out).toContain("client secret not found");
      expect(out).toContain("OAuth consent screen");
    });

    it("walks the consent flow and prints the env lines to store", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "vf-yt-auth-"));
      const secret = path.join(dir, "client_secret.json");
      await writeFile(
        secret,
        JSON.stringify({
          installed: { client_id: "cid", client_secret: "csec" },
        }),
        "utf8",
      );
      exchangeCodeForTokensMock.mockResolvedValue({
        refreshToken: "new-refresh-token",
        accessToken: "new-access-token",
      });
      // The auth URL carries the loopback redirect the CLI listens on.
      buildAuthUrlMock.mockImplementation((opts: { redirectUri: string }) => {
        return `${opts.redirectUri}/authorize?client_id=cid`;
      });
      const run = runYouTubeAuth(secret);
      // The CLI prints the URL it wants the browser to open — the test
      // plays the browser and hits the loopback callback with a code.
      await vi.waitFor(() => {
        expect(logs.join("\n")).toContain("visit:");
      });
      const url = logs.join("\n").match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      expect(url).toBeTruthy();
      const res = await fetch(`${url}/authorize?code=auth-code`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Authorized");
      expect(await run).toBe(0);
      const out = logs.join("\n");
      expect(out).toContain("YouTube OAuth authorized");
      expect(out).toContain("YOUTUBE_REFRESH_TOKEN=new-refresh-token");
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    });
  });

  describe("runYouTubeManage", () => {
    it("does nothing without --set-privacy or --delete", async () => {
      const code = await runYouTubeManage({ videoId: "abc" });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("nothing to do");
    });

    it("rejects an unknown privacy status", async () => {
      const code = await runYouTubeManage({
        videoId: "abc",
        setPrivacy: "friends",
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "--set-privacy must be private|unlisted|public",
      );
    });

    it("reports a credentials failure", async () => {
      process.env["YOUTUBE_CLIENT_SECRET_FILE"] =
        "/tmp/definitely-missing-secret.json";
      delete process.env["YOUTUBE_REFRESH_TOKEN"];
      const code = await runYouTubeManage({
        videoId: "abc",
        setPrivacy: "private",
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("client secret not found");
    });

    it("reports a token refresh failure with the scope hint", async () => {
      await makeCredentials();
      refreshAccessTokenMock.mockRejectedValue(new Error("invalid_grant"));
      const code = await runYouTubeManage({
        videoId: "abc",
        setPrivacy: "private",
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("token refresh failed");
      expect(errors.join("\n")).toContain("--auth --scope manage");
    });

    it("sets the privacy and deletes the video", async () => {
      await makeCredentials();
      const code = await runYouTubeManage({
        videoId: "abc",
        setPrivacy: "public",
        delete: true,
      });
      expect(code).toBe(0);
      expect(setVideoPrivacyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "access-token",
          videoId: "abc",
          privacyStatus: "public",
        }),
      );
      expect(deleteVideoMock).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: "abc" }),
      );
      expect(logs.join("\n")).toContain("abc → public");
      expect(logs.join("\n")).toContain("deleted abc");
    });

    it("reports a manage failure with the scope hint", async () => {
      await makeCredentials();
      setVideoPrivacyMock.mockRejectedValue(
        new Error("insufficient authentication scopes"),
      );
      const code = await runYouTubeManage({
        videoId: "abc",
        setPrivacy: "private",
      });
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("insufficient authentication scopes");
      expect(errors.join("\n")).toContain("upload-only OAuth token");
    });
  });

  describe("registerYouTube", () => {
    it("registers the youtube command with its flags", () => {
      const program = new Command();
      registerYouTube(program);
      const cmd = program.commands.find((c) => c.name() === "youtube");
      expect(cmd).toBeDefined();
      const longs = (cmd?.options ?? []).map((o) => o.long);
      expect(longs).toContain("--upload");
      expect(longs).toContain("--auth");
      expect(longs).toContain("--set-privacy");
      expect(longs).toContain("--delete");
      expect(longs).toContain("--scope");
    });

    it("requires a project when no auth or video id is given", async () => {
      const program = new Command();
      registerYouTube(program);
      await program.parseAsync(["youtube"], { from: "user" });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      expect(errors.join("\n")).toContain("project required");
    });

    it("rejects an invalid --privacy value", async () => {
      const program = new Command();
      registerYouTube(program);
      await program.parseAsync(["youtube", "proj", "--privacy", "friends"], {
        from: "user",
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      expect(errors.join("\n")).toContain("--privacy must be");
    });

    it("routes --video-id to the manage flow", async () => {
      await makeCredentials();
      const program = new Command();
      registerYouTube(program);
      await program.parseAsync(
        ["youtube", "--video-id", "abc", "--set-privacy", "private"],
        { from: "user" },
      );
      expect(process.exitCode, errors.join("|")).toBe(0);
      process.exitCode = undefined;
      expect(setVideoPrivacyMock).toHaveBeenCalled();
    });

    it("routes --auth to the consent flow", async () => {
      const program = new Command();
      registerYouTube(program);
      await program.parseAsync(
        ["youtube", "--auth", "--client-secret", "/tmp/missing-secret.json"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      expect(errors.join("\n")).toContain("client secret not found");
    });
  });
});
