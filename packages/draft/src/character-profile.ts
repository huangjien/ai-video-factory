import { z } from "zod";

/**
 * Character bible (CS-11).
 *
 * Cross-video character identity, kept in ONE place so a face does not
 * drift between films. Two deliberate separations:
 *
 *  - **Identity is separate from the art.** `anchors` describe the
 *    person; `references` are per-art-style and versioned. The same
 *    identity holds when the channel switches to a different style, which
 *    is exactly what CS-02's per-film `image_style` requires.
 *
 *  - **Provenance is a required field, not prose.** Every anchor is
 *    `sourced` (a source is named) or `inferred` (an art choice). That
 *    makes CS-11's acceptance criterion — "you can tell what is sourced
 *    and what is an art choice without reading a conversation" —
 *    machine-checkable instead of a promise in a README.
 *
 * Reference images are a VERSIONED LIST, never a single "current" file, so
 * a superseded drawing stays on disk and stays traceable. Only a
 * `candidate` that a human moved to `approved` counts as an official
 * asset; nothing downstream may read a candidate as if it were approved.
 */

/** Why an anchor reads the way it does. `sourced` MUST name a source. */
export const ANCHOR_BASIS = ["sourced", "inferred"] as const;

export const REFERENCE_STATUS = [
  "candidate",
  "approved",
  "superseded",
] as const;

const AnchoredValueSchema = z
  .object({
    // A list is allowed for anchors that are naturally several items —
    // signature props, costume pieces. Flattening those into one string
    // would be lossy and ugly to read back in a prompt.
    value: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    basis: z.enum(ANCHOR_BASIS),
    /** Required when basis is "sourced" — enforced below. */
    source: z.string().min(1).optional(),
    /** Why this art choice was made, when the answer is not historical. */
    note: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.basis === "sourced" && v.source === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message:
          'basis "sourced" must name a source; use basis "inferred" for an art choice',
      });
    }
  });

export type AnchoredValue = z.infer<typeof AnchoredValueSchema>;

const ReferenceSchema = z
  .object({
    /** Art style this drawing belongs to (matches an image_style preset). */
    style: z.string().min(1),
    /** Monotonic per style — v1, v2, … Never reused, never overwritten. */
    version: z.string().min(1),
    status: z.enum(REFERENCE_STATUS),
    /** Path relative to the character's directory. */
    file: z.string().min(1),
    /** Human reviewer. Required once approved — that is what "人工批准" means. */
    reviewedBy: z.string().min(1).optional(),
    reviewedAt: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.status === "approved" &&
      (v.reviewedBy === undefined || v.reviewedAt === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewedBy"],
        message: "an approved reference must record reviewedBy and reviewedAt",
      });
    }
  });

export type CharacterReference = z.infer<typeof ReferenceSchema>;

const VariantSchema = z
  .object({
    /** Stable id, `<character_id>__<slug>` — scenes reference this, not prose. */
    id: z.string().min(1),
    label: z.string().min(1),
    /** The period this variant depicts, e.g. "618-626 CE". */
    period: z.string().min(1).optional(),
    /**
     * Anchors that differ from the base identity. Age and rank change the
     * silhouette; they do not change who the person is, which is why the
     * base identity anchors are inherited rather than duplicated.
     */
    anchors: z.record(AnchoredValueSchema).default({}),
  })
  .strict();

export type CharacterVariant = z.infer<typeof VariantSchema>;

