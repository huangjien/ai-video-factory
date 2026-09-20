#!/usr/bin/env node
import { Command } from "commander";
import { runValidate } from "./validate-command.js";

const program = new Command();

program.name("vf").description("AI Video Factory CLI (v0.1)").version("0.1.0");

program
  .command("validate")
  .description(
    "validate a storyboard.yaml (VDSL 0.1) against the full rule set",
  )
  .argument("<file>", "path to storyboard.yaml")
  .option("--root <dir>", "project root for resolving assets")
  .action(async (file: string, opts: { root?: string }) => {
    process.exitCode = await runValidate(file, opts.root);
  });

await program.parseAsync(process.argv);
