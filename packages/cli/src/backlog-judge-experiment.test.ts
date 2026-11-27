import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inspectDecision } from "./decision-inspect.js";
import {
  buildExperimentRequest,
  rankExperiment,
  runBacklogJudgeExperiment,
} from "./backlog-judge-experiment.js";

vi.mock("./decision-inspect.js", () => ({ inspectDecision: vi.fn() }));

describe("backlog judge experiment", () => {
  const ideas = [
    { id: "a", title: "Strong, but one weak axis", note: "" },
    { id: "b", title: "Balanced", note: "Opening — Payoff" },
    { id: "c", title: "Repeated", note: "" },
  ];
  const values = (
    title: number,
    retention: number,
    payoff: number,
    duplicate = 0,
  ) => ({
    click: title,
    retention,
    payoff,
    duplicate,
  });

  it("builds one shared request with separate score axes and a duplicate check per idea", () => {
    const request = buildExperimentRequest(ideas, ["Earlier film"]);
    expect(request.questions).toHaveLength(12);
    expect(request.questions[4]).toMatchObject({
      id: "click_2",
      kind: "score",
    });
    expect(request.questions[7]).toMatchObject({
      id: "duplicate_2",
      kind: "noul",
    });
    expect(request.input[0]?.text).toContain('"opening_pitch":"Opening"');
    expect(request.input[0]?.text).toContain('"payoff_pitch":"Payoff"');
    expect(request.input[0]?.text).toContain("Earlier film");
  });

  it("averages providers and keeps weak or flagged ideas out of the stable top five", () => {
    const ranking = rankExperiment(ideas, {
      google: [values(2, 0.7, 2), values(1.7, 1, 1.5), values(2, 2, 2, 0.8)],
      openai: [values(2, 0.9, 2), values(1.9, 1.4, 1.5), values(2, 2, 2, 0.9)],
    });
    expect(
      ranking.map(({ id, status, stable }) => [id, status, stable]),
    ).toEqual([
      ["b", "shortlist", true],
      ["c", "duplicate", false],
      ["a", "revise", false],
    ]);
    expect(ranking[0]?.score).toBeCloseTo(4.59);
    expect(ranking[2]?.combined.retention).toBeCloseTo(0.8);
  });

  it("flags one provider's duplication warning for review", () => {
    const ranking = rankExperiment(ideas.slice(0, 1), {
      google: [values(2, 2, 2, 0.85)],
      openai: [values(2, 2, 2, 0.1)],
    });
    expect(ranking[0]).toMatchObject({ status: "verify", stable: false });
  });
});

it.each([false, true])(
  "requires both Decisions responses (missing=%s)",
  async (missing) => {
    const root = mkdtempSync(path.join(tmpdir(), "judge-test-"));
    let reportPath: string | undefined;
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("GEMINI_API_KEY", "test");
    const requests: string[] = [];
    try {
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "");
      const backlog = JSON.stringify({
        schema: "backlog/1",
        ideas: [
          {
            id: "a",
            topic: "<Example>",
            status: "idea",
            source: "manual",
            created: "2026-11-27",
          },
        ],
      });
      const backlogPath = path.join(root, "backlog.yaml");
      writeFileSync(backlogPath, backlog);
      vi.mocked(inspectDecision).mockImplementation(
        async ({ requestPath, provider }) => {
          requests.push(requestPath);
          const name = provider?.name ?? "";
          const answers =
            name === "openai" && missing
              ? []
              : ["click", "retention", "payoff", "duplicate"].map((axis) => ({
                  questionId: `${axis}_1`,
                  answer: "1.5",
                  confidence: 0.8,
                  confidenceSource: "native",
                  error: null,
                  value:
                    axis === "duplicate"
                      ? { kind: "noul" as const, probability: 0.1 }
                      : { kind: "score" as const, score: 1.5, legend: {} },
                }));
          return {
            answers,
            provider: name,
            model: name,
            usage: { input: 0, output: 0 },
            latencyMs: 0,
            error: null,
            attachments: [],
          };
        },
      );

      expect(await runBacklogJudgeExperiment({ cwd: root, json: true })).toBe(
        missing ? 1 : 0,
      );
      expect(requests).toHaveLength(2);
      expect(requests[0]).toBe(requests[1]);
      expect(readFileSync(backlogPath, "utf8")).toBe(backlog);
      if (missing) {
        expect(output).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledWith(
          expect.stringContaining("openai click_1"),
        );
      } else {
        const result = JSON.parse(String(output.mock.calls[0]?.[0])) as {
          reportPath: string;
          resultPath: string;
          ranking: unknown[];
        };
        reportPath = result.reportPath;
        expect(result.ranking).toHaveLength(1);
        expect(readFileSync(reportPath, "utf8")).toContain("&lt;Example&gt;");
        expect(readFileSync(result.resultPath, "utf8")).toContain(
          '"score": 4.5',
        );
      }
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
      if (reportPath)
        rmSync(path.dirname(reportPath), { recursive: true, force: true });
    }
  },
);
