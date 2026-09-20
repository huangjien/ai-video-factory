import { parseDocument, type Document, type Node, type Pair } from "yaml";

/** Parse YAML keeping the AST for line mapping. Returns parser errors with
 * line numbers (never throws on bad YAML — doc §62.1: return readable errors). */
export type ParsedYaml =
  | { ok: true; doc: Document; data: unknown }
  | { ok: false; errors: { line: number; message: string }[] };

export function parseYaml(text: string): ParsedYaml {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((e) => ({
        line: e.linePos?.[0]?.line ?? 0,
        message: e.message.split("\n")[0] ?? e.message,
      })),
    };
  }
  return { ok: true, doc, data: doc.toJS({ maxAliasCount: -1 }) };
}

/** Resolve a dot/index path to the 1-based YAML line of the corresponding
 * value node by walking the CST (offset -> newline count). 0 = not found. */
export function lineOf(
  doc: Document,
  text: string,
  path: (string | number)[],
): number {
  let node: Node | null | undefined = doc.contents;
  for (const seg of path) {
    if (node === undefined || node === null) return 0;
    if (typeof seg === "number") {
      const items: unknown[] =
        (node as unknown as { items?: unknown[] }).items ?? [];
      node = items[seg] as Node | null | undefined;
    } else {
      const pairs: Pair<Node, Node>[] =
        (node as unknown as { items?: Pair<Node, Node>[] }).items ?? [];
      const pair: Pair<Node, Node> | undefined = pairs.find(
        (p) => String((p.key as { value?: unknown } | null)?.value) === seg,
      );
      node = pair?.value ?? null;
    }
  }
  const range = (node as unknown as { range?: [number, number, number] })
    ?.range;
  if (!range) return 0;
  return text.slice(0, range[0]).split("\n").length;
}
