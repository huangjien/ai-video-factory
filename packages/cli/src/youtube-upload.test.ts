import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerYouTube,
  resolveYouTubeCredentials,
} from "./youtube-command.js";
import { YouTubeUploadError } from "@video/youtube";

afterEach(() => {
  delete process.env["YOUTUBE_CLIENT_SECRET_FILE"];
  delete process.env["YOUTUBE_REFRESH_TOKEN"];
  process.exitCode = 0;
});

describe("resolveYouTubeCredentials", () => {
  it("missing secret file → error with the Cloud-console steps", async () => {
    process.env["YOUTUBE_CLIENT_SECRET_FILE"] =
      "/tmp/definitely-missing-secret.json";
    await expect(resolveYouTubeCredentials()).rejects.toThrow(
      /Google Cloud project.*video youtube --auth/s,
    );
  });

  it("secret present but no refresh token → error pointing at --auth", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "yt-creds-"));
    const secret = path.join(dir, "client_secret.json");
    writeFileSync(
      secret,
      JSON.stringify({
        installed: { client_id: "a", client_secret: "b" },
      }),
    );
    process.env["YOUTUBE_CLIENT_SECRET_FILE"] = secret;
    await expect(resolveYouTubeCredentials()).rejects.toThrow(
      YouTubeUploadError,
    );
    await expect(resolveYouTubeCredentials()).rejects.toThrow(
      /YOUTUBE_REFRESH_TOKEN not set.*--auth/s,
    );
    process.env["YOUTUBE_REFRESH_TOKEN"] = "rtok";
    const creds = await resolveYouTubeCredentials();
    expect(creds).toEqual({
      clientId: "a",
      clientSecret: "b",
      refreshToken: "rtok",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("video youtube argument validation", () => {
  async function run(args: string[]): Promise<number> {
    const program = new Command();
    program.exitOverride();
    registerYouTube(program);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await program.parseAsync(["youtube", ...args], { from: "user" });
      return Number(process.exitCode ?? 0);
    } finally {
      err.mockRestore();
    }
  }

  it("no project and no --auth → exit 1 with the pointer", async () => {
    expect(await run([])).toBe(1);
  });

  it("bad --privacy value → exit 1", async () => {
    expect(await run(["proj", "--upload", "--privacy", "friends"])).toBe(1);
  });
});
