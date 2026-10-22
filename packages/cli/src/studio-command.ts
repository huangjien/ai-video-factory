import type { Command } from "commander";
import { spawn } from "node:child_process";
import { resolveProjectDir, resolveProjectRoot } from "./project-path.js";
import { prepareStudioWorkspace } from "@video/video-renderer";

export interface StudioOptions {
  project?: string | undefined;
  cwd?: string | undefined;
  port?: number | undefined;
}

/** Launch Remotion Studio against the project's current composition
 * (plan T0.3). The generated workspace lives under
 * `packages/video-renderer/.studio/<slug>/` and is regenerated on every
 * launch — edit storyboard.yaml (or article.md) and re-run `video studio`
 * to refresh, or edit input props live in the Studio UI. */
export async function runStudio(opts: StudioOptions): Promise<number> {
  let root: string;
  if (opts.project) {
    const resolved = resolveProjectDir(opts.project, opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  } else {
    const resolved = resolveProjectRoot(opts.cwd);
    if (!resolved.ok) {
      console.error(resolved.message);
      return 1;
    }
    root = resolved.root;
  }

  const { loadOrCompileStoryboard } = await import("@video/video-renderer");
  const { renderPlan } = await loadOrCompileStoryboard(root);
  const workspace = await prepareStudioWorkspace(root, renderPlan);

  console.log(`Studio workspace: ${workspace.workspaceDir}`);
  console.log(`Starting Remotion Studio (Ctrl-C to stop)…`);

  return new Promise<number>((resolve) => {
    const child = spawn(
      workspace.bin,
      [
        "studio",
        ...(opts.port !== undefined ? ["--port", String(opts.port)] : []),
      ],
      { cwd: workspace.cwd, stdio: "inherit" },
    );
    child.on("error", (err) => {
      console.error(`studio: failed to start Remotion CLI: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export function registerStudio(program: Command): void {
  program
    .command("studio")
    .description(
      "Open the project in Remotion Studio (live preview; regenerated from the storyboard on each launch)",
    )
    .argument(
      "[project]",
      "project name (slug) — optional if exactly one project exists",
    )
    .option("--cwd <dir>", "project root base directory")
    .option("--port <n>", "port for the Studio web server", (v) =>
      parseInt(v, 10),
    )
    .action(
      async (
        project: string | undefined,
        opts: { cwd?: string; port?: number },
      ) => {
        process.exitCode = await runStudio({
          ...(project !== undefined ? { project } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.port !== undefined ? { port: opts.port } : {}),
        });
      },
    );
}
