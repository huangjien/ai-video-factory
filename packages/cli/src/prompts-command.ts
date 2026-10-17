import type { Command } from "commander";
import path from "node:path";
import {
  listPromptFiles,
  loadPrompt,
  promptFilePath,
  readPromptFile,
} from "@video/prompts";
import { runPromptEvals } from "./prompt-evals.js";

/**
 * `video prompts` — inspect the central prompt registry (@video/prompts).
 *
 * Every LLM/Laya prompt body in the pipeline lives as a file under
 * packages/prompts/prompts/. Edit a file there and the next run picks it
 * up — no code change needed (placeholders like {{script_sections}} are
 * filled by the owning package at load time).
 *
 *   video prompts               list prompt files (name + first line + bytes)
 *   video prompts show <name>   print one prompt body (stem or file name)
 *   video prompts path          print the registry directory
 *   video prompts eval          run the golden set (layer 1 structural, CI-safe;
 *                               --judge adds the layer 2 rubric)
 */
export function registerPrompts(program: Command): void {
  const cmd = program
    .command("prompts")
    .description("Inspect the central prompt registry (@video/prompts)")
    .action(() => {
      const files = listPromptFiles();
      for (const file of files) {
        const body = readPromptFile(file);
        const firstLine =
          body
            .split("\n")
            .find((l) => l.trim().length > 0)
            ?.trim() ?? "";
        const preview =
          firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
        console.log(
          `${file.padEnd(28)} ${String(Buffer.byteLength(body, "utf8")).padStart(6)} B  ${preview}`,
        );
      }
      console.log(
        `\n${files.length} prompts — edit under ${path.dirname(promptFilePath("x"))}`,
      );
    });

  cmd
    .command("show <name>")
    .description("print one prompt body (e.g. `show storyboard`)")
    .action((name: string) => {
      try {
        const file = name.includes(".") ? name : `${name}.md`;
        const body = file.endsWith(".md")
          ? loadPrompt(file.slice(0, -3))
          : readPromptFile(file);
        console.log(body);
      } catch {
        console.error(
          `unknown prompt: ${name} — run \`video prompts\` to list the registry`,
        );
        process.exitCode = 1;
      }
    });

  cmd
    .command("path")
    .description("print the prompt registry directory")
    .action(() => {
      console.log(path.dirname(promptFilePath("x")));
    });

  cmd
    .command("eval")
    .description(
      "run the prompt golden set (structural by default; --judge adds the LLM rubric layer)",
    )
    .option("--agent <name>", "only evaluate this agent (draft, storyboard)")
    .option("--case <id>", "only evaluate this case id")
    .option(
      "--judge <provider>",
      "run layer 2: generate + score against the rubric with this provider (glm|minimax)",
    )
    .option("--offline", "structural layer only — never call a provider")
    .option(
      "--update-snapshots",
      "rewrite each case's envelope snapshot from the current buildMessages output",
    )
    .option(
      "--update-recorded",
      "rewrite each fixture's recorded: block from this run (a new baseline)",
    )
    .action(async (options: Record<string, string | boolean>) => {
      process.exitCode = await runPromptEvals({
        ...(typeof options["agent"] === "string"
          ? { agent: options["agent"] }
          : {}),
        ...(typeof options["case"] === "string"
          ? { caseId: options["case"] }
          : {}),
        ...(typeof options["judge"] === "string"
          ? { judge: options["judge"] }
          : {}),
        offline: options["offline"] === true,
        updateRecorded: options["updateRecorded"] === true,
        updateSnapshots: options["updateSnapshots"] === true,
      });
    });
}
