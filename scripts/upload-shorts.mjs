// Uploads the two Shorts cuts to YouTube as PRIVATE.
//
// Sources (no hardcoded strings — the earlier version pinned article 1's
// topic into every upload, which put the wrong title on article 2's zh
// Shorts, 2026-11-24):
//   title  → <workdir>/youtube/title.txt
//   desc   → the spoken-script section of <workdir>/youtube/shorts-hook.txt
//             when the packager wrote one, else <workdir>/youtube/description.md
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveYouTubeCredentials } from "/Users/huangjien/workspace/ai-video-factory/packages/cli/dist/youtube-command.js";
import { uploadVideo } from "/Users/huangjien/workspace/ai-video-factory/packages/youtube/dist/uploader.js";

const repo = "/Users/huangjien/workspace/ai-video-factory";
const slug = process.argv[2];
if (!slug) {
  console.error("usage: node upload-shorts.mjs <project-slug>");
  process.exit(1);
}

const jobs = [
  { lang: "zh", root: path.join(repo, "projects", slug) },
  { lang: "en", root: path.join(repo, "projects", slug, "l10n", "en-US") },
];

/** The spoken script, if the packager wrote one. The hook file starts with
 *  a cover-image prompt; the spoken part follows a marker line. */
function spokenHook(file) {
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8");
  const marker = text.search(/口播(文案|钩子|稿)/);
  if (marker < 0) return "";
  return text.slice(marker).trim();
}

const creds = await resolveYouTubeCredentials();

for (const job of jobs) {
  const shortsPath = path.join(job.root, "vertical", "youtube", "shorts.mp4");
  if (!existsSync(shortsPath)) {
    console.error(`! ${job.lang}: missing ${shortsPath}`);
    continue;
  }
  const titleFile = path.join(job.root, "youtube", "title.txt");
  const topic = existsSync(titleFile)
    ? readFileSync(titleFile, "utf8").trim()
    : "Shorts";
  const hook = spokenHook(path.join(job.root, "youtube", "shorts-hook.txt"));
  const descriptionFile = path.join(job.root, "youtube", "description.md");
  const body =
    hook !== ""
      ? hook
      : existsSync(descriptionFile)
        ? readFileSync(descriptionFile, "utf8").trim()
        : topic;
  const title = `${topic} #Shorts`.slice(0, 100);
  const videoBytes = new Uint8Array(readFileSync(shortsPath));
  try {
    const { videoId } = await uploadVideo({
      creds,
      videoBytes,
      title,
      description: `${body}\n\n${topic}`,
      privacyStatus: "private",
    });
    console.log(`✓ ${job.lang} shorts uploaded: https://youtu.be/${videoId}`);
    console.log(`   title: ${title}`);
  } catch (err) {
    console.error(`! ${job.lang} shorts upload failed: ${err.message}`);
  }
}
