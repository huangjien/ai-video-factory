import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeBrandConfig } from "./render-command.js";
import type { RenderPlan } from "@video/vdsl";

const minimalPlan = (): RenderPlan =>
  ({
    project: { id: "demo", language: "zh-CN", fps: 30, width: 1920, height: 1080 },
    style: { theme: "dark-tech" },
    totalFrames: 240,
    scenes: [],
  }) as unknown as RenderPlan;

async function writeBrand(dir: string, body: string): Promise<void> {
  await writeFile(path.join(dir, "brand.yaml"), body, "utf8");
}

/** Workspace-shaped fixture: <ws>/brand.yaml + <ws>/projects/<slug>/.
 * The `projects/` parent is what makes mergeBrandConfig discover the
 * workspace root. */
async function wsProject(wsBrand: string | null, projectBrand: string | null) {
  const ws = await mkdtemp(path.join(tmpdir(), "brand-ws-"));
  const project = path.join(ws, "projects", "demo");
  await mkdir(project, { recursive: true });
  if (wsBrand !== null) await writeBrand(ws, wsBrand);
  if (projectBrand !== null) await writeBrand(project, projectBrand);
  return { ws, project };
}

const ICON = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";

describe("mergeBrandConfig — workspace inheritance", () => {
  it("project inherits the workspace brand.yaml (no project file)", async () => {
    const { ws, project } = await wsProject(
      [
        "brand:",
        "  name: 工作区品牌",
        "  icon: brand-icon.png",
        "  intro:",
        "    duration_sec: 12",
      ].join("\n"),
      null,
    );
    await writeFile(path.join(ws, "brand-icon.png"), Buffer.from(ICON, "base64"));
    const plan = minimalPlan();
    await mergeBrandConfig(plan, project);
    expect(plan.style.brand?.name).toBe("工作区品牌");
    expect(plan.style.brand?.intro?.duration_sec).toBe(12);
    // Icon path resolved ABSOLUTE against the workspace dir that declared it.
    expect(plan.style.brand?.icon).toBe(path.join(ws, "brand-icon.png"));
  });

  it("project brand.yaml overrides per top-level key (intro replaced wholesale)", async () => {
    const { project } = await wsProject(
      [
        "brand:",
        "  name: 工作区品牌",
        "  corner: top-left",
        "  intro:",
        "    duration_sec: 12",
        "    background: ocean",
      ].join("\n"),
      [
        "brand:",
        "  name: 项目品牌",
        "  intro:",
        "    duration_sec: 20",
      ].join("\n"),
    );
    const plan = minimalPlan();
    await mergeBrandConfig(plan, project);
    expect(plan.style.brand?.name).toBe("项目品牌");
    expect(plan.style.brand?.corner).toBe("top-left"); // inherited
    expect(plan.style.brand?.intro?.duration_sec).toBe(20); // project intro
    expect(plan.style.brand?.intro?.background).toBe("aurora"); // NOT ocean — intro replaced wholesale
  });

  it("no brand.yaml anywhere → no brand", async () => {
    const { project } = await wsProject(null, null);
    const plan = minimalPlan();
    await mergeBrandConfig(plan, project);
    expect(plan.style.brand).toBeUndefined();
  });
});

describe("mergeBrandConfig — standalone project dirs", () => {
  it("reads a bare project brand.yaml and absolutizes its icon", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brand-merge-"));
    await writeBrand(dir, "name: bare\nicon: icon.png\n");
    await writeFile(path.join(dir, "icon.png"), Buffer.from(ICON, "base64"));
    const plan = minimalPlan();
    await mergeBrandConfig(plan, dir);
    expect(plan.style.brand?.name).toBe("bare");
    expect(plan.style.brand?.icon).toBe(path.join(dir, "icon.png"));
  });

  it("no-op without brand.yaml", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brand-merge-"));
    const plan = minimalPlan();
    await mergeBrandConfig(plan, dir);
    expect(plan.style.brand).toBeUndefined();
  });

  it("degrades to no-op on invalid yaml or invalid schema", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brand-merge-"));
    const plan = minimalPlan();
    await writeBrand(dir, ": : :: not yaml [");
    await expect(mergeBrandConfig(plan, dir)).resolves.toBeUndefined();
    expect(plan.style.brand).toBeUndefined();
    await writeBrand(dir, "corner: middle\n");
    await expect(mergeBrandConfig(plan, dir)).resolves.toBeUndefined();
    expect(plan.style.brand).toBeUndefined();
  });
});
