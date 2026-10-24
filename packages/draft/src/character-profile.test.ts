import { describe, expect, it } from "vitest";
import {
  CharacterProfileSchema,
  anchorPromptLines,
  anchorsForVariant,
  approvedReferenceFor,
} from "./character-profile.js";
import { loadCharacterProfile, listCharacterIds } from "./character-bible.js";

const PROFILE = {
  schema: "character-profile/1",
  id: "li_shimin",
  name: "李世民",
  identity: {
    era_region: "Tang-dynasty China, 626-630 CE",
    role: "秦王 / 唐太宗",
  },
  anchors: {
    face_shape: {
      value: "圆润下颌，颧骨柔和",
      basis: "inferred",
      note: "工笔传统帝王面相",
    },
    silhouette: { value: "肩背舒展，站姿稳定", basis: "inferred" },
    hair: {
      value: "高髻束发",
      basis: "sourced",
      source: "《旧唐书·太宗本纪》",
    },
  },
  variants: [
    {
      id: "li_shimin__young_prince",
      label: "青年秦王",
      period: "618-626 CE",
      anchors: { costume: { value: "暗色圆领袍", basis: "inferred" } },
    },
    {
      id: "li_shimin__emperor",
      label: "后期皇帝",
      period: "627-649 CE",
      anchors: { costume: { value: "赭黄常服", basis: "inferred" } },
    },
  ],
  references: [
    {
      style: "gongbi",
      version: "v1",
      status: "superseded",
      file: "refs/gongbi/v1.jpg",
    },
    {
      style: "gongbi",
      version: "v2",
      status: "approved",
      file: "refs/gongbi/v2.jpg",
      reviewedBy: "huangjien",
      reviewedAt: "2026-10-19",
    },
    {
      style: "manga",
      version: "v1",
      status: "candidate",
      file: "refs/manga/v1.jpg",
    },
  ],
};

const profile = () => CharacterProfileSchema.parse(PROFILE);

describe("CharacterProfileSchema — provenance is a field, not prose", () => {
  it("accepts a profile where every anchor declares its basis", () => {
    expect(profile().anchors.hair?.basis).toBe("sourced");
    expect(profile().anchors.face_shape?.basis).toBe("inferred");
  });

  it("rejects a sourced anchor with no source", () => {
    const bad = structuredClone(PROFILE);
    delete (bad.anchors.hair as { source?: string }).source;
    expect(() => CharacterProfileSchema.parse(bad)).toThrow(/source/i);
  });

  it("tells you the difference between history and an art choice", () => {
    // CS-11's first acceptance criterion, checked structurally: a reader
    // can sort anchors without any conversation transcript.
    const byBasis = { sourced: 0, inferred: 0 };
    for (const a of Object.values(profile().anchors)) byBasis[a.basis]++;
    expect(byBasis).toEqual({ sourced: 1, inferred: 2 });
  });
});

describe("CharacterProfileSchema — references are versioned and reviewed", () => {
  it("keeps superseded versions on record", () => {
    const versions = profile().references.map(
      (r) => `${r.version}:${r.status}`,
    );
    expect(versions).toContain("v1:superseded");
    expect(versions).toContain("v2:approved");
  });

  it("requires a reviewer before a reference counts as official", () => {
    const bad = structuredClone(PROFILE);
    delete (bad.references[1] as { reviewedBy?: string }).reviewedBy;
    expect(() => CharacterProfileSchema.parse(bad)).toThrow(/reviewedBy/);
  });

  it("allows only one approved reference per art style", () => {
    const bad = structuredClone(PROFILE);
    bad.references.push({
      style: "gongbi",
      version: "v3",
      status: "approved",
      file: "refs/gongbi/v3.jpg",
      reviewedBy: "someone",
      reviewedAt: "2026-10-19",
    });
    expect(() => CharacterProfileSchema.parse(bad)).toThrow(/superseded/);
  });

  it("rejects a duplicate variant id", () => {
    const bad = structuredClone(PROFILE);
    bad.variants.push(structuredClone(bad.variants[0]!));
    expect(() => CharacterProfileSchema.parse(bad)).toThrow(
      /duplicate variant/,
    );
  });
});

describe("approvedReferenceFor — a candidate is never an official asset", () => {
  it("returns the approved sheet for a style", () => {
    expect(approvedReferenceFor(profile(), "gongbi")?.version).toBe("v2");
  });

  it("returns undefined for a style that only has candidates", () => {
    // CS-11's third acceptance criterion: manga has only v1/candidate, so
    // nothing downstream may resolve it as an approved reference.
    expect(approvedReferenceFor(profile(), "manga")).toBeUndefined();
  });

  it("returns undefined for an unknown style", () => {
    expect(approvedReferenceFor(profile(), "photoreal")).toBeUndefined();
  });
});

describe("variants share the identity, override only what differs", () => {
  it("inherits base anchors and overlays the variant's own", () => {
    const anchors = anchorsForVariant(profile(), "li_shimin__emperor");
    expect(anchors.hair?.value).toBe("高髻束发");
    expect(anchors.costume?.value).toBe("赭黄常服");
  });

  it("gives two variants different costume but the same identity anchors", () => {
    const young = anchorsForVariant(profile(), "li_shimin__young_prince");
    const old = anchorsForVariant(profile(), "li_shimin__emperor");
    expect(young.costume?.value).not.toBe(old.costume?.value);
    expect(young.face_shape?.value).toBe(old.face_shape?.value);
  });

  it("throws on an unknown variant rather than silently dropping it", () => {
    expect(() =>
      anchorsForVariant(profile(), "li_shimin__nonexistent"),
    ).toThrow(/no variant/);
  });

  it("emits one prompt line per anchor", () => {
    const lines = anchorPromptLines(profile(), "li_shimin__young_prince");
    expect(lines).toContain("hair: 高髻束发");
    expect(lines).toContain("costume: 暗色圆领袍");
  });
});

describe("listCharacterIds", () => {
  it("returns nothing when the directory does not exist", () => {
    expect(listCharacterIds("/nonexistent/characters")).toEqual([]);
  });
});
