/**
 * Can this URL be a FRAME?
 *
 * The pipeline normalizes every borrowed picture to JPEG and has no
 * rasterizer, so a vector file cannot be used. Wikimedia's own file for
 * the Mask of Tutankhamun is an SVG, and an archive that hands one over
 * is handing over a picture the pipeline will silently fail to use — the
 * scene then generates an image instead and the credit file claims a
 * picture that never reached the screen.
 *
 * Commons already filters with `filetype:bitmap`; the other archives do
 * not, so the check belongs here.
 */

/** True when the URL points at a raster image the pipeline can use. */
export function isRasterUrl(url: string): boolean {
  const path = url.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  return (
    !path.endsWith(".svg") &&
    !path.endsWith(".svgz") &&
    !path.endsWith(".tif") &&
    !path.endsWith(".tiff")
  );
}

/**
 * The best usable URL for a candidate: the original when it is a raster,
 * else the archive's rasterized preview, else null.
 *
 * `thumbnail` is the archive's own small JPEG. Whether it can be trusted
 * depends on the archive: Wikimedia rasterizes an SVG itself and serves
 * a reliable PNG thumb, while Openverse's thumbnail endpoint answers
 * `424 Failed Dependency` for exactly the vector files that need it. A
 * source that cannot rasterize says so with `trustThumbnail: false`, and
 * the candidate is skipped instead — the next candidate is a real one.
 */
export function rasterUrl(
  original: string | undefined,
  thumbnail: string | undefined,
  opts: { trustThumbnail?: boolean } = {},
): string | null {
  const o = (original ?? "").trim();
  const t = (thumbnail ?? "").trim();
  if (o !== "" && isRasterUrl(o)) return o;
  if (opts.trustThumbnail === true && t !== "" && isRasterUrl(t)) return t;
  return null;
}
