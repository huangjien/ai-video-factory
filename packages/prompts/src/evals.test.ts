import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  applyRecorded,
  blockLayout,
  buildEnvelope,
  evalSnapshotPath,
  evalsDir,
  listEvalAgents,
  listEvalCases,
  listEvalFiles,
  listSnapshotIds,
  loadEvalFixture,
  parseEvalFixture,
  renderEnvelopeYaml,
  renderYaml,
  sha256OfMessages,
} from "./evals.js";

describe("evals fixtures on disk", () => {
  it("lists both agents, each with cases", () => {
    expect(listEvalAgents()).toEqual(["draft", "storyboard"]);
    expect(listEvalFiles(evalsDir(), "draft").length).toBeGreaterThan(0);
    expect(listEvalFiles(evalsDir(), "storyboard").length).toBeGreaterThan(0);
  });

  it("every fixture carries provenance naming its source", () => {
    for (const ref of listEvalCases()) {
      expect(ref.fixture.provenance.source.length).toBeGreaterThan(10);
      expect(ref.fixture.expects.length).toBeGreaterThan(0);
    }
  });

  it("every axis min is a 0-10 judge band", () => {
    for (const ref of listEvalCases()) {
      for (const e of ref.fixture.expects) {
        expect(e.min).toBeGreaterThanOrEqual(0);
        expect(e.min).toBeLessThanOrEqual(10);
      }
    }
  });

  it("narrows by agent and by case id", () => {
    const one = listEvalCases({ agent: "storyboard" });
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((r) => r.agent === "storyboard")).toBe(true);

    const picked = listEvalCases({
      agent: "storyboard",
      caseId: "xuanwumen-scene-count-fits-180s",
    });
    expect(picked).toHaveLength(1);
    expect(picked[0]?.fixture.id).toBe("xuanwumen-scene-count-fits-180s");
  });

  it("an unknown agent throws instead of reading as 'nothing to do'", () => {
    expect(() => listEvalCases({ agent: "nope" })).toThrow(
      /unknown eval agent "nope"/,
    );
  });
});

describe("parseEvalFixture", () => {
  const valid = {
    id: "case-a",
    agent: "draft",
    input: { topic: "x" },
    expects: [{ axis: "hook-tension", min: 7 }],
    provenance: { source: "a real failure" },
  };

  it("parses a minimal fixture", () => {
    const f = parseEvalFixture("case-a.yaml", valid);
    expect(f.id).toBe("case-a");
    expect(f.recorded).toBeUndefined();
  });

  it("parses an optional recorded block", () => {
    const f = parseEvalFixture("case-a.yaml", {
      ...valid,
      recorded: { prompt_hash: "sha256:abc", scores: { "hook-tension": 8 } },
    });
    expect(f.recorded?.scores["hook-tension"]).toBe(8);
  });

  it.each([
    [["id", "missing id"], { ...valid, id: undefined }],
    [["agent", "missing agent"], { ...valid, agent: undefined }],
    [["input", "non-mapping input"], { ...valid, input: ["topic"] }],
    [["expects", "empty expects"], { ...valid, expects: [] }],
    [
      ["expects[0].min", "non-numeric min"],
      { ...valid, expects: [{ axis: "a", min: "7" }] },
    ],
    [
      ["expects[1].axis", "duplicate axis"],
      {
        ...valid,
        expects: [
          { axis: "a", min: 7 },
          { axis: "a", min: 8 },
        ],
      },
    ],
    [["provenance.source", "missing provenance"], { ...valid, provenance: {} }],
    [
      ["recorded.scores", "non-mapping scores"],
      {
        ...valid,
        recorded: { prompt_hash: "sha256:a", scores: 8 },
      },
    ],
  ])("rejects %s (%s)", (_field, raw) => {
    expect(() => parseEvalFixture("case-a.yaml", raw)).toThrow(
      /invalid eval fixture case-a\.yaml: /,
    );
  });

  it("rejects a non-mapping top level", () => {
    expect(() => parseEvalFixture("case-a.yaml", ["nope"])).toThrow(
      /top level must be a mapping/,
    );
  });
});

