import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import type { Provider } from "@video/llm";
import {
  buildEnvelope,
  evalSnapshotPath,
  evalsDir,
  listEvalCases,
  loadEnvelope,
} from "@video/prompts";
import { registerPrompts } from "./prompts-command.js";
import {
  EVAL_AGENTS,
  EVALS_JUDGE_SYSTEM_PROMPT,
  buildJudgeMessages,
  clampAxis,
  compareEnvelope,
  extractBalancedJson,
  findOrphans,
  parseJudgeReply,
  providerInstance,
  renderReportYaml,
  runPromptEvals,
  runStructural,
  scoreAgainstRubric,
  verdictExitCode,
  verdictFor,
} from "./prompt-evals.js";

// ─── Layer 1: structural ─────────────────────────────────────────────────────

describe("layer 1 against the committed snapshots", () => {
  it("every fixture passes — no prompt drift since the snapshots were taken", () => {
    const results = runStructural(listEvalCases());
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect({
        case: `${r.agent}/${r.case}`,
        status: r.status,
        detail: r.detail,
      }).toEqual({ case: `${r.agent}/${r.case}`, status: "pass", detail: "" });
    }
  });

  it("stamps a prompt_hash on every case for run-record lineage", () => {
    for (const r of runStructural(listEvalCases())) {
      expect(r.promptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("catches an edited prompt body", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    const actual = buildEnvelope(ref.fixture.id, ref.agent, [
      { role: "system", content: "EDITED BODY" },
      { role: "user", content: "Topic: x" },
    ]);
    const expected = loadEnvelope(evalSnapshotPath(ref.agent, ref.fixture.id));
    const got = compareEnvelope(actual, expected);
    expect(got.status).toBe("prompt-drift");
    expect(got.detail).toMatch(/body changed/);
  });

  it("catches a reordered or dropped context block", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    const expected = loadEnvelope(evalSnapshotPath(ref.agent, ref.fixture.id));
    // Identical hashes, different layout: only the block list can catch this,
    // which is exactly the case a content hash alone would miss.
    const actual: typeof expected = {
      ...expected,
      messages: expected.messages.map((m, i) =>
        i === 1 ? { ...m, blocks: [...m.blocks].reverse() } : m,
      ),
    };
    const got = compareEnvelope(actual, expected);
    expect(got.status).toBe("layout-drift");
    expect(got.detail).toMatch(/context blocks changed/);
  });

  it("catches a changed message count", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    const expected = loadEnvelope(evalSnapshotPath(ref.agent, ref.fixture.id));
    const got = compareEnvelope(
      { ...expected, messages: expected.messages.slice(0, 1) },
      expected,
    );
    expect(got.status).toBe("layout-drift");
    expect(got.detail).toMatch(/message count 1 ≠ 2/);
  });

  it("catches a changed role order", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    const expected = loadEnvelope(evalSnapshotPath(ref.agent, ref.fixture.id));
    const got = compareEnvelope(
      {
        ...expected,
        messages: expected.messages.map((m, i) => ({
          ...m,
          role: i === 0 ? "user" : "system",
        })),
      },
      expected,
    );
    expect(got.status).toBe("layout-drift");
    expect(got.detail).toMatch(/role "user" ≠ "system"/);
  });

  it("reports a missing snapshot instead of passing it", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    const actual = buildEnvelope(ref.fixture.id, ref.agent, [
      { role: "system", content: "x" },
    ]);
    const got = compareEnvelope(actual, null);
    expect(got.status).toBe("missing-snapshot");
    expect(got.detail).toMatch(/--update-snapshots/);
  });

  it("rejects a fixture whose agent has no adapter", () => {
    const ref = listEvalCases({ agent: "draft" })[0]!;
    expect(() =>
      runStructural([
        { ...ref, agent: "ghost", fixture: { ...ref.fixture, agent: "ghost" } },
      ]),
    ).toThrow(/harness has no adapter/);
  });
});

// ─── Orphan guard (plan §5 — the CI-visible discipline) ──────────────────────

