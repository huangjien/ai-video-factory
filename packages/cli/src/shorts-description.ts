import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The description of a Shorts upload.
 *
 * The packager's `shorts-hook.txt` starts with a cover-IMAGE prompt —
 * it is written for the image model, not for the viewer. Only the part
 * after a 口播 marker is spoken copy. English packs often carry the
 * prompt alone (no spoken section at all), so the film's
 * `youtube/description.md` is the fallback. Using the raw hook file put
 * a 900-character image prompt into the public description of the
 * English Shorts (2026-11-24).
 *
 * It lives in its own module so the shorts command can use it without
 * importing the auto-producer (which imports the shorts command).
 */
export function shortsDescription(workdir: string, topic: string): string {
  const hookPath = path.join(workdir, "youtube", "shorts-hook.txt");
  let body = "";
  if (existsSync(hookPath)) {
    const text = readFileSync(hookPath, "utf8");
    const marker = text.search(/口播(文案|钩子|稿)/);
    body = (marker < 0 ? "" : text.slice(marker)).trim();
  }
  if (body === "") {
    const descPath = path.join(workdir, "youtube", "description.md");
    if (existsSync(descPath)) body = readFileSync(descPath, "utf8").trim();
  }
  return (body !== "" ? `${body}\n\n` : "") + topic;
}
