import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { initState, writeProjectState } from "@vf/workflow";

const STORYBOARD_TEMPLATE = (projectId: string): string => `schema_version: "0.1"

project:
  id: ${projectId}
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

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
}

export async function runNew(opts: NewOptions): Promise<number> {
  // Always create the project at `<cwd>/projects/<projectId>/` so the
  // layout matches runPreview/runStatus/etc. and the positional project
  // arg in the CLI works uniformly.
  const base = opts.cwd ?? ".";
  const root = path.resolve(base, "projects", opts.projectId);
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
    `id: ${opts.projectId}\nlanguage: zh-CN\nfps: 30\nwidth: 1920\nheight: 1080\ntheme: dark-tech\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "storyboard", "storyboard.yaml"),
    STORYBOARD_TEMPLATE(opts.projectId),
    "utf8",
  );
  await writeFile(
    path.join(root, "vdsl", "vdsl.yaml"),
    `schema_version: "0.1"\nproject: {id: ${opts.projectId}, language: zh-CN, fps: 30, width: 1920, height: 1080}\nscenes: []\n`,
    "utf8",
  );
  await writeProjectState(root, initState(opts.projectId));
  console.log(`✓ scaffolded ${root}`);
  console.log(`  next: edit storyboard/storyboard.yaml, then run \`vf preview\``);
  return 0;
}

export async function readStateOrNull(projectRoot: string) {
  const text = await readFile(path.join(projectRoot, "state.yaml"), "utf8")
    .catch(() => null);
  return text;
}
