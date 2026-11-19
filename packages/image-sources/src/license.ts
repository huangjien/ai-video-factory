/**
 * License policy for borrowed pictures.
 *
 * The rule is deliberately strict: a picture enters the pipeline only when
 * it is in the public domain or CC0/PDM. "Attribution required" licenses
 * (CC-BY, CC-BY-SA) are NOT accepted by default — the point of the feature
 * is that the video can ship without a rights problem, and a license that
 * obliges a credit line is a credit line nobody maintains.
 *
 * The codes come from three vocabularies and have to be mapped onto one:
 *  - Wikimedia `extmetadata.License`  → "pd-old-100", "cc0", "cc-by-4.0"
 *  - Wikimedia `extmetadata.LicenseShortName` → "Public domain", "CC0"
 *  - Openverse `license` → "cc0", "pdm", "by", "by-sa"
 *  - The Met marks public-domain objects with a boolean, not a code.
 */

/** Normalized codes that mean "no third-party rights". */
export const FREE_LICENSES = ["PD", "CC0", "PDM"] as const;

/** Project-owned art (AI-generated scenes, character sheets). Not a
 *  third-party license — it means "we made this". */
export const OWNED_LICENSE = "OWNED";

/**
 * Map any license vocabulary onto one normalized code.
 * Returns "" for an unknown/empty value — the caller treats that as
 * "not free".
 */
export function normalizeLicense(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "") return "";
  // CC0 first: "cc0" would otherwise fall through to the generic branch.
  if (s.startsWith("cc0")) return "CC0";
  // "public domain mark" is PDM, and it CONTAINS "public domain" — so it
  // has to be checked before the PD branch.
  if (s.startsWith("pdm") || s.includes("public domain mark")) return "PDM";
  if (s.startsWith("pd") || s.includes("public domain")) return "PD";
  if (s.startsWith("publicdomain")) return "PD";
  return s.toUpperCase();
}

/** True when the license lets the video ship without attribution duties. */
export function isFreeLicense(
  raw: string,
  allow: readonly string[] = FREE_LICENSES,
): boolean {
  const code = normalizeLicense(raw);
  return code !== "" && allow.includes(code);
}
