import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildScenePromptMessages } from "./image-prompt.js";
import {
  anchorPromptLines,
  characterRootFor,
  loadCharacterById,
  loadCharacterProfile,
} from "./character-profile.js";

const REPO = path.resolve(import.meta.dirname, "../../..");
const BIBLE = path.join(REPO, "assets", "characters");

describe("characterRootFor (CS-12)", () => {
  it("finds the workspace bible from a project under projects/", () => {
    const ws = mkdtempSync(path.join(tmpdir(), "video-ws-"));
    mkdirSync(path.join(ws, "projects", "film"), { recursive: true });
    mkdirSync(path.join(ws, "assets", "characters"), { recursive: true });
    expect(characterRootFor(path.join(ws, "projects", "film"))).toBe(
      path.join(ws, "assets", "characters"),
    );
  });

  it("returns null when the workspace has no character bible", () => {
    const ws = mkdtempSync(path.join(tmpdir(), "video-ws-"));
    mkdirSync(path.join(ws, "projects", "film"), { recursive: true });
    expect(characterRootFor(path.join(ws, "projects", "film"))).toBeNull();
  });

  it("returns null when the project is not under a workspace", () => {
    expect(characterRootFor("/somewhere/else")).toBeNull();
  });
});

describe("loadCharacterById", () => {
  it("loads li_shimin from the real bible", () => {
    const p = loadCharacterById(BIBLE, "li_shimin");
    expect(p?.name).toBe("李世民");
    expect(p?.variants.map((v) => v.id)).toEqual([
      "li_shimin__young_prince",
      "li_shimin__emperor",
    ]);
  });

  it("returns undefined for a character with no profile", () => {
    expect(loadCharacterById(BIBLE, "nobody")).toBeUndefined();
  });
});

describe("the two variants share an identity but differ in dress (CS-12)", () => {
  const p = loadCharacterById(BIBLE, "li_shimin")!;

  it("keeps silhouette, face and hair identical across variants", () => {
    const young = anchorPromptLines(p, "li_shimin__young_prince").join("|");
    const old = anchorPromptLines(p, "li_shimin__emperor").join("|");
    for (const shared of ["silhouette", "face_shape", "hair", "temperament"]) {
      expect(young).toContain(shared);
      expect(old).toContain(shared);
    }
  });

  it("changes costume, props and age between the variants", () => {
    const young = anchorPromptLines(p, "li_shimin__young_prince").join("|");
    const old = anchorPromptLines(p, "li_shimin__emperor").join("|");
    expect(young).not.toBe(old);
    expect(young).toContain("暗色圆领袍");
    expect(old).toContain("赭黄");
  });

  it("marks the art choices as inferred, not as history", () => {
    // The face of a historical person is not in the chronicles; only the
    // temperament has a source.
    const byBasis = {
      sourced: Object.values(p.anchors).filter((a) => a.basis === "sourced")
        .length,
      inferred: Object.values(p.anchors).filter((a) => a.basis === "inferred")
        .length,
    };
    expect(byBasis.sourced).toBeGreaterThan(0);
    expect(byBasis.inferred).toBeGreaterThan(byBasis.sourced);
    expect(p.anchors.face_shape?.basis).toBe("inferred");
    expect(p.anchors.face_shape?.source).toBeUndefined();
  });
});

describe("character anchors reach the image brief (CS-12)", () => {
  const p = loadCharacterById(BIBLE, "li_shimin")!;

  it("splices the cited character's anchors into the brief", () => {
    const msgs = buildScenePromptMessages(
      {
        id: "scene-05",
        visual: "年轻统帅在战场上凯旋",
        characters: [{ id: "li_shimin", variant: "li_shimin__young_prince" }],
      },
      { characterRoot: BIBLE },
    );
    const user = msgs[1]!.content;
    expect(user).toContain("李世民");
    expect(user).toContain("face_shape");
    expect(user).toContain("暗色圆领袍");
  });

  it("distinguishes the two variants in the brief", () => {
    const brief = (variant: string) =>
      buildScenePromptMessages(
        { id: "s", visual: "v", characters: [{ id: "li_shimin", variant }] },
        { characterRoot: BIBLE },
      )[1]!.content;
    expect(brief("li_shimin__young_prince")).toContain("暗色圆领袍");
    expect(brief("li_shimin__emperor")).toContain("赭黄");
  });

  it("adds nothing when a scene cites no character", () => {
    const plain = buildScenePromptMessages(
      { id: "s", visual: "v" },
      {
        characterRoot: BIBLE,
      },
    )[1]!.content;
    expect(plain).not.toContain('Character "');
  });

  it("adds nothing for a character that has no profile", () => {
    const plain = buildScenePromptMessages(
      { id: "s", visual: "v", characters: [{ id: "nobody" }] },
      { characterRoot: BIBLE },
    )[1]!.content;
    expect(plain).not.toContain('Character "');
  });
});
