import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIDecisionProvider } from "./openai.js";
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

describe("OpenAIDecisionProvider", () => {
  let server: Server;
  let baseUrl: string;
  let lastBody: string | undefined;
  let lastUrl: string | undefined;
  let statusToSend = 200;
  let responseBody: unknown = {
    model: "gpt-6-luna",
    answers: [
      {
        type: "choice",
        name: "qa-triage",
        choice: "block",
        probabilities: [
          { value: "pass", probability: 0.07 },
          { value: "review", probability: 0.07 },
          { value: "block", probability: 0.86 },
        ],
        confidence: 0.72,
      },
    ],
    usage: { input_tokens: 125, output_tokens: 0 },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      lastUrl = req.url;
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = statusToSend;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    baseUrl = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("calls the decisions endpoint", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    await p.decide(request);
    expect(lastUrl).toBe("/decisions");
  });

  it("sends the state as the input", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    await p.decide(request);
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.input).toContain("frame 12");
  });

  it("sends the option list as the question choices", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    await p.decide(request);
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.questions[0].choices).toEqual([
      { value: "pass" },
      { value: "review" },
      { value: "block" },
    ]);
  });

  it("names the question after its id", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    await p.decide(request);
    const body = JSON.parse(lastBody ?? "{}");
    expect(body.questions[0].name).toBe("qa-triage");
  });

  it("maps the answer onto the option name", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer?.value.kind === "choice" ? answer.value.option : null).toBe(
      "block",
    );
  });

  it("keeps the probability distribution", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(
      answer?.value.kind === "choice"
        ? answer.value.probabilities?.["block"]
        : null,
    ).toBeCloseTo(0.86, 5);
  });

  it("uses the confidence the API reported", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer?.confidence).toBeCloseTo(0.72, 5);
  });

  it("labels the confidence source as native", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer?.confidenceSource).toBe("native");
  });

  it("returns null when the answer is below minConfidence", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide({ ...request, minConfidence: 0.9 });
    expect(answer).toBeNull();
  });

  it("records the token usage of the call", async () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer?.usage.input).toBe(125);
  });

  it("reads a predicate answer as a noul probability", async () => {
    responseBody = {
      model: "gpt-6-luna",
      answers: [{ type: "predicate", name: "q", probability: 0.97 }],
      usage: { input_tokens: 161, output_tokens: 0 },
    };
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide({
      state: "the caption overlaps the subtitle band",
      question: {
        id: "q",
        kind: "noul",
        instructions: "The caption overlaps the subtitle band.",
      },
    });
    expect(answer?.value.kind === "noul" ? answer.value.probability : null).toBe(
      0.97,
    );
    responseBody = {
      model: "gpt-6-luna",
      answers: [
        {
          type: "choice",
          name: "qa-triage",
          choice: "block",
          probabilities: [
            { value: "pass", probability: 0.07 },
            { value: "review", probability: 0.07 },
            { value: "block", probability: 0.86 },
          ],
          confidence: 0.72,
        },
      ],
      usage: { input_tokens: 125, output_tokens: 0 },
    };
  });

  it("reads a score answer as a weighted score", async () => {
    responseBody = {
      model: "gpt-6-luna",
      answers: [
        {
          type: "score",
          name: "q",
          score: 0.1,
          probabilities: [
            { value: 0, label: "cosmetic", probability: 0.9 },
            { value: 1, label: "blocking", probability: 0.1 },
          ],
          confidence: 0.8,
        },
      ],
      usage: { input_tokens: 112, output_tokens: 0 },
    };
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide({
      state: "the caption overlaps the subtitle band",
      question: {
        id: "q",
        kind: "score",
        instructions: "How severe is it?",
        levels: ["cosmetic", "blocking"],
      },
    });
    expect(answer?.value.kind === "score" ? answer.value.score : null).toBe(
      0.1,
    );
    responseBody = {
      model: "gpt-6-luna",
      answers: [
        {
          type: "choice",
          name: "qa-triage",
          choice: "block",
          probabilities: [
            { value: "pass", probability: 0.07 },
            { value: "review", probability: 0.07 },
            { value: "block", probability: 0.86 },
          ],
          confidence: 0.72,
        },
      ],
      usage: { input_tokens: 125, output_tokens: 0 },
    };
  });

  it("returns null when the answer does not match the question type", async () => {
    responseBody = {
      model: "gpt-6-luna",
      answers: [{ type: "predicate", name: "q", probability: 0.9 }],
      usage: { input_tokens: 100, output_tokens: 0 },
    };
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer).toBeNull();
    responseBody = {
      model: "gpt-6-luna",
      answers: [
        {
          type: "choice",
          name: "qa-triage",
          choice: "block",
          probabilities: [
            { value: "pass", probability: 0.07 },
            { value: "review", probability: 0.07 },
            { value: "block", probability: 0.86 },
          ],
          confidence: 0.72,
        },
      ],
      usage: { input_tokens: 125, output_tokens: 0 },
    };
  });

  it("returns null and keeps the error when the API fails", async () => {
    statusToSend = 500;
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    const answer = await p.decide(request);
    expect(answer).toBeNull();
    statusToSend = 200;
  });

  it("records the failure on lastError", async () => {
    statusToSend = 500;
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "test-key" });
    await p.decide(request);
    expect(p.lastError?.message).toContain("OpenAI Decisions API 500");
    statusToSend = 200;
  });

  it("reports itself unavailable without an API key", () => {
    const p = new OpenAIDecisionProvider({ baseUrl, apiKey: "" });
    expect(p.available()).toBe(false);
  });
});
