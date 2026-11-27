import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArticle } from "@video/draft";
import { expect, it } from "vitest";
import { resolveSceneCast } from "./scene-cast.js";

it("resolves story-local names to the same pinned image and hashes changes", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "scene-cast-"));
  try {
    const asset = path.join(workspace, "assets/characters/young_woman_01");
    mkdirSync(path.join(asset, "refs/manga"), { recursive: true });
    writeFileSync(
      path.join(asset, "character.yaml"),
      [
        "schema: character-profile/1",
        "id: young_woman_01",
        "name: Library model",
        "identity: { era_region: New York }",
        "anchors: { hair: { value: Dark braid, basis: inferred } }",
        "references:",
        "  - { style: manga, version: v1, status: superseded, file: refs/manga/v1.png }",
        "  - { style: manga, version: v2, status: candidate, file: refs/manga/v2.png }",
      ].join("\n"),
    );
    const image = path.join(asset, "refs/manga/v1.png");
    writeFileSync(image, "first version");
    const article = (role: string) =>
      parseArticle(
        [
          "---",
          "project: Cast check",
          "language: en-US",
          "duration_target_sec: 8",
          "voice: test",
          `cast: { ${role}: { name: ${role}, asset: young_woman_01, reference: manga/v1 } }`,
          "---",
          "# Cast check",
          "",
          "## Scenes",
          "",
          "```yaml",
          "scenes:",
          `  - { id: scene_1, duration: 8, caption: Window, visual: Ink drawing, narration: She looks out, characters: [{ id: ${role} }] }`,
          "```",
        ].join("\n"),
      );
    const johnsy = resolveSceneCast(
      path.join(workspace, "projects/film"),
      article("Johnsy"),
      0,
    )!;
    const emma = resolveSceneCast(
      path.join(workspace, "projects/other/l10n/en-US"),
      article("Emma"),
      0,
    )!;
    expect(johnsy.references).toEqual(emma.references);
    expect(emma.identities[0]?.name).toBe("Emma");
    expect(emma.digest).not.toBe(johnsy.digest);
    writeFileSync(image, "changed bytes");
    expect(
      resolveSceneCast(
        path.join(workspace, "projects/film"),
        article("Johnsy"),
        0,
      )?.digest,
    ).not.toBe(johnsy.digest);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
