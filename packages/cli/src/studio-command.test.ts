import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { runStudio } from "./studio-command.js";

let projectsRoot: string;

beforeAll(async () => {
  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-studio-"));
});

afterAll(async () => {
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

describe("runStudio", () => {
  it("fails with exit 1 on an unknown project", async () => {
    const code = await runStudio({ project: "ghost", cwd: projectsRoot });
    expect(code).toBe(1);
  });

  it("auto-discovery without any project fails too", async () => {
    const code = await runStudio({ cwd: projectsRoot });
    expect(code).toBe(1);
  });

  it("rejects when the resolved project has no storyboard to compile", async () => {
    // Valid project root (state.yaml) but no storyboard.yaml: the in-process
    // loadOrCompileStoryboard read fails before any Studio process spawns.
    const proj = path.join(projectsRoot, "projects", "st-empty");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("st-empty"));
    await expect(
      runStudio({ project: "st-empty", cwd: projectsRoot }),
    ).rejects.toThrow();
  });
});

describe("runStudio — project resolution forms", () => {
  it("accepts a direct path to a project root", async () => {
    const proj = path.join(projectsRoot, "st-direct");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("st-direct"));
    // Resolution succeeds; the run then rejects on the missing storyboard
    // read — proving the direct-path form reached the compile step.
    await expect(
      runStudio({ project: proj, cwd: projectsRoot }),
    ).rejects.toThrow(/ENOENT|storyboard/);
  });

  it("accepts a unique folder-name prefix", async () => {
    const proj = path.join(projectsRoot, "projects", "st-prefixdemo");
    await mkdir(proj, { recursive: true });
    await writeProjectState(proj, initState("st-prefixdemo"));
    await expect(
      runStudio({ project: "st-prefix", cwd: projectsRoot }),
    ).rejects.toThrow(/ENOENT|storyboard/);
  });
});

describe("runStudio — auto-discovery", () => {
  it("resolves the single project under projects/ when no name is given", async () => {
    const solo = await mkdtemp(path.join(tmpdir(), "vf-studio-solo-"));
    try {
      const proj = path.join(solo, "projects", "only-one");
      await mkdir(proj, { recursive: true });
      await writeProjectState(proj, initState("only-one"));
      // Auto-discovery lands on the only project, then the missing
      // storyboard read rejects — the Studio process never spawns.
      await expect(runStudio({ cwd: solo })).rejects.toThrow(
        /ENOENT|storyboard/,
      );
    } finally {
      await rm(solo, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("fails with exit 1 when several projects make discovery ambiguous", async () => {
    const solo = await mkdtemp(path.join(tmpdir(), "vf-studio-multi-"));
    try {
      for (const name of ["one", "two"]) {
        const proj = path.join(solo, "projects", name);
        await mkdir(proj, { recursive: true });
        await writeProjectState(proj, initState(name));
      }
      expect(await runStudio({ cwd: solo })).toBe(1);
    } finally {
      await rm(solo, { recursive: true, force: true }).catch(() => {});
    }
  });
});
