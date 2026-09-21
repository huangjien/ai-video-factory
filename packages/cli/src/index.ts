#!/usr/bin/env node
import { Command } from "commander";
import { runAudio } from "./audio-command.js";
import { runMix } from "./mix-command.js";
import { runNew } from "./new-command.js";
import { runResearch } from "./research-command.js";
import { runReview } from "./review-command.js";
import { runScript } from "./script-command.js";
import { runStoryboard } from "./storyboard-command.js";
import { runThumbnail } from "./thumbnail-command.js";
import { runShorts } from "./shorts-command.js";
import { runValidate } from "./validate-command.js";
import { runYouTube } from "./youtube-command.js";
import { runStatus } from "./status-command.js";
import {
  runApprove,
  runReject,
  runResume,
  runRollback,
} from "./workflow-commands.js";
import { runFinal, runPreview } from "./render-command.js";

const program = new Command();

program.name("vf").description("AI Video Factory CLI (v0.1)").version("0.1.0");

program
  .command("new")
  .argument("<project-id>", "project id (used as directory name)")
  .option("--cwd <dir>", "base directory for the project")
  .action(async (projectId: string, opts: { cwd?: string }) => {
    process.exitCode = await runNew({ projectId, cwd: opts.cwd });
  });

program
  .command("mix")
  .argument("<project>", "project id")
  .option("--cwd <dir>", "base directory for the project")
  .option("--bgm <path>", "explicit BGM file (default: first .wav in assets/audio-assets/bgm/ or bgm tag from audio-assets/mix.yaml)")
  .option(
    "--bgm-attenuation <db>",
    "BGM attenuation in dB while narration is silent (default -18)",
    (v) => Number.parseFloat(v),
  )
  .option(
    "--bgm-fade-in <sec>",
    "fade BGM in over N seconds (overrides mix.yaml)",
    (v) => Number.parseFloat(v),
  )
  .option(
    "--bgm-fade-out <sec>",
    "fade BGM out over last N seconds (overrides mix.yaml)",
    (v) => Number.parseFloat(v),
  )
  .option("--mix-yaml <path>", "explicit mix.yaml path (default: audio-assets/mix.yaml)")
  .action(
    async (
      project: string,
      opts: {
        cwd?: string;
        bgm?: string;
        bgmAttenuation?: number;
        bgmFadeIn?: number;
        bgmFadeOut?: number;
        mixYaml?: string;
      },
    ) => {
      process.exitCode = await runMix({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.bgm !== undefined ? { bgmPath: opts.bgm } : {}),
        ...(opts.bgmAttenuation !== undefined
          ? { bgmAttenuationDb: opts.bgmAttenuation }
          : {}),
        ...(opts.bgmFadeIn !== undefined ? { bgmFadeInSec: opts.bgmFadeIn } : {}),
        ...(opts.bgmFadeOut !== undefined ? { bgmFadeOutSec: opts.bgmFadeOut } : {}),
        ...(opts.mixYaml !== undefined ? { mixYamlPath: opts.mixYaml } : {}),
      });
    },
  );

program
  .command("research")
  .argument("<topic>", "topic to research")
  .option("--cwd <dir>", "base directory for the project")
  .option("--no-web", "disable MiniMax web search (use LLM knowledge only)")
  .option("--model <provider>", "model provider: minimax|glm (default from config)")
  .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
  .option("--duration <seconds>", "total duration target", (v) => parseInt(v, 10))
  .option("--audience <text>", "target audience (default: developers)")
  .action(
    async (
      topic: string,
      opts: {
        cwd?: string;
        web?: boolean;
        model?: "minimax" | "glm";
        lang?: "zh-CN" | "en-US";
        duration?: number;
        audience?: string;
      },
    ) => {
      process.exitCode = await runResearch({
        topic,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        noWeb: opts.web === false,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
        ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
      });
    },
  );

program
  .command("script")
  .argument("<topic>", "topic to write a script for")
  .option("--cwd <dir>", "base directory for the project")
  .option("--model <provider>", "model provider: minimax|glm (default from config)")
  .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
  .option("--duration <seconds>", "total duration target", (v) => parseInt(v, 10))
  .option("--audience <text>", "target audience (default: developers)")
  .option("--from-research <dir>", "consume approved research from this directory")
  .option("--direction <text>", "human-provided story direction; agent adapts structure but keeps 7 sections")
  .action(
    async (
      topic: string,
      opts: {
        cwd?: string;
        model?: "minimax" | "glm";
        lang?: "zh-CN" | "en-US";
        duration?: number;
        audience?: string;
        fromResearch?: string;
        direction?: string;
      },
    ) => {
      process.exitCode = await runScript({
        topic,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
        ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
        ...(opts.fromResearch !== undefined ? { fromResearch: opts.fromResearch } : {}),
        ...(opts.direction !== undefined ? { direction: opts.direction } : {}),
      });
    },
  );

program
  .command("storyboard")
  .argument("<topic>", "topic to draft a storyboard for")
  .option("--cwd <dir>", "base directory for the project")
  .option("--model <provider>", "model provider: minimax|glm (default from config)")
  .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
  .option("--duration <seconds>", "total duration target", (v) => parseInt(v, 10))
  .option("--audience <text>", "target audience (default: developers)")
  .option("--style <text>", "visual style (default: dark-tech)")
  .option("--from-research <dir>", "consume approved research from this directory")
  .option("--from-script <file>", "consume approved script from this file (e.g. script/script.zh-CN.md)")
  .action(
    async (
      topic: string,
      opts: {
        cwd?: string;
        model?: "minimax" | "glm";
        lang?: "zh-CN" | "en-US";
        duration?: number;
        audience?: string;
        style?: string;
        fromResearch?: string;
        fromScript?: string;
      },
    ) => {
      process.exitCode = await runStoryboard({
        topic,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.lang !== undefined ? { lang: opts.lang } : {}),
        ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
        ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
        ...(opts.style !== undefined ? { style: opts.style } : {}),
        ...(opts.fromResearch !== undefined ? { fromResearch: opts.fromResearch } : {}),
        ...(opts.fromScript !== undefined ? { fromScript: opts.fromScript } : {}),
      });
    },
  );

