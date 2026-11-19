import { ArtifactPictureSource } from "./sources/artifacts.js";
import { CommonsPictureSource } from "./sources/commons.js";
import {
  MetPictureSource,
  OpenversePictureSource,
  SmithsonianPictureSource,
} from "./sources/museum.js";
import { WikipediaPictureSource } from "./sources/wikipedia.js";
import type { PictureSource } from "./types.js";

export interface DefaultPictureSourcesOptions {
  projectRoot: string;
  /** The workspace root (the dir that CONTAINS `projects/`), when the
   *  project lives under one. The character bible lives there. */
  workspaceRoot: string | null;
  /** Wikipedia language for article lookups. */
  lang?: string | undefined;
}

/**
 * The default source set, in the order they are consulted.
 *
 * Commons first — its license records are the most explicit. Wikipedia
 * second, for the lead image of the subject's article. The museums after
 * that. The project's own pictures last: they are useful, but an authentic
 * archive picture beats a re-generation of the same subject.
 */
export function defaultPictureSources(
  opts: DefaultPictureSourcesOptions,
): PictureSource[] {
  return [
    new CommonsPictureSource(),
    new WikipediaPictureSource(
      opts.lang !== undefined ? { lang: opts.lang } : {},
    ),
    new MetPictureSource(),
    new SmithsonianPictureSource(),
    new OpenversePictureSource(),
    new ArtifactPictureSource({
      projectRoot: opts.projectRoot,
      workspaceRoot: opts.workspaceRoot,
    }),
  ];
}
