import { describe, expect, it } from "vitest";
import {
  YOUTUBE_MANAGE_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  buildAuthUrl,
  deleteVideo,
  setVideoPrivacy,
} from "./uploader.js";

/**
 * Manage scope (2026-10-24): replacing an uploaded video needs two calls
 * the upload-only token cannot make — videos.update (privacy) and
 * videos.delete. The API answers 403 for an upload-only token, so the auth
 * flow must be able to request the broader scope.
 */
describe("youtube manage scope", () => {
  it("buildAuthUrl defaults to the upload-only scope", () => {
    const url = buildAuthUrl({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:1234",
    });
    expect(url).toContain(
      `scope=${encodeURIComponent(YOUTUBE_UPLOAD_SCOPE)}`,
    );
    expect(url).not.toContain(YOUTUBE_MANAGE_SCOPE);
  });

  it("buildAuthUrl requests the manage scope when asked", () => {
    const url = buildAuthUrl({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:1234",
      scope: `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_MANAGE_SCOPE}`,
    });
    const scope = new URL(url).searchParams.get("scope") ?? "";
    expect(scope.split(" ")).toContain(YOUTUBE_MANAGE_SCOPE);
    expect(scope.split(" ")).toContain(YOUTUBE_UPLOAD_SCOPE);
  });
});

describe("setVideoPrivacy / deleteVideo", () => {
  it("setVideoPrivacy PUTs status.privacyStatus (the API verb)", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    await setVideoPrivacy({
      accessToken: "tok",
      videoId: "abc123",
      privacyStatus: "public",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("id=abc123");
    expect(calls[0]!.url).toContain("part=status");
    expect(calls[0]!.init?.method).toBe("PUT");
    expect(String(calls[0]!.init?.body)).toContain('"privacyStatus":"public"');
    expect(
      (calls[0]!.init?.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer tok");
  });

  it("setVideoPrivacy surfaces an API error with the scope hint", async () => {
    await expect(
      setVideoPrivacy({
        accessToken: "tok",
        videoId: "abc",
        privacyStatus: "public",
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              error: { errors: [{ reason: "insufficientPermissions" }] },
            }),
            { status: 403 },
          )) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/setVideoPrivacy failed: 403/);
  });

  it("deleteVideo DELETEs the video id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    await deleteVideo({
      accessToken: "tok",
      videoId: "old1",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    expect(calls[0]!.url).toContain("id=old1");
    expect(calls[0]!.init?.method).toBe("DELETE");
  });

  it("deleteVideo surfaces an API error", async () => {
    await expect(
      deleteVideo({
        accessToken: "tok",
        videoId: "old1",
        fetchImpl: (async () =>
          new Response("nope", { status: 403 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/deleteVideo failed: 403/);
  });
});