export const CharacterProfileSchema = z
  .object({
    schema: z.literal("character-profile/1"),
    /** Stable, machine-usable id — the key scenes and prompts cite. */
    id: z.string().min(1),
    name: z.string().min(1),
    identity: z
      .object({
        era_region: z.string().min(1),
        role: z.string().min(1).optional(),
      })
      .strict(),
    /**
     * The identity anchors a prompt must reproduce for the character to
     * read as the same person: face, silhouette, hair, build, costume,
     * signature props.
     */
    anchors: z.record(AnchoredValueSchema),
    variants: z.array(VariantSchema).default([]),
    references: z.array(ReferenceSchema).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    // At most one official reference per art style: two "approved" sheets
    // for one style means nothing downstream can say which one is canonical.
    const approvedByStyle = new Map<string, string>();
    for (const ref of v.references) {
      if (ref.status !== "approved") continue;
      const existing = approvedByStyle.get(ref.style);
      if (existing !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["references"],
          message: `style "${ref.style}" already has approved ${existing}; mark the older one superseded`,
        });
      } else {
        approvedByStyle.set(ref.style, ref.version);
      }
    }
    const variantIds = new Set<string>();
    for (const variant of v.variants) {
      if (variantIds.has(variant.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: `duplicate variant id: ${variant.id}`,
        });
      }
      variantIds.add(variant.id);
    }
  });

export type CharacterProfile = z.infer<typeof CharacterProfileSchema>;

/**
 * The official reference for one art style, or undefined when the style
 * has none. This is the ONLY way downstream code should resolve a
 * reference: a candidate must never be promoted by accident, which is
 * CS-11's third acceptance criterion.
 */
export function approvedReferenceFor(
  profile: CharacterProfile,
  style: string,
): CharacterReference | undefined {
  return profile.references.find(
    (r) => r.style === style && r.status === "approved",
  );
}

/**
 * Anchors for one variant: the base identity, overlaid with the variant's
 * own. Returns them in a stable order so a prompt reads the same way for
 * the same character every time.
 */
export function anchorsForVariant(
  profile: CharacterProfile,
  variantId?: string,
): Record<string, AnchoredValue> {
  const merged: Record<string, AnchoredValue> = { ...profile.anchors };
  if (variantId === undefined) return merged;
  const variant = profile.variants.find((v) => v.id === variantId);
  if (variant === undefined) {
    throw new Error(
      `character "${profile.id}" has no variant "${variantId}" (has: ${profile.variants.map((v) => v.id).join(", ") || "none"})`,
    );
  }
  for (const [key, value] of Object.entries(variant.anchors)) {
    merged[key] = value;
  }
  return merged;
}

/** One line per anchor, for splicing into an image prompt. */
export function anchorPromptLines(
  profile: CharacterProfile,
  variantId?: string,
): string[] {
  return Object.entries(anchorsForVariant(profile, variantId))
    .filter(([, v]) =>
      Array.isArray(v.value) ? v.value.length > 0 : v.value.trim() !== "",
    )
    .map(
      ([key, v]) =>
        `${key}: ${Array.isArray(v.value) ? v.value.join("; ") : v.value}`,
    );
}

/**
 * Promote a candidate reference to `approved` (CS-13).
 *
 * The previous approved sheet for that style is marked `superseded` in
 * the same pass — the schema allows only one approved reference per
 * style, and the older drawing stays on disk and in the list so the
 * history is traceable.
 *
 * Only a candidate can be promoted: an already-approved sheet is left
 * alone, and a superseded one is never resurrected.
 */
export function approveReference(
  profile: CharacterProfile,
  style: string,
  version: string,
  reviewer: string,
  reviewedAt: string = new Date().toISOString(),
): CharacterProfile {
  const target = profile.references.find(
    (r) => r.style === style && r.version === version,
  );
  if (target === undefined) {
    throw new Error(
      `character "${profile.id}" has no reference ${style}/${version}`,
    );
  }
  if (target.status === "approved") {
    throw new Error(`${style}/${version} is already approved — nothing to do`);
  }
  if (target.status === "superseded") {
    throw new Error(
      `${style}/${version} was superseded — approve a newer candidate instead`,
    );
  }
  const references = profile.references.map((r) => {
    if (r.style !== style) return r;
    // Everything else for this style is now superseded — the newly
    // approved sheet replaces it. The drawings stay on disk and in the
    // list, so the history is traceable; but leaving them as "candidate"
    // would falsely suggest they are still awaiting review.
    if (r.version === version) {
      return {
        ...r,
        status: "approved" as const,
        reviewedBy: reviewer,
        reviewedAt,
      };
    }
    return { ...r, status: "superseded" as const };
  });
  return CharacterProfileSchema.parse({ ...profile, references });
}
