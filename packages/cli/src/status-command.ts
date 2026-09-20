import { existsSync } from "node:fs";
import path from "node:path";
import { loadCheckpoint, readProjectState, V01_STAGES } from "@vf/workflow";

const MARK: Record<string, string> = {
  approved: "✓",
  rejected: "✗",
  invalidated: "✗",
  in_progress: "●",
};

export async function runStatus(cwd?: string): Promise<number> {
  const root = path.resolve(cwd ?? ".");
  if (!existsSync(path.join(root, "state.yaml"))) {
    console.error(`no video-agent project here: ${root}`);
    return 1;
  }
  const state = await readProjectState(root);
  if (!state) return 1;
  console.log("AI Video Factory");
  console.log(`Project: ${path.basename(root)}`);
  console.log("");
  for (const stage of V01_STAGES) {
    const cp = await loadCheckpoint(root, stage);
    let mark = "○";
    if (cp) {
      const key = cp.status === "approved" || cp.status === "rejected" || cp.status === "invalidated" ? cp.status : "in_progress";
      mark = MARK[key] ?? "○";
    }
    const isCurrent = state.current_stage === stage;
    const prefix = isCurrent ? "●" : " ";
    console.log(`${prefix} ${mark} ${stage}`);
  }
  console.log("");
  console.log(`Current checkpoint: ${state.checkpoint.id}`);
  console.log(`Status: ${state.status}`);
  return 0;
}
