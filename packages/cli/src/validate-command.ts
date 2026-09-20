import { readFile } from "node:fs/promises";
import path from "node:path";
import { probeAudioDuration } from "@vf/media";
import { formatErrors, validateProject } from "@vf/vdsl";
import { REGISTRY } from "@vf/video-components";

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
    console.log(`✓ valid: ${abs}`);
    return 0;
  }
  console.error(formatErrors(result.errors));
  return 1;
}
