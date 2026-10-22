#!/usr/bin/env node
/**
 * Studio-equivalent edit on an already-uploaded YouTube video.
 *
 * 1. Reads YOUTUBE_CLIENT_SECRET_FILE + YOUTUBE_REFRESH_TOKEN
 * 2. Refreshes the access token
 * 3. Reads description, title, thumbnail from the project's `youtube/` dir
 * 4. PUTs a videos.update with title, description, tags, categoryId
 * 5. POSTs the custom thumbnail to /upload/youtube/v3/thumbnails/set
 * 6. Prints the before/after state
 *
 * Usage: node scripts/studio-edit.mjs <project> <youtubeVideoId>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";

const [projectArg, videoId] = process.argv.slice(2);
if (!projectArg || !videoId) {
  console.error("usage: studio-edit.mjs <project> <youtubeVideoId>");
  process.exit(2);
}

const projectRoot = resolve("projects", projectArg);
const ytDir = resolve(projectRoot, "youtube");

const title = readFileSync(resolve(ytDir, "title.txt"), "utf8").trim();
const description = readFileSync(resolve(ytDir, "description.md"), "utf8").trim();
const thumbPath = resolve(ytDir, "thumbnail.jpg");
const chaptersPath = resolve(ytDir, "chapters.vtt");

// Tags are part of the description footer "#AIAgents #ReliableAI" — extract
// them as separate tags[] the YouTube API understands.
const tagMatches = [...description.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(
  (m) => m[1],
);
const tags = [...new Set(tagMatches)];

const clientSecret = JSON.parse(
  readFileSync(process.env.YOUTUBE_CLIENT_SECRET_FILE, "utf8"),
);
const web = clientSecret.web ?? clientSecret.installed;
const clientId = web.client_id;
const clientSecretValue = web.client_secret;
const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

async function fetchAccessToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecretValue,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function youtubeFetch(path, init, accessToken) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  return res;
}

async function getVideoMeta(accessToken) {
  const res = await youtubeFetch(
    `/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`,
    { method: "GET" },
    accessToken,
  );
  if (!res.ok) throw new Error(`getVideo failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.items?.[0] ?? null;
}

async function updateVideo(accessToken, snippet) {
  const res = await youtubeFetch(
    `/videos?part=snippet`,
    {
      method: "PUT",
      body: JSON.stringify({ id: videoId, snippet }),
    },
    accessToken,
  );
  if (!res.ok) {
    throw new Error(`videos.update failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function setThumbnail(accessToken, filePath) {
  // /upload/youtube/v3/thumbnails/set expects a multipart POST with
  // videoId in the URL and the file under a specific field name.
  const url = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`;
  const buf = readFileSync(filePath);
  const blob = new Blob([buf], { type: "image/jpeg" });
  const form = new FormData();
  form.append("image", blob, basename(filePath));
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`thumbnails.set failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

(async () => {
  const accessToken = await fetchAccessToken();
  const onlyThumb = process.argv.includes("--thumbnail-only");

  if (!onlyThumb) {
    const before = await getVideoMeta(accessToken);
    if (before === null) {
      throw new Error(`video not found: ${videoId}`);
    }
    const beforeTitle = before.snippet.title;
    const beforeDesc = before.snippet.description;
    console.log(`BEFORE title: ${beforeTitle.slice(0, 80)}…`);
    console.log(`BEFORE description (${beforeDesc.length} chars)`);
    console.log(`BEFORE tags: ${(before.snippet.tags ?? []).join(", ")}`);

    const newSnippet = {
      title,
      description,
      categoryId: before.snippet.categoryId ?? "22",
      tags,
    };
    const updated = await updateVideo(accessToken, newSnippet);
    console.log(
      `UPDATED title: ${updated.snippet.title.slice(0, 80)}…`,
    );
    console.log(`UPDATED description (${updated.snippet.description.length} chars)`);
    console.log(`UPDATED tags: ${updated.snippet.tags?.join(", ") ?? ""}`);
  } else {
    console.log("Skipping metadata update (--thumbnail-only)");
  }

  console.log(`UPLOADING thumbnail ${basename(thumbPath)}…`);
  const thumb = await setThumbnail(accessToken, thumbPath);
  console.log(`THUMBNAIL item: ${JSON.stringify(thumb)}`);

  console.log(`DONE — https://youtu.be/${videoId}`);
})().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