describe("blockLayout", () => {
  it("captures section headings and leading fields in order", () => {
    const layout = blockLayout(
      [
        "Topic: 玄武门之变",
        "Audience: 对历史感兴趣的普通观众",
        "",
        "## The user's major idea (from --file)",
        "do not soften this",
        "",
        "### Key claims",
        "- one",
      ].join("\n"),
    );
    expect(layout).toEqual([
      "Topic:",
      "Audience:",
      "§ The user's major idea (from --file)",
      "§ Key claims",
    ]);
  });

  it("de-duplicates a repeated marker", () => {
    expect(blockLayout("## Same\n## Same")).toEqual(["§ Same"]);
  });

  it("ignores blank lines and lowercase prose", () => {
    expect(blockLayout("   \n\nsome prose here\n")).toEqual([]);
  });
});

describe("buildEnvelope", () => {
  const messages = [
    { role: "system", content: "SYSTEM BODY" },
    { role: "user", content: "Topic: x\n\n## Block\nbody" },
  ];

  it("hashes each body and records the layout", () => {
    const env = buildEnvelope("case-a", "draft", messages);
    expect(env.case).toBe("case-a");
    expect(env.agent).toBe("draft");
    expect(env.messages).toHaveLength(2);
    expect(env.messages[0]?.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(env.messages[0]?.bytes).toBe("SYSTEM BODY".length);
    expect(env.messages[1]?.blocks).toEqual(["Topic:", "§ Block"]);
  });

  it("prompt_hash is stable for identical messages and moves otherwise", () => {
    const a = buildEnvelope("c", "draft", messages);
    const b = buildEnvelope("c", "draft", [...messages]);
    const c = buildEnvelope("c", "draft", [
      messages[0]!,
      { ...messages[1]!, content: "Topic: y" },
    ]);
    expect(a.prompt_hash).toBe(b.prompt_hash);
    expect(a.prompt_hash).not.toBe(c.prompt_hash);
  });

  it("renderEnvelopeYaml round-trips through loadEnvelope", async () => {
    const { parse: parseYaml } = await import("yaml");
    const env = buildEnvelope("case-a", "draft", messages);
    expect(parseYaml(renderEnvelopeYaml(env))).toEqual(env);
  });
});

describe("snapshot paths", () => {
  it("puts snapshots beside the fixtures in __snapshots__", () => {
    const p = evalSnapshotPath("draft", "case-a");
    expect(p).toMatch(
      /evals[/\\]draft[/\\]__snapshots__[/\\]case-a\.envelope\.yaml$/,
    );
  });

  it("every case has a committed snapshot and vice versa", () => {
    const root = evalsDir();
    const refs = listEvalCases({}, root);
    expect(refs.length).toBeGreaterThan(0);
    for (const agent of listEvalAgents(root)) {
      const ids = refs
        .filter((r) => r.agent === agent)
        .map((r) => r.fixture.id);
      expect(listSnapshotIds(root, agent).sort()).toEqual([...ids].sort());
    }
  });
});

describe("applyRecorded", () => {
  it("rewrites only the recorded block", () => {
    const fixture = loadEvalFixture(
      `${evalsDir()}/draft/history-topic-opens-with-tension.yaml`,
    );
    const next = applyRecorded(fixture, {
      prompt_hash: "sha256:zzz",
      scores: { "hook-tension": 8 },
    });
    expect(next["id"]).toBe(fixture.id);
    expect(next["input"]).toEqual(fixture.input);
    expect(next["expects"]).toEqual(fixture.expects);
    expect(next["recorded"]).toEqual({
      prompt_hash: "sha256:zzz",
      scores: { "hook-tension": 8 },
    });
  });

  it("renders back to a fixture the parser accepts", () => {
    const fixture = loadEvalFixture(
      `${evalsDir()}/draft/history-topic-opens-with-tension.yaml`,
    );
    const yaml = renderYaml(
      applyRecorded(fixture, {
        prompt_hash: "sha256:zzz",
        scores: { "hook-tension": 8, "scene-count-fits-duration": 9 },
      }),
    );
    const reparsed = parseEvalFixture("roundtrip.yaml", parseYaml(yaml));
    expect(reparsed.recorded?.prompt_hash).toBe("sha256:zzz");
  });
});

describe("sha256OfMessages", () => {
  it("hashes role+content only, so extra keys cannot move the lineage", () => {
    const base = [{ role: "system", content: "a" }];
    const withExtra = [{ role: "system", content: "a", extra: 1 }];
    expect(sha256OfMessages(base)).toBe(sha256OfMessages(withExtra));
  });

  it("moves when the body moves", () => {
    expect(sha256OfMessages([{ role: "system", content: "a" }])).not.toBe(
      sha256OfMessages([{ role: "system", content: "b" }]),
    );
  });
});
