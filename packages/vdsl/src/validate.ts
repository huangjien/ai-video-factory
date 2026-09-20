import type { VdslError } from "./errors.js";
import { lineOf, parseYaml } from "./parse.js";
import { storyboardSchema, type Storyboard } from "./schema.js";
export type ValidationResult =
  { ok: true; data: Storyboard } | { ok: false; errors: VdslError[] };

/**
 * Shape validation (doc §21.1 rules 924-931 that are checkable without a
 * registry or filesystem): required top-level keys, unique scene ids,
 * duration > 0, enum values, unknown-field rejection — every error carries
 * file/field/line. Asset-existence/registry/audio-duration rules live in the
 * project-level validator (todo 5).
 */
export function validateStoryboard(
  text: string,
  file: string,
): ValidationResult {
  const parsed = parseYaml(text);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => ({
        file,
        field: "(yaml)",
        line: e.line,
        message: e.message,
      })),
    };
  }

  const result = storyboardSchema.safeParse(parsed.data);
  if (!result.success) {
    const errors: VdslError[] = [];
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          const field = [...issue.path, key].join(".");
          errors.push({
            file,
            field,
            line: lineOf(parsed.doc, text, [...issue.path, key]),
            message: `Unknown field "${key}" — VDSL is strict; unknown keys are rejected (§21.1 line 931).`,
            fix: `Remove "${key}" or check the schema at schema_version 0.1.`,
          });
        }
        continue;
      }
      const field = issue.path.join(".");
      const astLine = lineOf(parsed.doc, text, issue.path);
      errors.push({
        file,
        field,
        // Missing keys have no AST node — point at the document start.
        line: astLine > 0 ? astLine : 1,
        message: issue.message,
        fix:
          issue.code === "invalid_type" && issue.received === "undefined"
            ? "This key is required by the VDSL 0.1 schema."
            : undefined,
      });
    }
    return { ok: false, errors };
  }

  // Unique scene ids (§21.1 line 927) — needs the AST for the SECOND line.
  const seen = new Map<string, number>();
  const dupErrors: VdslError[] = [];
  result.data.scenes.forEach((scene, i) => {
    const firstLine = seen.get(scene.id);
    if (firstLine !== undefined) {
      dupErrors.push({
        file,
        field: `scenes.${i}.id`,
        line: lineOf(parsed.doc, text, ["scenes", i, "id"]),
        message: `Duplicate scene id "${scene.id}" — scene ids must be unique within the project (§21.1 line 927).`,
        fix: `Rename this scene; first occurrence is at line ${firstLine}.`,
      });
    } else {
      seen.set(scene.id, lineOf(parsed.doc, text, ["scenes", i, "id"]) || 1);
    }
  });
  if (dupErrors.length > 0) return { ok: false, errors: dupErrors };

  return { ok: true, data: result.data };
}
