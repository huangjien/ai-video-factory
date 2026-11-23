import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRootSourcePath } from "./root-source.js";

describe("resolveRootSourcePath — the Remotion Root lives in two layouts", () => {
  it("finds the sibling Root next to the module (workspace layout)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-root-sibling-"));
    writeFileSync(path.join(dir, "Root.js"), "export const Root = () => null;");
    expect(resolveRootSourcePath(path.join(dir, "render.js"))).toBe(
      path.join(dir, "Root.js"),
    );
  });

  it("finds the vendored Root beside the bundle (published layout)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-root-vendor-"));
    mkdirSync(path.join(dir, "vendor"), { recursive: true });
    writeFileSync(path.join(dir, "vendor", "Root.js"), "export const Root = () => null;");
    expect(resolveRootSourcePath(path.join(dir, "cli.js"))).toBe(
      path.join(dir, "vendor", "Root.js"),
    );
  });

  it("prefers the sibling when both exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-root-both-"));
    mkdirSync(path.join(dir, "vendor"), { recursive: true });
    writeFileSync(path.join(dir, "Root.js"), "sibling");
    writeFileSync(path.join(dir, "vendor", "Root.js"), "vendor");
    expect(resolveRootSourcePath(path.join(dir, "render.js"))).toBe(
      path.join(dir, "Root.js"),
    );
  });

  it("returns null when no Root exists — the caller fails loudly", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-root-none-"));
    expect(resolveRootSourcePath(path.join(dir, "render.js"))).toBeNull();
  });

  it("looks for Root.tsx when the module is TypeScript source", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vf-root-tsx-"));
    writeFileSync(path.join(dir, "Root.tsx"), "export const Root = () => null;");
    expect(resolveRootSourcePath(path.join(dir, "render.ts"))).toBe(
      path.join(dir, "Root.tsx"),
    );
  });
});
