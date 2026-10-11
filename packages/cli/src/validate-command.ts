import { readFile } from "node:fs/promises";
import path from "node:path";
import { probeAudioDuration } from "@video/media";
import { formatErrors, parseYaml, validateProject } from "@video/vdsl";
import { REGISTRY, THEME_NAMES } from "@video/video-components";
import { MARK_OK, brandBannerLine, channelHeader } from "./ui.js";

/** Best-effort unknown-theme warning. Runs ONLY after validate passes —
 *  validation failures should not be hidden behind a theme hint. */
function warnUnknownTheme(text: string): void {
  // @video/vdsl's parseYaml returns { ok, doc, data | errors }; we only
  // read when parsing succeeded.
  const parsed = parseYaml(text);
  if (!parsed.ok) return; // validate already surfaced parse errors; bail.
  const themeName = (parsed.data as { style?: { theme?: unknown } } | null)
    ?.style?.theme;
  if (typeof themeName !== "string" || themeName === "") return;
  if (THEME_NAMES.includes(themeName)) return;
  // Surface to stderr so the hint shows up in pipelines that filter
  // stdout (validate is structured-data friendly via its exit code).
  console.error(
    `  hint: style.theme "${themeName}" is not a known theme — the renderer will fall back to paper-light.`,
  );
  console.error(
    `        known themes: ${THEME_NAMES.join(", ")}. Run \`video theme\` for the palette index.`,
  );
}

export async function runValidate(
  filePath: string,
  root?: string,
): Promise<number> {
  const abs = path.resolve(filePath);
  const text = await readFile(abs, "utf8");
  const projectRoot = path.resolve(root ?? path.dirname(path.dirname(abs)));
  const result = await validateProject(text, path.basename(abs), {
    projectRoot,
    registry: REGISTRY,
    probeAudio: probeAudioDuration,
  });
  if (result.ok) {
    console.log(brandBannerLine());
    console.log(channelHeader(path.basename(abs), "valid"));
    console.log("");
    console.log(`  ${MARK_OK} valid: ${abs}`);
    warnUnknownTheme(text);
    return 0;
  }
  console.error(formatErrors(result.errors));
  return 1;
}
