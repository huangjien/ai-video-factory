import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  approveCharacterReference,
  buildSheetPrompt,
  characterFilePath,
  characterRootFor,
  nextVersionLabel,
  referenceFilePath,
  workspaceCharacterRoot,
  writeCandidateReference,
} from "./character-bible.js";
import type { CharacterProfile } from "./character-profile.js";

/** A bible with one character, and the reference sheets it declares. */
function bibleWith(references: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "vf-bible-"));
  const dir = path.join(root, "testchar");
  mkdirSync(path.join(dir, "refs", "gongbi"), { recursive: true });
  writeFileSync(
    path.join(dir, "character.yaml"),
    [
      "schema: character-profile/1",
      "id: testchar",
      "name: 测试角色",
      "identity:",
      "  era_region: Tang-dynasty China, 626-630 CE",
      "anchors:",
      "  silhouette:",
      "    value: 身形高大",
      "    basis: inferred",
      references === "" ? "references: []" : `references:\n${references}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function profileIn(root: string): CharacterProfile {
  return parseYaml(
    readFileSync(characterFilePath(root, "testchar"), "utf8"),
  ) as CharacterProfile;
}

describe("the bible's on-disk shape", () => {
  it("keeps the profile and the sheets where the rules say", () => {
    const root = "/ws";
    expect(characterFilePath(root, "li_shimin")).toBe(
      "/ws/li_shimin/character.yaml",
    );
    expect(referenceFilePath(root, "li_shimin", "gongbi", "v2")).toBe(
      "/ws/li_shimin/refs/gongbi/v2.jpg",
    );
  });

  it("derives the bible root from the workspace, once", () => {
    expect(workspaceCharacterRoot("/ws")).toBe("/ws/assets/characters");
  });

  it("finds the workspace bible from a project under projects/", () => {
    const ws = mkdtempSync(path.join(tmpdir(), "video-ws-"));
    mkdirSync(path.join(ws, "projects", "film"), { recursive: true });
    mkdirSync(path.join(ws, "assets", "characters"), { recursive: true });
    expect(characterRootFor(path.join(ws, "projects", "film"))).toBe(
      path.join(ws, "assets", "characters"),
    );
  });
});

describe("a fresh sheet is a 候选角色参考", () => {
  it("writes the sheet and records it as a candidate", () => {
    const root = bibleWith("");
    const { profile, file } = writeCandidateReference(
      root,
      "testchar",
      "gongbi",
      "v1",
      new Uint8Array([1, 2, 3]),
    );
    expect(existsSync(file)).toBe(true);
    expect(file).toBe(referenceFilePath(root, "testchar", "gongbi", "v1"));
    expect(profile.references[0]?.status).toBe("candidate");
    expect(profile.references[0]?.file).toBe("refs/gongbi/v1.jpg");
    // The profile on disk agrees with what the module returned.
    expect(profileIn(root).references[0]?.status).toBe("candidate");
  });

  it("never reuses a version label", () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    const profile = profileIn(root);
    expect(nextVersionLabel(profile, "gongbi")).toBe("v2");
    writeCandidateReference(
      root,
      "testchar",
      "gongbi",
      "v2",
      new Uint8Array([1]),
    );
    expect(nextVersionLabel(profileIn(root), "gongbi")).toBe("v3");
  });
});

describe("the sheet prompt is faithful to the anchors", () => {
  it("carries the anchors and the style contract, and asks for no text", () => {
    const root = bibleWith("");
    const prompt = buildSheetPrompt(profileIn(root), "gongbi");
    expect(prompt).toContain("测试角色");
    expect(prompt).toContain("silhouette: 身形高大");
    expect(prompt).toContain("no calligraphy");
    expect(prompt).toContain("gongbi");
  });
});

describe("an approval promotes the sheet to the 正式角色参考", () => {
  it("records who reviewed it and when", () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    writeFileSync(
      referenceFilePath(root, "testchar", "gongbi", "v1"),
      "x",
      "utf8",
    );
    const outcome = approveCharacterReference(
      root,
      "testchar",
      "gongbi",
      "v1",
      "huangjien",
    );
    expect(outcome.approved.status).toBe("approved");
    expect(outcome.approved.reviewedBy).toBe("huangjien");
    expect(outcome.approved.reviewedAt).toBeTruthy();
    expect(profileIn(root).references[0]?.status).toBe("approved");
  });

  it("supersedes the previous official sheet, which stays on disk", () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: approved\n    file: refs/gongbi/v1.jpg\n    reviewedBy: someone\n    reviewedAt: 2026-01-01T00:00:00.000Z\n  - style: gongbi\n    version: v2\n    status: candidate\n    file: refs/gongbi/v2.jpg\n",
    );
    writeFileSync(
      referenceFilePath(root, "testchar", "gongbi", "v1"),
      "x",
      "utf8",
    );
    writeFileSync(
      referenceFilePath(root, "testchar", "gongbi", "v2"),
      "x",
      "utf8",
    );
    const outcome = approveCharacterReference(
      root,
      "testchar",
      "gongbi",
      "v2",
      "huangjien",
    );
    expect(outcome.superseded.map((r) => r.version)).toEqual(["v1"]);
    const after = profileIn(root);
    expect(after.references.find((r) => r.version === "v1")?.status).toBe(
      "superseded",
    );
    expect(after.references.find((r) => r.version === "v2")?.status).toBe(
      "approved",
    );
    expect(
      existsSync(referenceFilePath(root, "testchar", "gongbi", "v1")),
    ).toBe(true);
  });

  it("refuses to approve a sheet whose image is missing", () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    expect(() =>
      approveCharacterReference(root, "testchar", "gongbi", "v1", "huangjien"),
    ).toThrow(/points at a missing file/);
  });

  it("refuses a reference the character does not have", () => {
    const root = bibleWith("");
    expect(() =>
      approveCharacterReference(root, "testchar", "gongbi", "v9", "huangjien"),
    ).toThrow(/has no reference gongbi\/v9/);
  });

  it("never resurrects a superseded sheet", () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: superseded\n    file: refs/gongbi/v1.jpg\n",
    );
    writeFileSync(
      referenceFilePath(root, "testchar", "gongbi", "v1"),
      "x",
      "utf8",
    );
    expect(() =>
      approveCharacterReference(root, "testchar", "gongbi", "v1", "huangjien"),
    ).toThrow(/superseded/);
  });
});