describe("two-way orphan guard", () => {
  it("the committed golden set is clean in both directions", () => {
    expect(findOrphans()).toEqual({
      missingSnapshots: [],
      orphanSnapshots: [],
    });
  });

  it("flags a fixture with no snapshot and a snapshot with no fixture", async () => {
    const { mkdir, mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(tmpdir(), "evals-orphan-"));
    const dir = path.join(root, "draft");
    await mkdir(path.join(dir, "__snapshots__"), { recursive: true });
    await writeFile(
      path.join(dir, "kept.yaml"),
      "id: kept\nagent: draft\ninput: {}\nexpects: [{axis: a, min: 7}]\nprovenance: {source: s}\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, "__snapshots__", "deleted.envelope.yaml"),
      "case: deleted\nagent: draft\nprompt_hash: sha256:a\nmessages: []\n",
      "utf8",
    );

    expect(findOrphans(root)).toEqual({
      missingSnapshots: ["draft/kept"],
      orphanSnapshots: ["draft/deleted"],
    });
  });

  it("returns empty when there is nothing under evals/ at all", () => {
    expect(findOrphans("/nonexistent-evals-root")).toEqual({
      missingSnapshots: [],
      orphanSnapshots: [],
    });
  });
});

// ─── Layer 2: judge parsing + verdict ────────────────────────────────────────

describe("clampAxis", () => {
  it("rounds floats and clamps to the 0-10 band", () => {
    expect(clampAxis(8.4)).toBe(8);
    expect(clampAxis(11)).toBe(10);
    expect(clampAxis(-3)).toBe(0);
    expect(clampAxis("9")).toBe(9);
  });

  it.each([["seven"], [null], [undefined], [{}], [Number.NaN]])(
    "rejects %p instead of scoring it zero",
    (v) => {
      expect(clampAxis(v)).toBeNull();
    },
  );
});

describe("extractBalancedJson", () => {
  it("pulls the object out of prose", () => {
    expect(extractBalancedJson('sure:\n{"a": 1}\nthanks')).toBe('{"a": 1}');
  });

  it("ignores braces inside strings", () => {
    expect(extractBalancedJson('{"a": "}{"}')).toBe('{"a": "}{"}');
  });

  it("handles escapes", () => {
    expect(extractBalancedJson('{"a": "\\""}')).toBe('{"a": "\\""}');
  });

  it("returns null when there is no object or it never closes", () => {
    expect(extractBalancedJson("no json here")).toBeNull();
    expect(extractBalancedJson('{"a": 1')).toBeNull();
  });
});

