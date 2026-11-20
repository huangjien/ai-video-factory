import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const makeMock = vi.fn();
vi.mock("./make-command.js", () => ({
  runMakeCli: (...a: unknown[]) => (makeMock as (...x: unknown[]) => unknown)(...a),
}));

import { runVertical, verticalArticleMd, verticalRootFor } from "./vertical-command.js";

let repoRoot: string;
const ARTICLE = `---
project: demo-film
language: zh-CN
duration_target_sec: 180
voice: zh-CN-XiaoxiaoNeural
---

# 正文

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 30
    caption: 幕
    visual: 画面
    narration: |
      旁白。
\`\`\`
`;

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "video-vertical-"));
  const proj = path.join(repoRoot, "projects", "demo-film");
  mkdirSync(path.join(proj, "storyboard"), { recursive: true });
  writeFileSync(path.join(proj, "storyboard", "storyboard.yaml"), "schema_version: \"0.2\"\n");
  writeFileSync(path.join(proj, "article.md"), ARTICLE, "utf8");
  writeFileSync(path.join(proj, "audio-config.yaml"), "voice: zh-CN-XiaoxiaoNeural\nbgm: calm\n", "utf8");
  makeMock.mockReset().mockResolvedValue(0);
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("verticalArticleMd", () => {
  it("declares format: vertical and keeps every other frontmatter key", () => {
    const out = verticalArticleMd(ARTICLE);
    expect(out).toMatch(/^---\n/);
    expect(out).toMatch(/format: vertical/);
    expect(out).toMatch(/project: demo-film/);
    expect(out).toMatch(/language: zh-CN/);
    expect(out).toMatch(/voice: zh-CN-XiaoxiaoNeural/);
    expect(out).toContain("## Scenes");
    expect(out).toContain("旁白。");
  });

  it("throws when the article has no frontmatter", () => {
    expect(() => verticalArticleMd("# no frontmatter")).toThrow(/no frontmatter/);
  });
});

describe("runVertical", () => {
  it("builds the vertical workdir and renders it", async () => {
    const code = await runVertical({ project: "demo-film", cwd: repoRoot });
    expect(code).toBe(0);
    const vRoot = verticalRootFor(path.join(repoRoot, "projects", "demo-film"));
    expect(existsSync(path.join(vRoot, "article.md"))).toBe(true);
    expect(readFileSync(path.join(vRoot, "article.md"), "utf8")).toMatch(/format: vertical/);
    expect(existsSync(path.join(vRoot, "audio-config.yaml"))).toBe(true);
    expect(existsSync(path.join(vRoot, "state.yaml"))).toBe(true);
    expect(makeMock).toHaveBeenCalledTimes(1);
    expect(makeMock.mock.calls[0]?.[0]).toMatchObject({ project: vRoot });
  });

  it("skips when a master exists and the article has not changed", async () => {
    const proj = path.join(repoRoot, "projects", "demo-film");
    const vRoot = verticalRootFor(proj);
    mkdirSync(path.join(vRoot, "output"), { recursive: true });
    writeFileSync(path.join(vRoot, "output", "final-mixed.mp4"), "mp4");
    const code = await runVertical({ project: "demo-film", cwd: repoRoot });
    expect(code).toBe(0);
    expect(makeMock).not.toHaveBeenCalled();
  });

  it("re-renders with --force", async () => {
    const proj = path.join(repoRoot, "projects", "demo-film");
    const vRoot = verticalRootFor(proj);
    mkdirSync(path.join(vRoot, "output"), { recursive: true });
    writeFileSync(path.join(vRoot, "output", "final-mixed.mp4"), "mp4");
    const code = await runVertical({ project: "demo-film", cwd: repoRoot, force: true });
    expect(code).toBe(0);
    expect(makeMock).toHaveBeenCalledTimes(1);
  });
});
