import type { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { slugifyProjectName } from "./project-path.js";
import { MARK_OK, brandBannerLine } from "./ui.js";

const STORYBOARD_TEMPLATE = (
  projectId: string,
  width: number,
  height: number,
): string => `schema_version: "0.2"

project:
  id: ${projectId}
  language: zh-CN
  fps: 30
  width: ${width}
  height: ${height}

style:
  theme: dark-tech

scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "第一段讲解"
    visual:
      component: Title
      props:
        text: "${projectId}"
`;

export interface NewOptions {
  projectId: string;
  cwd?: string | undefined;
  /** 2026-11-20: video format — frame dims written into project.yaml and
   *  the scaffolded storyboard. landscape (default) | vertical. */
  format?: "landscape" | "vertical" | undefined;
}

const DIMS: Record<
  "landscape" | "vertical",
  { width: number; height: number }
> = {
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
};

export async function runNew(opts: NewOptions): Promise<number> {
  // Always create the project at `<cwd>/projects/<projectId>/` so the
  // layout matches runPreview/runStatus/etc. and the positional project
  // arg in the CLI works uniformly.
  const base = opts.cwd ?? ".";
  const projectId = slugifyProjectName(opts.projectId);
  const { width, height } = DIMS[opts.format ?? "landscape"];
  const root = path.resolve(base, "projects", projectId);
  if (existsSync(root)) {
    console.error(`refused: project already exists at ${root}`);
    return 1;
  }
  await mkdir(path.join(root, "storyboard"), { recursive: true });
  await mkdir(path.join(root, "vdsl"), { recursive: true });
  await mkdir(path.join(root, "assets", "audio"), { recursive: true });
  await mkdir(path.join(root, "assets", "images"), { recursive: true });
  await mkdir(path.join(root, "assets", "fonts"), { recursive: true });
  await mkdir(path.join(root, "captions"), { recursive: true });
  await mkdir(path.join(root, "checkpoints"), { recursive: true });
  await mkdir(path.join(root, "runs"), { recursive: true });
  await mkdir(path.join(root, "output"), { recursive: true });

  await writeFile(
    path.join(root, "project.yaml"),
    `id: ${projectId}\nlanguage: zh-CN\nfps: 30\nwidth: ${width}\nheight: ${height}\ntheme: dark-tech\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "storyboard", "storyboard.yaml"),
    STORYBOARD_TEMPLATE(projectId, width, height),
    "utf8",
  );
  // vdsl/vdsl.yaml is NOT scaffolded: it is the compiled artifact, written
  // by `video preview`/`video final` from the storyboard (plan §6). Seeding it
  // with an empty stub would make the freshness check prefer the stub.
  await writeProjectState(root, initState(projectId));
  console.log(brandBannerLine());
  console.log(`▷ new channel: ${path.basename(root)}`);
  console.log("");
  console.log(`${MARK_OK} scaffolded ${root}`);
  console.log(
    `  next: edit storyboard/storyboard.yaml, then \`video approve storyboard\`, then \`video preview\``,
  );
  return 0;
}

export async function readStateOrNull(projectRoot: string) {
  const text = await readFile(
    path.join(projectRoot, "state.yaml"),
    "utf8",
  ).catch(() => null);
  return text;
}

export function registerNew(program: Command): void {
  program
    .command("new")
    .argument("<project-id>", "project id (used as directory name)")
    .option("--cwd <dir>", "base directory for the project")
    .option(
      "--format <format>",
      "video format: landscape (default, 1920x1080) | vertical (1080x1920)",
      (v: string) => {
        const allowed = ["landscape", "vertical"];
        if (!allowed.includes(v)) {
          throw new Error(`--format must be ${allowed.join("|")}, got: ${v}`);
        }
        return v as "landscape" | "vertical";
      },
    )
    .action(
      async (
        projectId: string,
        opts: { cwd?: string; format?: "landscape" | "vertical" },
      ) => {
        process.exitCode = await runNew({
          projectId,
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.format !== undefined ? { format: opts.format } : {}),
        });
      },
    );
}