describe("parseJudgeReply", () => {
  it("keeps only the requested axes and sums the total itself", () => {
    const got = parseJudgeReply(
      {
        "hook-tension": 8,
        extra: 3,
        comment: "weak open",
        suggestions: ["a", "b"],
      },
      ["hook-tension"],
    );
    expect(got.scores).toEqual({ "hook-tension": 8 });
    expect(got.total).toBe(8);
    expect(got.comment).toBe("weak open");
    expect(got.suggestions).toEqual(["a", "b"]);
  });

  it("ignores a total the judge made up", () => {
    expect(
      parseJudgeReply({ "hook-tension": 8, total: 100 }, ["hook-tension"])
        .total,
    ).toBe(8);
  });

  it("caps suggestions at 5 and drops non-strings", () => {
    const got = parseJudgeReply(
      {
        "hook-tension": 8,
        suggestions: ["a", "b", "c", "d", "e", "f", 7, null],
      },
      ["hook-tension"],
    );
    expect(got.suggestions).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("defaults comment and suggestions when absent", () => {
    const got = parseJudgeReply({ "hook-tension": 8 }, ["hook-tension"]);
    expect(got.comment).toBe("");
    expect(got.suggestions).toEqual([]);
  });

  it("throws when a requested axis is missing", () => {
    expect(() => parseJudgeReply({ other: 8 }, ["hook-tension"])).toThrow(
      /omitted or mangled axis "hook-tension"/,
    );
  });

  it("throws when the payload is not an object", () => {
    expect(() => parseJudgeReply([1, 2], ["hook-tension"])).toThrow(
      /not a JSON object/,
    );
  });
});

describe("verdictFor", () => {
  const expects = [
    { axis: "a", min: 7 },
    { axis: "b", min: 8 },
  ];

  it("passes when every axis clears its bar", () => {
    expect(verdictFor(expects, { a: 7, b: 8 })).toEqual({
      status: "pass",
      detail: "all axes ≥ min (total 15)",
    });
  });

  it("fails and names the axis below its bar", () => {
    const got = verdictFor(expects, { a: 6, b: 9 });
    expect(got.status).toBe("fail");
    expect(got.detail).toBe("a=6 < min 7");
  });

  it("treats a missing axis as a failure, never a pass", () => {
    const got = verdictFor(expects, { a: 9 } as Record<string, number>);
    expect(got.status).toBe("fail");
    expect(got.detail).toMatch(/b=missing < min 8/);
  });
});

describe("buildJudgeMessages", () => {
  it("names the agent, lists exactly the case's axes, and caps the output", () => {
    const msgs = buildJudgeMessages(
      "draft",
      ["hook-tension", "beat-count"],
      "BODY",
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe(EVALS_JUDGE_SYSTEM_PROMPT);
    expect(msgs[1]?.content).toContain("Agent under test: draft");
    expect(msgs[1]?.content).toContain("- hook-tension");
    expect(msgs[1]?.content).toContain("- beat-count");
    expect(msgs[1]?.content).toContain("## Agent output");
  });
});

describe("providerInstance", () => {
  it("maps the two judge providers and rejects anything else", () => {
    expect(providerInstance("glm").name).toBe("glm");
    expect(providerInstance("minimax").name).toBe("minimax");
    expect(() => providerInstance("openai")).toThrow(
      /unsupported judge provider: openai/,
    );
  });
});

// ─── Layer 2 over a stub provider ────────────────────────────────────────────

describe("scoreAgainstRubric", () => {
  function stub(reply: string, name = "stub"): Provider {
    return {
      name,
      chat: async () => ({
        content: reply,
        usage: { input: 0, output: 0 },
      }),
    };
  }

  it("parses the judge's JSON and sums the total itself", async () => {
    const got = await scoreAgainstRubric(
      "draft",
      ["hook-tension", "scene-count-fits-duration"],
      "ARTICLE",
      stub('{"hook-tension": 8, "scene-count-fits-duration": 9, "total": 999}'),
      null,
    );
    expect(got.scores).toEqual({
      "hook-tension": 8,
      "scene-count-fits-duration": 9,
    });
    expect(got.total).toBe(17);
  });

  it("tolerates prose and a fence around the JSON", async () => {
    const got = await scoreAgainstRubric(
      "draft",
      ["hook-tension"],
      "ARTICLE",
      stub('Here you go:\n```json\n{"hook-tension": 7}\n```'),
      null,
    );
    expect(got.scores).toEqual({ "hook-tension": 7 });
  });

  it("raises when the reply has no JSON object", async () => {
    await expect(
      scoreAgainstRubric(
        "draft",
        ["hook-tension"],
        "ARTICLE",
        stub("I would rather not."),
        null,
      ),
    ).rejects.toThrow(/no JSON object in judge response/);
  });

  it("raises when the JSON is truncated", async () => {
    await expect(
      scoreAgainstRubric(
        "draft",
        ["hook-tension"],
        "ARTICLE",
        stub('{"hook-tension": 8'),
        null,
      ),
    ).rejects.toThrow(/no JSON object in judge response/);
  });

  it("raises when the JSON is malformed", async () => {
    await expect(
      scoreAgainstRubric(
        "draft",
        ["hook-tension"],
        "ARTICLE",
        stub("{hook-tension: 8,}"),
        null,
      ),
    ).rejects.toThrow(/judge JSON parse failed/);
  });

  it("raises when a requested axis is missing", async () => {
    await expect(
      scoreAgainstRubric(
        "draft",
        ["hook-tension", "shot-variety"],
        "ARTICLE",
        stub('{"hook-tension": 8}'),
        null,
      ),
    ).rejects.toThrow(/omitted or mangled axis "shot-variety"/);
  });
});

// ─── Report ──────────────────────────────────────────────────────────────────

describe("renderReportYaml", () => {
  const structural = [
    {
      case: "c1",
      agent: "draft",
      status: "pass" as const,
      detail: "",
      promptHash: "sha256:aa",
    },
    {
      case: "c2",
      agent: "draft",
      status: "prompt-drift" as const,
      detail: "body changed",
      promptHash: "sha256:bb",
    },
  ];

  it("pins prompt_hash per row and marks layer 2 skipped when it did not run", () => {
    const parsed = parseYaml(renderReportYaml(structural, [])) as {
      schema: string;
      cases: { case: string; prompt_hash: string; judged: string }[];
    };
    expect(parsed.schema).toBe("prompt-evals-report/1");
    expect(parsed.cases[0]?.prompt_hash).toBe("sha256:aa");
    expect(parsed.cases[1]?.prompt_hash).toBe("sha256:bb");
    expect(parsed.cases.every((r) => r.judged === "skipped")).toBe(true);
  });

  it("carries scores, total, and the error string for judged rows", () => {
    const parsed = parseYaml(
      renderReportYaml(structural, [
        {
          case: "c1",
          agent: "draft",
          status: "fail",
          promptHash: "sha256:cc",
          scores: { "hook-tension": 5 },
          total: 5,
          comment: "",
          error: "judge omitted axis",
          line: "FAIL c1 layer2 error",
        },
      ]),
    ) as {
      cases: {
        judged: string;
        scores: Record<string, number>;
        total: number;
        error?: string;
      }[];
    };
    const row = parsed.cases[0]!;
    expect(row.judged).toBe("fail");
    expect(row.scores).toEqual({ "hook-tension": 5 });
    expect(row.total).toBe(5);
    expect(row.error).toBe("judge omitted axis");
  });
});

// ─── Agent adapters ──────────────────────────────────────────────────────────

describe("EVAL_AGENTS", () => {
  it("wires every agent with a fixture directory and nothing dangling", () => {
    expect(Object.keys(EVAL_AGENTS).sort()).toEqual([
      "article-review",
      "draft",
      "image-prompt",
      "storyboard",
    ]);
  });

  it("the image-prompt adapter anchors era through the setting", () => {
    // The era-poor guard scene: without the declared setting this exact
    // scene produced a "late Ming dynasty, 1620" brief.
    const input = {
      setting: "Tang-dynasty China, 626-630 CE",
      scene: {
        id: "scene_13",
        visual: "\u5bab\u95e8\u5b88\u536b\u5728\u591c\u8272\u4e2d\u8f6c\u8eab",
        narration:
          "\u5bab\u7981\u68ee\u4e25\uff0c\u591c\u8272\u5df2\u6df1\u3002",
      },
    };
    const user = EVAL_AGENTS["image-prompt"]!.build(input)[1]?.content ?? "";
    expect(user).toContain("Tang-dynasty China, 626-630 CE");
    expect(user.indexOf("Setting (")).toBeLessThan(
      user.indexOf("Visual direction:"),
    );
  });

  it("each adapter's id matches its registry key", () => {
    for (const [key, agent] of Object.entries(EVAL_AGENTS)) {
      expect(agent.id).toBe(key);
    }
  });

  it("build() is pure and returns a system+user pair for every case", () => {
    for (const ref of listEvalCases()) {
      const messages = EVAL_AGENTS[ref.agent]!.build(ref.fixture.input);
      expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
      expect(messages[0]?.content.length).toBeGreaterThan(200);
    }
  });

  it("each adapter's build() carries the case's own input into the user turn", () => {
    const ref = listEvalCases({ agent: "storyboard" })[0]!;
    const topic = String(ref.fixture.input["topic"]);
    expect(
      EVAL_AGENTS[ref.agent]!.build(ref.fixture.input)[1]?.content,
    ).toContain(topic);
  });
});

// ─── CLI surface ─────────────────────────────────────────────────────────────

describe("video prompts eval", () => {
  async function run(args: string[]): Promise<{ out: string; code: number }> {
    const program = new Command();
    program.exitOverride();
    registerPrompts(program);
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const original = process.exitCode;
    process.exitCode = 0;
    try {
      await program.parseAsync(["prompts", ...args], { from: "user" });
      return {
        out: logged.mock.calls.map((c) => c.join(" ")).join("\n"),
        code: process.exitCode ?? 0,
      };
    } finally {
      logged.mockRestore();
      process.exitCode = original;
    }
  }

  it("defaults to layer 1 and exits 0 on the committed golden set", async () => {
    const { out, code } = await run(["eval", "--offline"]);
    expect(code).toBe(0);
    expect(out).toMatch(/layer1 pass/);
    expect(out).toMatch(/layer 2 not run|offline/);
  }, 20_000);

  it("narrows to one agent and one case", async () => {
    const { out, code } = await run([
      "eval",
      "--offline",
      "--agent",
      "storyboard",
      "--case",
      "xuanwumen-scene-count-fits-180s",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("storyboard/xuanwumen-scene-count-fits-180s");
    expect(out).not.toContain("draft/");
  }, 20_000);

  it("an unknown case is a failure, not a silent green run", async () => {
    const { out, code } = await run([
      "eval",
      "--offline",
      "--agent",
      "draft",
      "--case",
      "does-not-exist",
    ]);
    expect(code).toBe(1);
    expect(out).toMatch(/no eval case matched/);
  }, 20_000);
});

describe("runPromptEvals default options", () => {
  it("runs with no options at all — layer 1 only, no provider call", async () => {
    const lines: string[] = [];
    const code = await runPromptEvals({ log: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/layer 2 not run/);
  }, 20_000);

  it("writes the report next to the fixtures", async () => {
    const code = await runPromptEvals({
      offline: true,
      log: () => {},
    });
    expect(code).toBe(0);
    const { readFile } = await import("node:fs/promises");
    const report = parseYaml(
      await readFile(`${evalsDir()}/report.yaml`, "utf8"),
    ) as { schema: string; cases: unknown[] };
    expect(report.schema).toBe("prompt-evals-report/1");
    expect(report.cases.length).toBe(listEvalCases().length);
  }, 20_000);

  it("exit 1 for a measured failure, exit 2 when nothing could be measured", () => {
    // The distinction drives the pre-push gate: blocking on 2 would make the
    // hook flaky whenever the provider is slow, which is not a prompt defect.
    const qualityFail = verdictExitCode(
      [
        {
          case: "c1",
          agent: "draft",
          status: "fail",
          promptHash: "sha256:a",
          scores: { a: 3 },
          total: 3,
          comment: "",
          line: "",
        },
      ],
      0,
      0,
    );
    expect(qualityFail).toBe(1);

    const infraOnly = verdictExitCode(
      [
        {
          case: "c1",
          agent: "draft",
          status: "error",
          promptHash: "sha256:a",
          scores: {},
          total: 0,
          comment: "",
          error: "generation timed out after 180000ms",
          line: "",
        },
      ],
      0,
      0,
    );
    expect(infraOnly).toBe(2);

    const both = verdictExitCode(
      [
        {
          case: "c1",
          agent: "draft",
          status: "fail",
          promptHash: "sha256:a",
          scores: { a: 3 },
          total: 3,
          comment: "",
          line: "",
        },
        {
          case: "c2",
          agent: "draft",
          status: "error",
          promptHash: "sha256:b",
          scores: {},
          total: 0,
          comment: "",
          error: "provider outage",
          line: "",
        },
      ],
      0,
      0,
    );
    // A real regression outranks an unmeasured sibling.
    expect(both).toBe(1);

    expect(verdictExitCode([], 0, 0)).toBe(0);
    expect(verdictExitCode([], 2, 1)).toBe(1);
  });
});
