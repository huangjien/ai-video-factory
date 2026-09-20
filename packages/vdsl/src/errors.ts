/** Structured validation error carrying exact location (doc §21.1: errors must
 * name file, field and line so agents/humans can fix the YAML directly). */
export interface VdslError {
  file: string;
  /** Dot-path into the document, e.g. "scenes.2.duration" */
  field: string;
  /** 1-based YAML line; 0 when not resolvable (e.g. missing key). */
  line: number;
  message: string;
  fix?: string | undefined;
}

export function formatErrors(errors: VdslError[]): string {
  const rows = errors.map(
    (e) =>
      `  ${e.file}:${e.line || "?"}  ${e.field || "(root)"}\n    ${e.message}${e.fix ? `\n    fix: ${e.fix}` : ""}`,
  );
  return `VDSL validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):\n${rows.join("\n")}`;
}
