import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command as RealCommand } from "commander";

import {
  DEFAULT_AUTO_LABEL,
  DEFAULT_HARVEST_LABEL,
  addScheduleCommand,
  plistContentFor,
  runBacklogSchedule,
} from "./backlog-schedule.js";

let fixtureRoot: string | undefined;
// Console capture so assertions can check user-facing messages.
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-schedule-"));
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

function fixturePlistDir(): string {
  return path.join(fixtureRoot as string, "LaunchAgents");
}
function fixtureLog(): string {
  return path.join(fixtureRoot as string, "runs", "harvest.log");
}
/** The built CLI entry the plist must run — a fixture stand-in. */
function fixtureDist(): string {
  const dist = path.join(fixtureRoot as string, "packages", "cli", "dist", "index.js");
  mkdirSync(path.dirname(dist), { recursive: true });
  writeFileSync(dist, "// fixture entry\n");
  return dist;
}

describe("plistContentFor", () => {
  const base = (command: string) => ({
    command,
    args: ["/repo/packages/cli/dist/index.js", "backlog", "harvest"],
    logPath: "/tmp/harvest.log",
  });

  it("is well-formed XML with the expected top-level shape", () => {
    const xml = plistContentFor("harvest", { ...base("/usr/local/bin/node"), label: "test.label" });
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain("<key>Label</key>");
    expect(xml).toContain("<string>test.label</string>");
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
    expect(xml.match(/<key>/g)?.length).toBe(xml.match(/<\/key>/g)?.length);
  });

  it("defaults the label per kind", () => {
    expect(plistContentFor("harvest", base("/node"))).toContain(
      `<string>${DEFAULT_HARVEST_LABEL}</string>`,
    );
    expect(plistContentFor("auto", base("/node"))).toContain(
      `<string>${DEFAULT_AUTO_LABEL}</string>`,
    );
  });

  it("sets ProgramArguments to [command, distEntry, backlog, verb]", () => {
    const xml = plistContentFor("harvest", base("/usr/local/bin/node"));
    const args = xml.slice(xml.indexOf("ProgramArguments"));
    expect(args).toContain("<string>/usr/local/bin/node</string>");
    expect(args).toContain("<string>/repo/packages/cli/dist/index.js</string>");
    expect(args.indexOf("backlog")).toBeLessThan(args.indexOf("harvest"));
  });

  it("schedules harvest weekly (Sunday 09:00) and auto nightly at 01:00/03:00/05:00", () => {
    const harvest = plistContentFor("harvest", base("/node"));
    expect(harvest).toContain("<key>Weekday</key>");
    expect(harvest).toContain("<integer>0</integer>"); // launchd: 0 = Sunday
    expect(harvest).toContain("<integer>9</integer>");

    const auto = plistContentFor("auto", base("/node"));
    expect(auto).toContain("<key>StartCalendarInterval</key>");
    expect(auto).toContain("<key>Hour</key>");
    const hours = [...auto.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/g)].map((m) => m[1]);
    expect(hours).toEqual(["1", "3", "5"]); // 2h spacing inside 01:00-05:00
  });

  it("sets WorkingDirectory so the CLI can find the repo from launchd's / cwd", () => {
    const xml = plistContentFor("harvest", { ...base("/node"), workingDir: "/repo" });
    expect(xml).toContain("<key>WorkingDirectory</key>");
    expect(xml).toContain("<string>/repo</string>");
  });

  it("forces headless mode and injects a usable PATH for children", () => {
    const xml = plistContentFor("harvest", { ...base("/node"), envPath: "/x:/usr/bin" });
    expect(xml).toContain("<key>VIDEO_ASK</key>");
    expect(xml).toContain("<string>off</string>");
    expect(xml).toContain("<key>PATH</key>");
    expect(xml).toContain("<string>/x:/usr/bin</string>");
  });

  it("defaults the child PATH to Homebrew + system dirs", () => {
    const xml = plistContentFor("auto", base("/node"));
    expect(xml).toContain("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  });

  it("routes stdout and stderr to the log path and does not run at load", () => {
    const xml = plistContentFor("harvest", { ...base("/node"), logPath: fixtureLog() });
    expect(xml.match(new RegExp(`<string>${fixtureLog().replaceAll("/", "\\/")}</string>`, "g"))?.length).toBe(2);
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<false/>");
  });

  it("escapes XML-special characters in paths", () => {
    const xml = plistContentFor("harvest", {
      command: "/opt/weird & path/node",
      args: ["/tmp/log<1>.js", "backlog", "harvest"],
      logPath: "/tmp/log<1>.txt",
    });
    expect(xml).toContain("/opt/weird &amp; path/node");
    expect(xml).toContain("/tmp/log&lt;1&gt;.js");
    expect(xml).toContain("/tmp/log&lt;1&gt;.txt");
  });
});

describe("runBacklogSchedule — validation", () => {
  it("rejects when no action flag is given", async () => {
    captureConsole();
    expect(await runBacklogSchedule({ plistDir: fixturePlistDir() })).toBe(1);
    expect(consoleErrors.join("\n")).toContain("exactly one");
  });

  it("rejects when more than one action flag is given", async () => {
    captureConsole();
    expect(
      await runBacklogSchedule({
        install: true,
        status: true,
        plistDir: fixturePlistDir(),
        distEntry: fixtureDist(),
        runLaunchctl: async () => 0,
      }),
    ).toBe(1);
    expect(consoleErrors.join("\n")).toContain("exactly one");
  });
});

describe("runBacklogSchedule — install", () => {
  function seamOpts() {
    return {
      plistDir: fixturePlistDir(),
      distEntry: fixtureDist(),
      runLaunchctl: async () => 0,
    };
  }

  it("writes a plist that runs node + dist directly and loads it via the seam", async () => {
    captureConsole();
    const dist = fixtureDist();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      plistDir: fixturePlistDir(),
      distEntry: dist,
      install: true,
      runLaunchctl: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    expect(code).toBe(0);
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`);
    expect(existsSync(plistPath)).toBe(true);
    const written = readFileSync(plistPath, "utf8");
    // The wrapper binary must NOT appear — launchd has no shell PATH, so
    // `exec node` inside it failed with 127 (measured 2026-11-19).
    expect(written).toContain("<string>backlog</string>");
    expect(written).toContain("<string>harvest</string>");
    expect(written).toContain(dist);
    expect(written).toContain("<key>PATH</key>");
    expect(calls).toEqual([["load", plistPath]]);
  });

  it("creates the plistDir when missing", async () => {
    captureConsole();
    const nested = path.join(fixturePlistDir(), "deeper");
    await runBacklogSchedule({
      install: true,
      plistDir: nested,
      distEntry: fixtureDist(),
      runLaunchctl: async () => 0,
    });
    expect(existsSync(path.join(nested, `${DEFAULT_HARVEST_LABEL}.plist`))).toBe(true);
  });

  it("fails with a hint when the built entry is missing", async () => {
    captureConsole();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      install: true,
      plistDir: fixturePlistDir(),
      distEntry: path.join(fixtureRoot as string, "no-such", "index.js"),
      runLaunchctl: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(existsSync(path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`))).toBe(false);
    expect(consoleErrors.join("\n")).toContain("pnpm build");
  });

  it("prints the manual load command when launchctl fails", async () => {
    captureConsole();
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`);
    const code = await runBacklogSchedule({
      plistDir: fixturePlistDir(),
      distEntry: fixtureDist(),
      install: true,
      runLaunchctl: async () => 127,
    });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toContain(`launchctl load "${plistPath}"`);
  });

  it("installs the AUTO agent nightly 01:00-05:00 under --kind auto", async () => {
    captureConsole();
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_AUTO_LABEL}.plist`);
    const code = await runBacklogSchedule({
      kind: "auto",
      plistDir: fixturePlistDir(),
      distEntry: fixtureDist(),
      install: true,
      runLaunchctl: async () => 0,
    });
    expect(code).toBe(0);
    const written = readFileSync(plistPath, "utf8");
    expect(written).toContain(DEFAULT_AUTO_LABEL);
    expect(written).toContain("<integer>1</integer>");
    expect(written).toContain("<integer>3</integer>");
    expect(written).toContain("<string>auto</string>");
    expect(consoleOutput.join("\n")).toMatch(/every 2h/);
  });

  it("bakes present provider keys into the plist and tightens it to 0600", async () => {
    captureConsole();
    process.env["MINIMAX_API_KEY"] = "mm-test-key";
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`);
    const code = await runBacklogSchedule({
      plistDir: fixturePlistDir(),
      distEntry: fixtureDist(),
      install: true,
      runLaunchctl: async () => 0,
    });
    delete process.env["MINIMAX_API_KEY"];
    expect(code).toBe(0);
    const written = readFileSync(plistPath, "utf8");
    expect(written).toContain("<key>MINIMAX_API_KEY</key>");
    expect(written).toContain("<string>mm-test-key</string>");
    const mode = statSync(plistPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("warns when the installing shell carries no provider keys", async () => {
    captureConsole();
    const saved: Record<string, string | undefined> = {};
    for (const key of ["MINIMAX_API_KEY", "GLM_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "YOUTUBE_REFRESH_TOKEN", "YOUTUBE_CLIENT_SECRET_FILE"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    const code = await runBacklogSchedule({
      plistDir: fixturePlistDir(),
      distEntry: fixtureDist(),
      install: true,
      runLaunchctl: async () => 0,
    });
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/env baked in: \(none found/);
  });
});

describe("runBacklogSchedule — remove", () => {
  it("unloads then unlinks an existing plist", async () => {
    captureConsole();
    mkdirSync(fixturePlistDir(), { recursive: true });
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`);
    writeFileSync(plistPath, "<plist/>");
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      remove: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([["unload", plistPath]]);
    expect(existsSync(plistPath)).toBe(false);
  });

  it("reports friendly zero-exit when no plist exists", async () => {
    captureConsole();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      remove: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(consoleOutput.join("\n")).toContain("nothing to remove");
  });
});

