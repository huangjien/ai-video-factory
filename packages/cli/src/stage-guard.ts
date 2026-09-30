import {
  loadCheckpoint,
  readProjectState,
  V01_STAGES,
} from "@vf/workflow";

/** Human-approval guard for the content-generating verbs (doc §58: agents
 * draft, humans decide). A generator refuses to run when doing so would
 * overwrite human-approved work:
 *   - the project reached FINAL_APPROVED (terminal — shipped), or
 *   - the stage carries an `approved` checkpoint (e.g. `vf approve storyboard`).
 * `--force` is the explicit bypass; the caller decides whether to offer it. */
export async function assertStageWritable(
  projectRoot: string,
  stage: string,
  force: boolean,
): Promise<boolean> {
  if (force) return true;
  const state = await readProjectState(projectRoot);
  if (state?.status === "FINAL_APPROVED") {
    console.error(
      `✗ project is FINAL_APPROVED — regenerating ${stage} would overwrite shipped work. Run \`vf reset --force\` first, or pass --force to override`,
    );
    return false;
  }
  if ((V01_STAGES as readonly string[]).includes(stage)) {
    const cp = await loadCheckpoint(
      projectRoot,
      stage as (typeof V01_STAGES)[number],
    );
    if (cp?.status === "approved") {
      console.error(
        `✗ ${stage} is human-approved — regenerating would overwrite it. Edit and re-approve, or pass --force to override`,
      );
      return false;
    }
  }
  return true;
}
