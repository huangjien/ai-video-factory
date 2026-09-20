#!/usr/bin/env node
import { Command } from "commander";
import { runNew } from "./new-command.js";
import { runStoryboard } from "./storyboard-command.js";
import { runValidate } from "./validate-command.js";
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
  .command("storyboard")
  .argument("<topic>", "topic to draft a storyboard for")
  .option("--cwd <dir>", "base directory for the project")
  .option("--model <provider>", "model provider: minimax|glm (default from config)")
  .option("--lang <lang>", "language: zh-CN|en-US (default zh-CN)")
  .option("--duration <seconds>", "total duration target", (v) => parseInt(v, 10))
  .option("--audience <text>", "target audience (default: developers)")
  .option("--style <text>", "visual style (default: dark-tech)")
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
  .action(async (opts: { cwd?: string }) => {
    process.exitCode = await runFinal(opts.cwd);
  });

await program.parseAsync(process.argv);
