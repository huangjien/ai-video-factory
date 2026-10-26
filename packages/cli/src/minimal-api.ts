import { DEFAULT_THEME_NAME, THEME_NAMES } from "@video/theme";

/** One row of the README "Minimal API (recommended)" table. */
export interface MinimalApiCommand {
  invocation: string;
  purpose: string;
}

/** The recommended path — single source for the README minimal-API table.
 *  Regenerate the docs with `pnpm run docs:commands`. */
export const MINIMAL_API_COMMANDS: readonly MinimalApiCommand[] = [
  {
    invocation: "video new <id>",
    purpose: "scaffold a project under `projects/<id>/`",
  },
  {
    invocation: "video draft <topic>",
    purpose:
      "write `article.md` + `audio-config.yaml` from a topic via MiniMax/GLM (research + script + storyboard + audio plan in one; `--no-audio-plan` to split; `--file <path>` to seed with your raw idea, opinions preserved; **v0.4** `--style <theme>` writes storyboard theme; **v0.4** `--no-captions` skips the caption overlay)",
  },
  {
    invocation: "video audio-plan <project>",
    purpose:
      "(optional) regenerate `audio-config.yaml` after hand-editing article.md",
  },
  {
    invocation: "video make <project>",
    purpose:
      "TTS → audio assets → render → mix (`--dry-run` for a read-only impact table of what would re-run, `--fake` for offline TTS, `--image-provider mock\\|minimax\\|openai\\|gemini\\|none`, `--bgm-dir`/`--sfx-dir <dir>` to use your own music library; **v0.8** scene images are content-keyed so visual edits regenerate)",
  },
  {
    invocation: "video visuals <project>",
    purpose:
      "**v0.8** (optional) generate scene images + a Pillow contact sheet for review; `video approve visuals <project>` freezes the set and `video make` enforces it when `require_visual_approval: true` is set in article.md frontmatter",
  },
  {
    invocation: "video retrospect <project>",
    purpose:
      "**v0.4** ask the LLM for 3 concrete edits to `article.md` based on the latest runs + QA report (writes `projects/<slug>/retrospect.md`); `--dry-run` shows the input without calling the LLM",
  },
  {
    invocation: "video status <project>",
    purpose:
      "shows current workflow checkpoint + **v0.4** the latest QA finding count next to the gate",
  },
  {
    invocation: "video theme [name] / --cwd <root>",
    purpose:
      "**v0.4** palette inspector — list every theme, print one theme's full token set, or resolve `style.theme` from a project's storyboard",
  },
  {
    invocation: "video character list / sheet / approve",
    purpose:
      "manage the 角色圣经 (character bible) shared across films at `<workspace>/assets/characters/` — `list` every character, `sheet <id> <style>` generate a candidate reference sheet (`--provider mock` for offline), `approve <id> <style> <version> --by <name>` promote a candidate to the 正式角色参考 for its art style",
  },
  {
    invocation: "video prompts / show <name> / path / eval",
    purpose:
      "**v0.8** inspect the central prompt registry — every LLM prompt body lives as an editable file under `packages/prompts/prompts/`; list them, print one, or get the directory. **v0.10** `eval` runs the golden set in `packages/prompts/evals/` (structural by default, CI-safe; `--judge <provider>` adds the LLM rubric layer)",
  },
];

/** Verbs wired for back-compat but outside the recommended path — shown in
 *  the banner's "Advanced verbs" line and the README back-compat paragraph. */
export const ADVANCED_VERBS: readonly string[] = [
  // Everything wired in the CLI that the four-command path doesn't cover.
  // audio-plan and theme are ALSO reachable as recommended-path steps, so
  // they stay off this "back-compat" list (they used to appear in both).
  "research",
  "script",
  "storyboard",
  "motion",
  "audio",
  "audio-asset",
  "mix",
  "thumbnail",
  "shorts",
  "youtube",
  "bilibili",
  "studio",
  "qa",
  "review",
  "validate",
  "scene",
  "learn",
  "prompts",
  "character",
];

/** Human gates documented in the README table. "visuals" is opt-in
 *  (require_visual_approval in article.md); the workflow stage machine is
 *  untouched (v0.8 plan D1). */
export const APPROVAL_STAGES: readonly string[] = [
  "storyboard",
  "review",
  "visuals (opt-in, v0.8)",
];

function wrapWords(
  text: string,
  maxWidth: number,
  continuationIndent = 0,
): string[] {
  const indent = " ".repeat(continuationIndent);
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    const width = (lines.length === 0 ? 0 : indent.length) + candidate.length;
    if (current !== "" && width > maxWidth) {
      lines.push((lines.length === 0 ? "" : indent) + current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push((lines.length === 0 ? "" : indent) + current);
  return lines;
}

const BANNER_CORE_STEPS: readonly {
  cmd: string;
  desc: string;
  cont?: string[];
}[] = [
  { cmd: "video new <topic>", desc: "scaffold projects/<topic>/" },
  {
    cmd: "video draft <topic>",
    desc: "write article.md + audio-config.yaml",
    cont: [
      "(--no-web, --style, --file, --no-review,",
      " --min-score, --max-attempts, --judge-model)",
    ],
  },
  {
    cmd: "video approve storyboard",
    desc: "human gate (one of the two checkpoints)",
  },
  { cmd: "video make <topic>", desc: "render → projects/<topic>/output/" },
];

/** Build the `video --help` banner from the same data the docs are generated
 *  from (`pnpm run docs:commands`), so banner and docs cannot drift. */
export function buildBanner(version: string): string {
  const rule = "─".repeat(49);
  const lines: string[] = [
    `A I   V I D E O   F A C T O R Y   ·   v${version}`,
    rule,
    "▷ Turn a topic into a finished 1080p MP4 (zh-CN / en-US) in four commands.",
    "",
  ];
  for (const step of BANNER_CORE_STEPS) {
    lines.push(`  ${step.cmd.padEnd(30)}${step.desc}`);
    for (const c of step.cont ?? []) lines.push(`  ${" ".repeat(30)}${c}`);
  }
  lines.push(
    "",
    "  Edit article.md and audio-config.yaml between draft and make.",
    "  Run `video status <topic>` any time to see where you are.",
    "",
  );
  const themeOrder = [...THEME_NAMES].sort((a, b) =>
    a === DEFAULT_THEME_NAME ? -1 : b === DEFAULT_THEME_NAME ? 1 : 0,
  );
  lines.push(
    ...wrapWords(
      `  Theme presets: ${themeOrder.join(" · ")}`,
      78,
      "  Theme presets: ".length,
    ),
    "",
  );

  const advanced = `Advanced verbs (${ADVANCED_VERBS.join(", ")} …) are wired for back-compat but not part of the recommended path.`;
  lines.push(...wrapWords(advanced, 78), rule);
  return lines.join("\n");
}
