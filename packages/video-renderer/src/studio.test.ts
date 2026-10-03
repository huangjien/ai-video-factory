import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RenderPlan } from "@video/vdsl";
import { prepareStudioWorkspace } from "./studio.js";

const samplePlan: RenderPlan = {
  project: {
    id: "fixture",
    language: "zh-CN",
    fps: 30,
    width: 640,
    height: 360,
  },
  style: { theme: "dark-tech" },
  totalFrames: 150,
  scenes: [
    {
      id: "scene-01",
      index: 0,
      startFrame: 0,
      durationInFrames: 150,
      component: "Title",
      renderer: "remotion",
      props: { text: "studio test" },
      animation: { entrance: "none", emphasis: "none", exit: "none" },
      animations: [],
      transition: null,
      captions: null,
      audio: null,
    },
  ],
};

describe("prepareStudioWorkspace (T0.3)", () => {
  let workspaceParent: string;

  afterEach(() => {
    if (workspaceParent) {
      rmSync(workspaceParent, { recursive: true, force: true });
      workspaceParent = "";
    }
  });

  it("writes a self-contained studio workspace with the compiled plan", async () => {
    workspaceParent = mkdtempSync(path.join(tmpdir(), "video-studio-"));
    const workspaceDir = path.join(workspaceParent, "studio", "fixture");
    const projectRoot = path.join(workspaceParent, "projects", "fixture");
    const ws = await prepareStudioWorkspace(projectRoot, samplePlan, workspaceDir);

    // All four files a Remotion project needs.
    const entry = path.join(workspaceDir, "src", "index.tsx");
    expect(existsSync(entry)).toBe(true);
    expect(existsSync(path.join(workspaceDir, "remotion.config.ts"))).toBe(true);
    expect(existsSync(path.join(workspaceDir, "package.json"))).toBe(true);
    expect(existsSync(path.join(workspaceDir, "tsconfig.json"))).toBe(true);

    // Entry inlines the plan and imports the real Root implementation.
    const src = readFileSync(entry, "utf8");
    expect(src).toContain('id="video-factory"');
    expect(src).toContain("150");
    expect(src).toContain('text":"studio test"');
    expect(src).toMatch(/import { Root } from ".*Root\.(ts|js)x?"/);
    // The referenced Root implementation exists.
    const rootImport = src.match(/from "(.+Root\.(ts|js)x?)"/);
    expect(rootImport).toBeTruthy();
    expect(existsSync(rootImport![1]!)).toBe(true);

    // The version-matched CLI binary resolves.
    expect(path.basename(ws.bin)).toBe("remotion");
    expect(existsSync(ws.bin)).toBe(true);
    expect(ws.cwd).toBe(workspaceDir);
  });
});
