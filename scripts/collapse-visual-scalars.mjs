/**
 * Collapse each scene's `visual:` YAML scalar onto ONE physical line,
 * preserving the parsed value byte-for-byte.
 *
 * Why: an LLM that re-emits an article wraps long plain scalars at a
 * space ("…; list" + "keyword, top-down"). The wrapped tail is part of
 * the VALUE (YAML folds continuation lines), so the visual string — and
 * with it the image cache key — silently carries the fragment. Collapsing
 * keeps the value identical (no cache invalidation, no image re-spend)
 * and makes the source editable: a later hand-edit of the visual line can
 * no longer leave a folded tail behind.
 *
 * Usage: node scripts/collapse-visual-scalars.mjs <article.md>
 */
import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";

const file = process.argv[2];
const md = readFileSync(file, "utf8");

const fence = /```(?:yaml)?\s*\n([\s\S]*?)\n```/.exec(md);
if (!fence || fence.index === undefined) {
  console.error("no YAML fence found");
  process.exit(1);
}
const block = fence[1];
const blockStart = md.indexOf(block, fence.index);

const doc = YAML.parseDocument(block);
const items = doc.get("scenes")?.items ?? [];

const edits = [];
items.forEach((item) => {
  const node = item?.get?.("visual", true);
  if (!node?.range) return;
  const [start, valueEnd] = node.range;
  const span = block.slice(start, valueEnd);
  if (!span.includes("\n")) return; // already one line
  const value = node.value;
  // Prefer a plain scalar, but only when it parses back identically.
  const probe = YAML.parseDocument(`visual: ${value}\n`);
  const text =
    probe.get("visual", true)?.value === value
      ? value
      : JSON.stringify(value);
  edits.push({ start, end: valueEnd, text, id: item.get("id", true)?.value });
});

if (edits.length === 0) {
  console.log("no wrapped visual scalars — nothing to do");
  process.exit(0);
}

let out = block;
for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
  out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
}
writeFileSync(file, md.slice(0, blockStart) + out + md.slice(blockStart + block.length), "utf8");

// Prove the values did not move.
const after = YAML.parseDocument(out).get("scenes").items;
const beforeValues = items.map((it) => it.get("visual", true)?.value);
const afterValues = after.map((it) => it.get("visual", true)?.value);
const same = beforeValues.every((v, i) => v === afterValues[i]);
console.log(`collapsed ${edits.length} visual scalar(s): ${edits.map((e) => e.id).join(", ")}`);
console.log(`parsed values unchanged: ${same ? "YES" : "NO — cache keys would shift"}`);
process.exit(same ? 0 : 1);
