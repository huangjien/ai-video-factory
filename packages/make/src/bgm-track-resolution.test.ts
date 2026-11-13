import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBgmTrack, workspaceRootFor } from "./index.js";

/**
 * `bgm_tracks` windows must resolve to a REAL file. The timeline builder
 * hands each window's path straight to ffmpeg, so a window that resolves
 * to a non-existent path kills the mix with "No such file or directory".
 *
 * Regression: a NAMED library tag was resolved to
 * <project>/assets/audio-assets/bgm/<tag>.wav — a file that only exists
 * when a `--bgm-dir` was staged. Every multi-window config naming a
 * curated track therefore failed to mix.
 */
describe("resolveBgmTrack — bgm_tracks window resolution", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  /** A workspace with projects/<id>/ and a curated library at assets/bgm/. */
  function workspace(): { ws: string; project: string } {
    const ws = mkdtempSync(path.join(tmpdir(), "vf-bgm-ws-"));
    roots.push(ws);
    const project = path.join(ws, "projects", "demo");
    mkdirSync(path.join(project, "assets", "audio-assets", "bgm"), {
      recursive: true,
    });
    mkdirSync(path.join(ws, "assets", "bgm"), { recursive: true });
    mkdirSync(path.join(ws, "assets", "brand"), { recursive: true });
    return { ws, project };
  }

  it("resolves a NAMED tag against the curated workspace library", async () => {
    const { ws, project } = workspace();
    const curated = path.join(ws, "assets", "bgm", "epic-phoenix.mp3");
    writeFileSync(curated, "audio");

    const resolved = await resolveBgmTrack(project, "epic-phoenix");

    expect(resolved).toBe(curated);
    expect(existsSync(resolved)).toBe(true);
  });

  it("prefers the project-local override over the curated library", async () => {
    const { ws, project } = workspace();
    writeFileSync(path.join(ws, "assets", "bgm", "epic-phoenix.mp3"), "audio");
    const local = path.join(
      project,
      "assets",
      "audio-assets",
      "bgm",
      "epic-phoenix.wav",
    );
    writeFileSync(local, "audio");

    expect(await resolveBgmTrack(project, "epic-phoenix")).toBe(local);
  });

  it("resolves a PATH-shaped track workspace-relative (shared brand audio)", async () => {
    const { ws, project } = workspace();
    const brand = path.join(ws, "assets", "brand", "intro.wav");
    writeFileSync(brand, "audio");

    expect(await resolveBgmTrack(project, "assets/brand/intro.wav")).toBe(brand);
  });

  it("resolves a PATH-shaped track project-relative first", async () => {
    const { project } = workspace();
    const local = path.join(project, "assets", "brand", "intro.wav");
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, "audio");

    expect(await resolveBgmTrack(project, "assets/brand/intro.wav")).toBe(local);
  });

  it("finds the workspace root from a derived l10n workdir", async () => {
    const { ws, project } = workspace();
    const derived = path.join(project, "l10n", "en-US");
    mkdirSync(derived, { recursive: true });

    expect(workspaceRootFor(derived)).toBe(ws);
    writeFileSync(path.join(ws, "assets", "bgm", "epic-phoenix.mp3"), "audio");
    expect(await resolveBgmTrack(derived, "epic-phoenix")).toBe(
      path.join(ws, "assets", "bgm", "epic-phoenix.mp3"),
    );
  });
});
