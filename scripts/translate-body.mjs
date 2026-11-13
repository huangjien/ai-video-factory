/**
 * Translate the article's PROSE BODY (sections §1–§10) into the target
 * language and splice it into the translated article.
 *
 * Why: `video translate` asks the model for the full article, but the
 * MiniMax pass returned only the `## Scenes` block — the prose sections
 * were dropped, which leaves the sources scene (a Checklist component that
 * reads its items from the section body) with nothing to render. GLM, which
 * did include the body on the first run, is rate-limited.
 *
 * The body is translated ONE SECTION PER REQUEST: a single request for the
 * whole body came back as a 176-char summary instead of a translation.
 * A length check per section catches that and retries.
 *
 * The scene block is NOT touched here: `video translate` already produced
 * it, and the `visual:` lines are machine-consumed contracts whose content
 * hash decides image reuse.
 *
 * Usage: node scripts/translate-body.mjs <project-dir> <lang>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [projectDir, lang] = process.argv.slice(2);
if (!projectDir || !lang) {
  console.error("usage: node scripts/translate-body.mjs <project-dir> <lang>");
  process.exit(2);
}

const repo = path.resolve(import.meta.dirname, "..");
const llm = await import(
  pathToFileURL(path.join(repo, "packages/llm/dist/index.js")).href
);
const draft = await import(
  pathToFileURL(path.join(repo, "packages/draft/dist/index.js")).href
);

const canonicalMd = readFileSync(path.join(projectDir, "article.md"), "utf8");
const canonical = draft.parseArticleLenient(canonicalMd);
const body = canonical.proseBody;
if (!body || body.trim() === "") {
  console.error("canonical article has no prose body");
  process.exit(1);
}

// split into sections on "## " headings
const sections = [];
let cur = { heading: "", lines: [] };
for (const line of body.split("\n")) {
  if (line.startsWith("## ")) {
    if (cur.heading || cur.lines.join("").trim()) sections.push(cur);
    cur = { heading: line, lines: [] };
  } else {
    cur.lines.push(line);
  }
}
if (cur.heading || cur.lines.join("").trim()) sections.push(cur);
console.log(`body: ${sections.length} section(s), ${body.length} chars`);

const provider = new llm.MiniMaxProvider();

function systemPrompt() {
  return `You are a professional translator working on a video-essay article.
Translate the user's Chinese article section into ${lang}.

Rules:
- Output ONLY the translation. No preamble, no commentary, no markdown fences.
- Keep the section heading, translated, with the same numbering ("## 1. ..." etc.).
- Keep bracketed citation markers like ［1］ ［2］ exactly as they appear.
- In "- ［1］ ..." bullet lists, keep ［n］ and any URL/DOI intact; translate the label text.
- Keep technical terms with no clean English equivalent in their original form.
- Natural, readable essay prose — not a literal gloss.
- Your output MUST be roughly as long as the input. Never summarize, never
  condense, never drop a paragraph or a bullet.`;
}

async function translateSection(sec) {
  const src = [sec.heading, ...sec.lines].join("\n").trim();
  if (!src) return "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const out = await provider.chat({
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: src },
      ],
      temperature: 0.3,
    });
    let text = llm.stripReasoning(out.content).trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
    }
    // A translation is not a summary: reject a reply much SHORTER than the
    // source (content was dropped) or wildly longer (padding / repetition
    // loop). Chinese → English legitimately expands ~2.5-4x, so the band is
    // 0.8x - 5.0x; a 10x reply is a loop, not a translation.
    const floor = src.length * 0.8;
    const ceiling = Math.max(src.length * 5.0, 800);
    if (text.length >= floor && text.length <= ceiling) return text;
    console.error(
      `  attempt ${attempt}: reply out of band (${text.length} vs ${src.length}) — retrying`,
    );
    console.error(
      `  attempt ${attempt}: reply too short (${text.length} vs ${src.length}) — retrying`,
    );
  }
  throw new Error(`section failed to translate: ${sec.heading.slice(0, 30)}`);
}

const translatedSections = [];
for (const sec of sections) {
  const src = [sec.heading, ...sec.lines].join("\n").trim();
  const out = await translateSection(sec);
  // The preamble chunk has no heading in the source; the model likes to
  // invent one, so drop it.
  // The reasoning stripper runs on the RAW reply; a leftover <think> block
  // here would end up in the article body.
  const clean = llm.stripReasoning(out).trim();
  if (clean.includes("<think>")) {
    throw new Error(`reasoning leaked into section: ${sec.heading.slice(0, 30)}`);
  }
  console.log(
    `  ${sec.heading.slice(0, 28).padEnd(30)} ${src.length} → ${clean.length}`,
  );
  translatedSections.push(clean);
}
const translated = translatedSections.join("\n\n").trim();

const targetFile = path.join(projectDir, "l10n", lang, "article.md");
const translatedMd = readFileSync(targetFile, "utf8");
const scenesAt = translatedMd.indexOf("## Scenes");
if (scenesAt === -1) {
  console.error("no ## Scenes in translated article");
  process.exit(1);
}
const head = translatedMd.slice(0, scenesAt);
const rest = translatedMd.slice(scenesAt);
writeFileSync(targetFile, `${head}${translated}\n\n${rest}`, "utf8");
console.log(
  `prose body translated: ${body.length} → ${translated.length} chars → ${targetFile}`,
);
