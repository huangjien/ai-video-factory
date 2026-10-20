import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { runCharacter } from "./character-command.js";

function bibleWith(
  references: string,
  { withImage = true }: { withImage?: boolean } = {},
): string {
  const root = mkdtempSync(path.join(tmpdir(), "video-char-"));
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
  if (withImage) {
    writeFileSync(path.join(dir, "refs", "gongbi", "v1.jpg"), "x", "utf8");
  }
  return root;
}

describe("video character — the review workflow (CS-13)", () => {
  it("lists a character and its reference sheets", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    expect(await runCharacter(["list"], { root: path.join(root, "") })).toBe(0);
  });

  it("promotes a candidate and records who reviewed it", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    const code = await runCharacter(
      ["approve", "testchar", "gongbi", "v1"],
      { root, by: "huangjien" },
    );
    expect(code).toBe(0);
    const profile = parseYaml(
      readFileSync(path.join(root, "testchar", "character.yaml"), "utf8"),
    ) as {
      references: {
        status: string;
        reviewedBy?: string;
        reviewedAt?: string;
      }[];
    };
    expect(profile.references[0]?.status).toBe("approved");
    expect(profile.references[0]?.reviewedBy).toBe("huangjien");
    expect(profile.references[0]?.reviewedAt).toBeTruthy();
  });

  it("refuses an approval with no reviewer", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    expect(
      await runCharacter(["approve", "testchar", "gongbi", "v1"], { root }),
    ).toBe(1);
  });

  it("refuses to approve a sheet whose image is missing", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
      { withImage: false },
    );
    expect(
      await runCharacter(["approve", "testchar", "gongbi", "v1"], {
        root,
        by: "huangjien",
      }),
    ).toBe(1);
  });

  it("supersedes the previous official sheet when a newer one is approved", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: approved\n    file: refs/gongbi/v1.jpg\n    reviewedBy: someone\n    reviewedAt: 2026-01-01T00:00:00.000Z\n  - style: gongbi\n    version: v2\n    status: candidate\n    file: refs/gongbi/v2.jpg\n",
    );
    writeFileSync(
      path.join(root, "testchar", "refs", "gongbi", "v2.jpg"),
      "x",
      "utf8",
    );
    expect(
      await runCharacter(["approve", "testchar", "gongbi", "v2"], {
        root,
        by: "huangjien",
      }),
    ).toBe(0);
    const profile = parseYaml(
      readFileSync(path.join(root, "testchar", "character.yaml"), "utf8"),
    ) as { references: { version: string; status: string }[] };
    // The old sheet is kept, demoted — never deleted.
    expect(profile.references.find((r) => r.version === "v1")?.status).toBe(
      "superseded",
    );
    expect(profile.references.find((r) => r.version === "v2")?.status).toBe(
      "approved",
    );
  });

  it("supersedes the other candidates too, so only one sheet is live", async () => {
    // Leaving the rejected sheets as "candidate" would falsely suggest
    // they are still awaiting review.
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n  - style: gongbi\n    version: v2\n    status: candidate\n    file: refs/gongbi/v2.jpg\n  - style: gongbi\n    version: v3\n    status: candidate\n    file: refs/gongbi/v3.jpg\n",
    );
    writeFileSync(
      path.join(root, "testchar", "refs", "gongbi", "v3.jpg"),
      "x",
      "utf8",
    );
    expect(
      await runCharacter(["approve", "testchar", "gongbi", "v3"], {
        root,
        by: "huangjien",
      }),
    ).toBe(0);
    const profile = parseYaml(
      readFileSync(path.join(root, "testchar", "character.yaml"), "utf8"),
    ) as { references: { version: string; status: string }[] };
    expect(profile.references.find((r) => r.version === "v1")?.status).toBe(
      "superseded",
    );
    expect(profile.references.find((r) => r.version === "v2")?.status).toBe(
      "superseded",
    );
    expect(profile.references.find((r) => r.version === "v3")?.status).toBe(
      "approved",
    );
  });

  it("never resurrects a superseded sheet", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: superseded\n    file: refs/gongbi/v1.jpg\n",
    );
    expect(
      await runCharacter(["approve", "testchar", "gongbi", "v1"], {
        root,
        by: "huangjien",
      }),
    ).toBe(1);
  });
});

describe("video character — generating a reference sheet (CS-13)", () => {
  it("writes a candidate sheet and records it as a candidate", async () => {
    const root = bibleWith("");
    const code = await runCharacter(["sheet", "testchar", "gongbi"], {
      root,
      provider: "mock",
    });
    expect(code).toBe(0);
    const profile = parseYaml(
      readFileSync(path.join(root, "testchar", "character.yaml"), "utf8"),
    ) as { references: { style: string; version: string; status: string }[] };
    expect(profile.references[0]?.status).toBe("candidate");
    expect(profile.references[0]?.version).toBe("v1");
    expect(
      existsSync(
        path.join(root, "testchar", "refs", "gongbi", "v1.jpg"),
      ),
    ).toBe(true);
  });

  it("never overwrites an existing sheet — it takes the next version", async () => {
    const root = bibleWith(
      "  - style: gongbi\n    version: v1\n    status: candidate\n    file: refs/gongbi/v1.jpg\n",
    );
    const code = await runCharacter(["sheet", "testchar", "gongbi"], {
      root,
      provider: "mock",
    });
    expect(code).toBe(0);
    const profile = parseYaml(
      readFileSync(path.join(root, "testchar", "character.yaml"), "utf8"),
    ) as { references: { version: string }[] };
    expect(profile.references.map((r) => r.version).sort()).toEqual(["v1", "v2"]);
  });

  it("refuses an unknown art style", async () => {
    const root = bibleWith("");
    expect(
      await runCharacter(["sheet", "testchar", "no-such-style"], {
        root,
        provider: "mock",
      }),
    ).toBe(1);
  });

  it("refuses an unknown variant", async () => {
    const root = bibleWith("");
    expect(
      await runCharacter(["sheet", "testchar", "gongbi"], {
        root,
        provider: "mock",
        variant: "nope",
      }),
    ).toBe(1);
  });
});
