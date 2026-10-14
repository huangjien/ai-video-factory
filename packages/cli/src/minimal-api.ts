import {
  DEFAULT_THEME_NAME,
  THEME_NAMES,
} from "@video/video-components";

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
    purpose: "(optional) regenerate `audio-config.yaml` after hand-editing article.md",
  },
  {
    invocation: "video make <project>",
    purpose:
      "TTS → audio assets → render → mix (`--dry-run` to preview, `--fake` for offline TTS, `--image-provider mock\\|minimax\\|flux\\|none`, `--bgm-dir`/`--sfx-dir <dir>` to use your own music library)",
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
];

/** Verbs wired for back-compat but outside the recommended path — shown in
 *  the banner's "Advanced verbs" line and the README back-compat paragraph. */
export const ADVANCED_VERBS: readonly string[] = [
  "research",
  "storyboard",
  "motion",
  "audio",
  "audio-plan",
  "mix",
  "thumbnail",
  "shorts",
  "youtube",
  "theme",
  "qa",
  "review",
  "validate",
  "scene",
];

function wrapWords(text: string, maxWidth: number, continuationIndent = 0): string[] {
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

const BANNER_CORE_STEPS: readonly { cmd: string; desc: string; cont?: string[] }[] = [
  { cmd: "video new <topic>", desc: "scaffold projects/<topic>/" },
  {
    cmd: "video draft <topic>",
    desc: "write article.md + audio-config.yaml",
    cont: [
      "(--no-web, --style, --no-captions, --file,",
      " --no-review, --min-score, --max-attempts)",
    ],
  },
  { cmd: "video approve storyboard", desc: "human gate (one of the two checkpoints)" },
  { cmd: "video make <topic>", desc: "render → projects/<topic>/output/" },
];

/** Build the `video --help` banner from the same data the docs are generated
 *  from (`pnpm run docs:commands`), so banner and docs cannot drift. */
export function buildBanner(version: string): string {
  const rule = "─".repeat(49);
  const lines: string[] = [
    `A I   V I D E O   F A C T O R Y   ·   v${version}`,
    rule,
    "▷ Turn a topic into a finished 1080p Chinese MP4 in four commands.",
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