program
  .command("audio")
  .argument("<project>", "project id")
  .option("--cwd <dir>", "base directory for the project")
  .option("--fake", "use FakeTTSProvider (no network) for tests")
  .action(async (project: string, opts: { cwd?: string; fake?: boolean }) => {
    process.exitCode = await runAudio({
      project,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.fake !== undefined ? { fake: opts.fake } : {}),
    });
  });

program
  .command("audio-asset")

program
  .command("review")
  .argument("<project>", "project id to review")
  .option("--cwd <dir>", "base directory for the project")
  .option("--model <provider>", "model provider: minimax|glm (default: research-role config)")
  .action(async (project: string, opts: { cwd?: string; model?: "minimax" | "glm" }) => {
    process.exitCode = await runReview({
      project,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
  });

program
  .command("youtube")
  .argument("<project>", "project id to package for YouTube")
  .option("--cwd <dir>", "base directory for the project")
  .option("--model <provider>", "model provider: minimax|glm (default: review-role config)")
  .action(async (project: string, opts: { cwd?: string; model?: "minimax" | "glm" }) => {
    process.exitCode = await runYouTube({
      project,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
  });

program
  .command("thumbnail")
  .argument("<project>", "project id to generate a thumbnail for")
  .option("--cwd <dir>", "base directory for the project")
  .option("--width <px>", "thumbnail width (default 1280)", (v) => parseInt(v, 10))
  .option("--height <px>", "thumbnail height (default 720)", (v) => parseInt(v, 10))
  .option("--provider <name>", "image provider: mock|minimax (default mock — minimax needs MINIMAX_API_KEY)")
  .action(
    async (
      project: string,
      opts: {
        cwd?: string;
        width?: number;
        height?: number;
        provider?: "mock" | "minimax";
      },
    ) => {
      process.exitCode = await runThumbnail({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.width !== undefined ? { width: opts.width } : {}),
        ...(opts.height !== undefined ? { height: opts.height } : {}),
        ...(opts.provider !== undefined ? { providerName: opts.provider } : {}),
      });
    },
  );

program
  .command("shorts")
  .argument("<project>", "project id to clip a YouTube Short from")
  .option("--cwd <dir>", "base directory for the project")
  .option("--duration <seconds>", "short clip length in seconds (default: 60 for mock; 5 for minimax)", (v) => parseInt(v, 10))
  .option("--start <seconds>", "start offset into the final.mp4 (mock provider only, default 0)", (v) => parseInt(v, 10))
  .option("--provider <name>", "video provider: mock|minimax (default mock — minimax needs MINIMAX_API_KEY)")
  .action(
    async (
      project: string,
      opts: { cwd?: string; duration?: number; start?: number; provider?: "mock" | "minimax" },
    ) => {
      process.exitCode = await runShorts({
        project,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.duration !== undefined ? { durationSec: opts.duration } : {}),
        ...(opts.start !== undefined ? { startSec: opts.start } : {}),
        ...(opts.provider !== undefined ? { providerName: opts.provider } : {}),
      });
    },
  );

program
  .command("validate")
  .description("validate a storyboard.yaml (VDSL 0.1) against the full rule set")
  .argument("<file>", "path to storyboard.yaml")
  .option("--root <dir>", "project root for resolving assets")
  .action(async (file: string, opts: { root?: string }) => {
    process.exitCode = await runValidate(file, opts.root);
  });

program
  .command("status")
  .option("--cwd <dir>", "project root")
  .action(async (opts: { cwd?: string }) => {
    process.exitCode = await runStatus(opts.cwd);
  });

program
  .command("approve")
  .argument("[stage]", "stage to approve (defaults to current_stage)")
  .option("--cwd <dir>", "project root")
  .action(async (stage: string | undefined, opts: { cwd?: string }) => {
    process.exitCode = await runApprove(stage, opts.cwd);
  });

program
  .command("reject")
  .argument("<reason>", "reason code (e.g. wrong-content, wrong-pacing)")
  .option("--cwd <dir>", "project root")
  .action(async (reason: string, opts: { cwd?: string }) => {
    process.exitCode = await runReject(reason, opts.cwd);
  });

program
  .command("rollback")
  .argument("<checkpoint-id>", "checkpoint to roll back to")
  .option("--cwd <dir>", "project root")
  .action(async (id: string, opts: { cwd?: string }) => {
    process.exitCode = await runRollback(id, opts.cwd);
  });

program
  .command("resume")
  .option("--cwd <dir>", "project root")
  .action(async (opts: { cwd?: string }) => {
    process.exitCode = await runResume(opts.cwd);
  });

program
  .command("preview")
  .option("--cwd <dir>", "project root")
  .action(async (opts: { cwd?: string }) => {
    process.exitCode = await runPreview(opts.cwd);
  });

program
  .command("final")
  .option("--cwd <dir>", "project root")
  .option("--mix", "after rendering, run vf mix to produce final-mixed.mp4 with narration + BGM + SFX cues")
  .action(async (opts: { cwd?: string; mix?: boolean }) => {
    process.exitCode = await runFinal({
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.mix === true ? { mix: true } : {}),
    });
  });

await program.parseAsync(process.argv);