describe("runBacklogSchedule — status", () => {
  it("reports not installed when the plist is absent (no launchctl call)", async () => {
    captureConsole();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      status: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async (args) => {
        calls.push(args);
        return 1;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(consoleOutput.join("\n")).toContain("not installed");
  });

  it("reports installed + loaded when the seam signals a loaded label", async () => {
    captureConsole();
    mkdirSync(fixturePlistDir(), { recursive: true });
    writeFileSync(path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`), "<plist/>");
    const code = await runBacklogSchedule({
      status: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async () => 0,
    });
    expect(code).toBe(0);
    expect(consoleOutput.join("\n")).toMatch(/loaded: yes/);
  });
});

describe("addScheduleCommand", () => {
  it("registers the schedule subcommand with all flags", () => {
    const program = new RealCommand();
    const backlog = program.command("backlog");
    addScheduleCommand(backlog);
    const schedule = backlog.commands.find((c) => c.name() === "schedule");
    expect(schedule).toBeDefined();
    const opts = schedule?.options.map((o) => o.long) ?? [];
    expect(opts).toContain("--install");
    expect(opts).toContain("--remove");
    expect(opts).toContain("--status");
    expect(opts).toContain("--kind");
  });
});

// --- console capture helpers (kept at the bottom like the old file) ------
function captureConsole() {
  console.log = (...a: unknown[]) => consoleOutput.push(a.join(" "));
  console.error = (...a: unknown[]) => consoleErrors.push(a.join(" "));
}
