import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  anchorPromptLines,
  characterRootFor,
  loadCharacterById,
  type ParsedArticle,
} from "@video/draft";

export function resolveSceneCast(
  projectRoot: string,
  article: ParsedArticle,
  index: number,
) {
  const cast = article.frontmatter.cast;
  const scene = article.scenes[index]!;
  if (cast === undefined || !scene.characters?.length) return null;
  const root = characterRootFor(projectRoot);
  if (root === null)
    throw new Error("cast requires the workspace character library");
  const entries = scene.characters.map(({ id, variant }) => {
    const binding = Object.hasOwn(cast, id) ? cast[id] : undefined;
    if (!binding) throw new Error(`${scene.id}: unknown cast role "${id}"`);
    const profile = loadCharacterById(root, binding.asset);
    const ref = profile?.references.find(
      ({ style, version }) => `${style}/${version}` === binding.reference,
    );
    if (!profile || !ref) {
      throw new Error(
        `${scene.id}: missing cast reference ${binding.asset}/${binding.reference}`,
      );
    }
    const directory = path.join(root, binding.asset);
    const file = path.resolve(directory, ref.file);
    if (!file.startsWith(directory + path.sep))
      throw new Error(`Invalid cast reference path: ${ref.file}`);
    const extension = path.extname(file).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(extension))
      throw new Error(`Unsupported cast reference: ${ref.file}`);
    const bytes = readFileSync(file);
    const anchors = anchorPromptLines(profile, variant);
    return {
      identity: {
        id,
        variant: variant ?? "",
        name: binding.name,
        anchorLines: binding.wardrobe
          ? [
              ...anchors.filter((line) => !line.startsWith("costume:")),
              `costume: ${binding.wardrobe}`,
            ]
          : anchors,
      },
      reference: {
        base64: bytes.toString("base64"),
        contentType: extension === ".png" ? "image/png" : "image/jpeg",
      },
      asset: binding.asset,
      version: binding.reference,
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  return {
    identities: entries.map((entry) => entry.identity),
    references: entries.map((entry) => entry.reference),
    digest: createHash("sha256")
      .update(
        JSON.stringify(
          entries.map(({ identity, asset, version, hash }) => [
            identity,
            asset,
            version,
            hash,
          ]),
        ),
      )
      .digest("hex"),
  };
}
