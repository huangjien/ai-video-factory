import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_HARVEST_LABEL,
  addScheduleCommand,
  harvestPlistContent,
  runBacklogSchedule,
} from "./backlog-schedule.js";
import type { Command } from "commander";
import { Command as RealCommand } from "commander";

let fixtureRoot: string | undefined;
beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "video-backlog-schedule-"));
});
afterEach(() => {
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

// Console capture so assertions can check user-facing messages.
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const origLog = console.log;
const origErr = console.error;
beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
});
function captureConsole() {
  console.log = (...a: unknown[]) => {
    consoleOutput.push(a.join(" "));
  };
  console.error = (...a: unknown[]) => {
    consoleErrors.push(a.join(" "));
  };
}

function fixturePlistDir(): string {
  return path.join(fixtureRoot as string, "LaunchAgents");
}
function fixtureLog(): string {
  return path.join(fixtureRoot as string, "runs", "harvest.log");
}

describe("harvestPlistContent", () => {
  const base = { videoPath: "/usr/local/bin/video", logPath: "/tmp/harvest.log" };

  it("is well-formed XML with the expected top-level shape", () => {
    const xml = harvestPlistContent({ ...base, label: "test.label" });
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<key>Label</key>');
    expect(xml).toContain("<string>test.label</string>");
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
    // dict keys are paired with values
    expect(xml.match(/<key>/g)?.length).toBe(xml.match(/<\/key>/g)?.length);
  });

  it("defaults the label to com.aivideofactory.backlog-harvest", () => {
    expect(harvestPlistContent({ ...base })).toContain(
      `<string>${DEFAULT_HARVEST_LABEL}</string>`,
    );
  });

  it("sets ProgramArguments to [videoPath, backlog, harvest]", () => {
    const xml = harvestPlistContent(base);
    const args = xml.slice(xml.indexOf("ProgramArguments"));
    expect(args).toContain("<string>/usr/local/bin/video</string>");
    expect(args).toContain("<string>backlog</string>");
    expect(args).toContain("<string>harvest</string>");
    expect(args.indexOf("backlog")).toBeLessThan(args.indexOf("harvest"));
  });

  it("schedules a weekly run (Sunday 09:00)", () => {
    const xml = harvestPlistContent(base);
    const sched = xml.slice(xml.indexOf("StartCalendarInterval"));
    expect(sched).toContain("<key>Weekday</key>");
    expect(sched).toContain("<integer>0</integer>"); // launchd: 0 = Sunday
    expect(sched).toContain("<key>Hour</key>");
    expect(sched).toContain("<integer>9</integer>");
  });

  it("forces headless mode via VIDEO_ASK=off", () => {
    const xml = harvestPlistContent(base);
    expect(xml).toContain("<key>VIDEO_ASK</key>");
    expect(xml).toContain("<string>off</string>");
  });

  it("routes stdout and stderr to the log path and does not run at load", () => {
    const xml = harvestPlistContent({ ...base, logPath: fixtureLog() });
    expect(xml.match(new RegExp(`<string>${fixtureLog().replaceAll("/", "\\/")}</string>`, "g"))?.length).toBe(2);
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<false/>");
  });

  it("escapes XML-special characters in paths", () => {
    const xml = harvestPlistContent({
      videoPath: "/opt/weird & path/video",
      logPath: "/tmp/log<1>.txt",
    });
    expect(xml).toContain("/opt/weird &amp; path/video");
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
        videoPath: "/bin/video",
        runLaunchctl: async () => 0,
      }),
    ).toBe(1);
    expect(consoleErrors.join("\n")).toContain("exactly one");
  });
});

describe("runBacklogSchedule — install", () => {
  // Computed lazily per test — fixtureRoot only exists after beforeEach.
  const seamOpts = () => ({ plistDir: fixturePlistDir(), videoPath: "/usr/local/bin/video" });

  it("writes the plist into the fixture plistDir and loads it via the seam", async () => {
    captureConsole();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      ...seamOpts(),
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
    expect(written).toContain("<string>/usr/local/bin/video</string>");
    expect(written).toContain("<string>harvest</string>");
    expect(calls).toEqual([["load", plistPath]]);
  });

  it("creates the plistDir when missing", async () => {
    captureConsole();
    const nested = path.join(fixturePlistDir(), "deeper");
    await runBacklogSchedule({
      install: true,
      plistDir: nested,
      videoPath: "/bin/video",
      runLaunchctl: async () => 0,
    });
    expect(existsSync(path.join(nested, `${DEFAULT_HARVEST_LABEL}.plist`))).toBe(true);
  });

  it("fails with a hint when no video binary resolves", async () => {
    captureConsole();
    const calls: string[][] = [];
    const code = await runBacklogSchedule({
      install: true,
      plistDir: fixturePlistDir(),
      // empty videoPath = simulated resolution failure (real `which video`
      // may find a dev-machine binary, so cwd alone cannot force the miss)
      videoPath: "",
      runLaunchctl: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(existsSync(path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`))).toBe(false);
    expect(consoleErrors.join("\n")).toContain("bin/video");
  });

  it("prints the manual load command when launchctl fails", async () => {
    captureConsole();
    const plistPath = path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`);
    const code = await runBacklogSchedule({
      ...seamOpts(),
      install: true,
      runLaunchctl: async () => 127,
    });
    expect(code).toBe(1);
    expect(consoleErrors.join("\n")).toContain(`launchctl load "${plistPath}"`);
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
    await runBacklogSchedule({
      status: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async (args) => (args[0] === "list" ? 0 : 1),
    });
    const out = consoleOutput.join("\n");
    expect(out).toContain("installed");
    expect(out).toContain("loaded: yes");
  });

  it("reports installed but not loaded when the seam fails on list", async () => {
    captureConsole();
    mkdirSync(fixturePlistDir(), { recursive: true });
    writeFileSync(path.join(fixturePlistDir(), `${DEFAULT_HARVEST_LABEL}.plist`), "<plist/>");
    await runBacklogSchedule({
      status: true,
      plistDir: fixturePlistDir(),
      runLaunchctl: async () => 1,
    });
    expect(consoleOutput.join("\n")).toContain("loaded: no");
  });
});

describe("addScheduleCommand", () => {
  function buildBacklog(): Command {
    const program = new RealCommand();
    const backlog = program.command("backlog");
    addScheduleCommand(backlog);
    return program;
  }

  it("registers a schedule subcommand with the three action flags", () => {
    const schedule = buildBacklog().commands.find((c) => c.name() === "backlog")?.commands.find((c) => c.name() === "schedule");
    expect(schedule).toBeDefined();
    const names = schedule?.options.map((o) => o.long);
    expect(names).toContain("--install");
    expect(names).toContain("--remove");
    expect(names).toContain("--status");
    expect(names).toContain("--cwd");
  });

  it("maps a --status invocation to a zero exit without side effects", async () => {
    captureConsole();
    const program = buildBacklog();
    await program.parseAsync(["backlog", "schedule", "--status"], { from: "user" });
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
    expect(consoleOutput.join("\n")).toContain("not installed");
  });
});
