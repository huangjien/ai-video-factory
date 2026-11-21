import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildDecisionFunction,
  functionNameFor,
  MiniMaxDecisionProvider,
} from "./minimax.js";
import type { DecisionRequest } from "./contract.js";

const request: DecisionRequest = {
  state: "The caption overlaps the subtitle band in frame 12.",
  question: {
    id: "qa-triage",
    kind: "choice",
    instructions: "Does this finding block the render?",
    options: ["pass", "review", "block"],
  },
};

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function toolCallResponse(args: unknown): unknown {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "qa_triage",
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 491, completion_tokens: 598 },
  };
}

describe("MiniMaxDecisionProvider", () => {
  let server: Server;
  let baseUrl: string;
  let lastBody: string | undefined;
  let requestCount = 0;
  let responseBody: unknown = toolCallResponse({
    choice: "block",
    confidence: 0.93,
    reason: "The caption covers the subtitle band.",
  });

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requestCount += 1;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("turns the question id into a function name", () => {
    expect(functionNameFor("qa-triage")).toBe("qa_triage");
  });

  it("prefixes a function name that starts with a digit", () => {
    expect(functionNameFor("1st")).toBe("decide_1st");
  });

  it("puts the option list in the schema enum", () => {
    const schema = buildDecisionFunction(request);
    expect(
      (schema.parameters.properties["choice"] as { enum: string[] }).enum,
    ).toEqual(["pass", "review", "block"]);
  });

  it("requires the answer, the confidence and the reason", () => {
    const schema = buildDecisionFunction(request);
    expect(schema.parameters.required).toEqual([
      "choice",
      "confidence",
      "reason",
    ]);
  });

  it("uses the domain property name when the question sets one", () => {
    const schema = buildDecisionFunction({
      state: "x",
      question: {
        id: "incident",
        kind: "choice",
        instructions: "Classify a DevOps incident",
        options: ["infrastructure", "network", "application"],
        resultProperty: "category",
      },
    });
    expect(
      (schema.parameters.properties["category"] as { enum: string[] }).enum,
    ).toEqual(["infrastructure", "network", "application"]);
  });

  it("adapts a text batch to one call per question and aggregates usage", async () => {
    const provider = new MiniMaxDecisionProvider({
      apiHost: baseUrl,
      apiKey: "test-key",
    });
    const before = requestCount;
    const result = await provider.decideMany({
      input: [{ type: "text", text: "shared context" }],
      questions: [
        {
          question: {
            id: "one",
            kind: "choice",
            instructions: "Pick one",
            options: ["block", "pass"],
          },
        },
        {
          question: {
            id: "two",
            kind: "choice",
            instructions: "Pick two",
            options: ["block", "pass"],
          },
        },
      ],
    });
    expect(requestCount - before).toBe(2);
    expect(
      result.answers.map((item) =>
        item.answer?.value.kind === "choice" ? item.answer.value.option : null,
      ),
    ).toEqual(["block", "block"]);
    expect(result.usage).toEqual({ input: 982, output: 1196 });
  });

  it("sends the function as a tool and forces it", async () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    await p.decide(request);
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.tools[0].function.name).toBe("qa_triage");
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "qa_triage" },
    });
  });

  it("maps the tool call argument onto the option name", async () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer?.value.kind === "choice" ? answer.value.option : null).toBe(
      "block",
    );
  });

  it("uses the self-reported confidence", async () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer?.confidence).toBeCloseTo(0.93, 5);
  });

  it("labels the confidence source as self-reported", async () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer?.confidenceSource).toBe("self_reported");
  });

  it("keeps the model's reason for the decision", async () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer?.reason).toContain("subtitle band");
  });

  it("returns null when the answer names an option that was not offered", async () => {
    responseBody = toolCallResponse({
      choice: "explode",
      confidence: 0.9,
      reason: "nope",
    });
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer).toBeNull();
    responseBody = toolCallResponse({
      choice: "block",
      confidence: 0.93,
      reason: "The caption covers the subtitle band.",
    });
  });

  it("returns null when the answer carries no tool call", async () => {
    responseBody = { choices: [{ message: { content: "block" } }] };
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide(request);
    expect(answer).toBeNull();
    responseBody = toolCallResponse({
      choice: "block",
      confidence: 0.93,
      reason: "The caption covers the subtitle band.",
    });
  });

  it("turns repeated samples into a vote distribution", async () => {
    let calls = 0;
    const voting = createServer((req: IncomingMessage, res: ServerResponse) => {
      calls += 1;
      req.on("data", () => undefined);
      req.on("end", () => {
        const choice = calls === 1 ? "pass" : "block";
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            toolCallResponse({ choice, confidence: 0.9, reason: "r" }),
          ),
        );
      });
    });
    const url = await listen(voting);
    const p = new MiniMaxDecisionProvider({
      apiHost: url,
      apiKey: "k",
      samples: 2,
    });
    const answer = await p.decide(request);
    expect(answer?.confidenceSource).toBe("vote");
    await new Promise<void>((r) => voting.close(() => r()));
  });

  it("reports the vote share as the confidence", async () => {
    let calls = 0;
    const voting = createServer((req: IncomingMessage, res: ServerResponse) => {
      calls += 1;
      req.on("data", () => undefined);
      req.on("end", () => {
        const choice = calls === 1 ? "pass" : "block";
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            toolCallResponse({ choice, confidence: 0.9, reason: "r" }),
          ),
        );
      });
    });
    const url = await listen(voting);
    const p = new MiniMaxDecisionProvider({
      apiHost: url,
      apiKey: "k",
      samples: 2,
    });
    const answer = await p.decide(request);
    expect(answer?.confidence).toBeCloseTo(0.5, 5);
    await new Promise<void>((r) => voting.close(() => r()));
  });

  it("reads a noul answer as a probability", async () => {
    responseBody = toolCallResponse({
      verdict: true,
      probability: 0.9,
      confidence: 0.95,
      reason: "The caption covers the subtitle band.",
    });
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "k" });
    const answer = await p.decide({
      state: "the caption overlaps the subtitle band",
      question: {
        id: "overlap",
        kind: "noul",
        instructions: "Does the caption overlap the subtitle band?",
      },
    });
    expect(
      answer?.value.kind === "noul" ? answer.value.probability : null,
    ).toBe(0.9);
    responseBody = toolCallResponse({
      choice: "block",
      confidence: 0.93,
      reason: "The caption covers the subtitle band.",
    });
  });

  it("reports itself unavailable without an API key", () => {
    const p = new MiniMaxDecisionProvider({ apiHost: baseUrl, apiKey: "" });
    expect(p.available()).toBe(false);
  });
});
