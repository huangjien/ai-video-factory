import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { l10nRootOrThrow, runTranslate } from "./translate-command.js";

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vidl10n-"));
  await mkdir(path.join(root, "l10n", "en-US"), { recursive: true });
  await writeFile(
    path.join(root, "article.md"),
    "---\nproject: t\nlanguage: zh-CN\nduration_target_sec: 30\nvoice: narrator-zh\n---\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "l10n", "en-US", "article.md"),
    "---\nproject: t\nlanguage: en-US\nduration_target_sec: 30\nvoice: en-US-ChristopherNeural\n---\n\n## Scenes\n\n```yaml\nscenes: []\n```\n",
    "utf8",
  );
  return root;
}

describe("l10nRootOrThrow", () => {
  it("resolves the l10n workdir when the translated article exists", async () => {
    const root = await makeProject();
    try {
      expect(l10nRootOrThrow(root, "en-US")).toBe(
        path.join(root, "l10n", "en-US"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("errors with the translate hint when the workdir is missing", async () => {
    const root = await makeProject();
    try {
      expect(() => l10nRootOrThrow(root, "zh-CN")).toThrow(
        /video translate/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runTranslate", () => {
  it("rejects unsupported languages before touching the project", async () => {
    const code = await runTranslate({
      project: "whatever",
      lang: "fr-FR",
    });
    expect(code).toBe(1);
  });
});
