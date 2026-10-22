import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initState, writeProjectState } from "@video/workflow";
import { extractSuggestions, runRetrospect } from "./retrospect-command.js";

describe("extractSuggestions (T10)", () => {
  it("strips a single fenced YAML block", () => {
    const md =
      "Here is what I suggest:\n```yaml\n- foo: bar\n- baz: qux\n```\nDone.";
    expect(extractSuggestions(md)).toBe("- foo: bar\n- baz: qux");
  });
  it("returns trimmed content when no fence is present", () => {
    expect(extractSuggestions("  - plain list\n")).toBe("- plain list");
  });
  it("handles ```yaml fences without language tag", () => {
    const md = "```\nkey: value\n```";
    expect(extractSuggestions(md)).toBe("key: value");
  });
});

const LLM_REPLY =
  "Sure:\n```yaml\nsuggestions:\n  - scene: scene-01\n    action: shorten caption\n    expected_gain: fits on screen\n```\n";

let server: Server;
let projectsRoot: string;
let savedEnv: { key: string | undefined; base: string | undefined };

async function makeProject(name: string): Promise<string> {
  const proj = path.join(projectsRoot, "projects", name);
  await mkdir(path.join(proj, "storyboard"), { recursive: true });
  await writeProjectState(proj, initState(name));
  return proj;
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: LLM_REPLY } }],
        usage: { prompt_tokens: 9, completion_tokens: 11 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  savedEnv = {
    key: process.env["GLM_API_KEY"],
    base: process.env["GLM_BASE_URL"],
  };
  process.env["GLM_API_KEY"] = "test-key";
  process.env["GLM_BASE_URL"] =
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  projectsRoot = await mkdtemp(path.join(tmpdir(), "vf-retro-"));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise<void>((r) => server.close(() => r()));
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

describe("runRetrospect", () => {
  it("fails on an unknown project", async () => {
    const code = await runRetrospect({ project: "ghost", cwd: projectsRoot });
    expect(code).toBe(1);
  });

  it("fails on an empty project argument", async () => {
    const code = await runRetrospect({ project: "", cwd: projectsRoot });
    expect(code).toBe(1);
  });

  it("dry-run prints evidence without calling the LLM or writing output", async () => {
    await makeProject("rt-dry");
    const code = await runRetrospect({
      project: "rt-dry",
      cwd: projectsRoot,
      dryRun: true,
    });
    expect(code).toBe(0);
    expect(
      existsSync(
        path.join(projectsRoot, "projects", "rt-dry", "retrospect.md"),
      ),
    ).toBe(false);
  });

  it("writes retrospect.md with the extracted YAML and records a run", async () => {
    const proj = await makeProject("rt-happy");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      `findings:
  - level: warn
    check: captions
    message: caption too long
    fix: shorten it
`,
      "utf8",
    );

    const code = await runRetrospect({
      project: "rt-happy",
      cwd: projectsRoot,
    });
    expect(code).toBe(0);

    const out = await readFile(path.join(proj, "retrospect.md"), "utf8");
    expect(out).toContain("<!-- generated");
    expect(out).toContain("suggestions:");
    expect(out).toContain("scene-01");
    expect(out).not.toContain("```");

    const runsDir = path.join(proj, "runs");
    const runs = await readdir(runsDir);
    expect(runs.some((f) => f.endsWith(".yaml"))).toBe(true);
  });

  it("succeeds with zero findings when the QA report is corrupt", async () => {
    const proj = await makeProject("rt-corrupt");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      "{not yaml at all",
      "utf8",
    );
    const code = await runRetrospect({
      project: "rt-corrupt",
      cwd: projectsRoot,
    });
    expect(code).toBe(0);
  });
});
describe("runRetrospect — evidence gathering edges", () => {
  it("succeeds when article.md is missing (excerpt placeholder)", async () => {
    await makeProject("rt-noarticle");
    const code = await runRetrospect({
      project: "rt-noarticle",
      cwd: projectsRoot,
    });
    expect(code).toBe(0);
    const out = await readFile(
      path.join(projectsRoot, "projects", "rt-noarticle", "retrospect.md"),
      "utf8",
    );
    expect(out).toContain("suggestions:");
  });

  it("dry-run reports the QA finding count", async () => {
    const proj = await makeProject("rt-count");
    await mkdir(path.join(proj, "qa"), { recursive: true });
    await writeFile(
      path.join(proj, "qa", "render-report.json"),
      `findings:
  - level: error
    check: duration
    message: too short
  - level: warn
    check: captions
    message: too long
`,
      "utf8",
    );
    const logs: string[] = [];
    const spy = await import("vitest").then((v) =>
      v.vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
        logs.push(String(m));
      }),
    );
    const code = await runRetrospect({
      project: "rt-count",
      cwd: projectsRoot,
      dryRun: true,
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("2 findings");
    spy.mockRestore();
  });
});
