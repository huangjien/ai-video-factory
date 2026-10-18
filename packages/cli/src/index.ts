#!/usr/bin/env node
import { Command } from "commander";
import { registerNew } from "./new-command.js";
import { registerMix } from "./mix-command.js";
import { registerResearch } from "./research-command.js";
import { registerDraft } from "./draft-command.js";
import { registerAudioPlan } from "./audio-plan-command.js";
import { registerMake } from "./make-command.js";
import { registerScript } from "./script-command.js";
import { registerStoryboard } from "./storyboard-command.js";
import { registerMotion } from "./motion-command.js";
import { registerExcalidraw } from "./excalidraw-command.js";
import { registerAudio } from "./audio-command.js";
import { registerAudioAsset } from "./audio-asset-command.js";
import { registerReview } from "./review-command.js";
import { registerYouTube } from "./youtube-command.js";
import { registerBilibili } from "./bilibili-command.js";
import { registerThumbnail } from "./thumbnail-command.js";
import { registerShorts } from "./shorts-command.js";
import { registerValidate } from "./validate-command.js";
import { registerStatus } from "./status-command.js";
import { registerTheme } from "./theme-command.js";
import { registerWorkflow } from "./workflow-commands.js";
import { registerVisuals } from "./visuals-command.js";
import { registerPreview } from "./render-command.js";
import { registerQa } from "./qa-command.js";
import { registerStudio } from "./studio-command.js";
import { registerScene } from "./scene-command.js";
import { registerFinal } from "./render-command.js";
import { registerRetrospect } from "./retrospect-command.js";
import { registerLaya } from "./laya-command.js";
import { registerLearn } from "./learn-command.js";
import { registerPrompts } from "./prompts-command.js";
import { buildBanner } from "./minimal-api.js";
import { VERSION } from "./version.js";

export { VERSION };
const program = new Command();

program
  .name("video")
  .description("AI Video Factory — turn a topic into a finished 1080p MP4.")
  .version(VERSION);

/** Banner + README/doc tables are generated from minimal-api.ts + theme.ts
 *  (single source) — run `pnpm run docs:commands` after adding a verb or
 *  theme; never hand-edit the docs' generated sections. */
const shortVersion = VERSION.split(".").slice(0, 2).join(".");
program.addHelpText("before", buildBanner(shortVersion));

// Registration order is the --help verb order. Each verb's flags and
// action live next to its runner in *-command.ts.
for (const register of [
  registerNew,
  registerMix,
  registerResearch,
  registerDraft,
  registerAudioPlan,
  registerMake,
  registerScript,
  registerStoryboard,
  registerMotion,
  registerExcalidraw,
  registerAudio,
  registerAudioAsset,
  registerReview,
  registerYouTube,
  registerBilibili,
  registerThumbnail,
  registerShorts,
  registerValidate,
  registerStatus,
  registerTheme,
  registerWorkflow,
  registerVisuals,
  registerPreview,
  registerQa,
  registerStudio,
  registerScene,
  registerFinal,
  registerRetrospect,
  registerLaya,
  registerLearn,
  registerPrompts,
]) {
  register(program);
}

// When invoked with no args, print the banner + verb list (Commander
// would otherwise silently exit 0 and the user sees nothing).
if (process.argv.length <= 2) {
  program.help({ error: false });
}

await program.parseAsync(process.argv);
