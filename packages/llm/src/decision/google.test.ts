import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleDecisionProvider } from "./google.js";
import type { DecisionRequest } from "./contract.js";

const request: DecisionRequest = {
  state: "A golden retriever is playing fetch in a park.",
  question: {
    id: "animal",
    kind: "choice",
    instructions: "Which animal is described?",
    options: ["dog", "cat", "bird"],
    optionHints: { dog: "A dog.", cat: "A cat.", bird: "A bird." },
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

describe("GoogleDecisionProvider", () => {
  let server: Server;
  let baseUrl: string;
  let lastBody = "";
  let lastUrl: string | undefined;
  let lastApiKey: string | undefined;
  let requestCount = 0;
  let statusToSend = 200;
  let responseBody: unknown = {
    model: "gemini-decision-1",
    answers: {
      animal: {
        type: "choice",
        choice: "dog",
        confidence: 0.996,
        probabilities: { dog: 0.996, cat: 0.001, bird: 0.003 },
      },
    },
    usage: { total_input_tokens: 109, total_output_tokens: 0 },
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      requestCount += 1;
      const chunks: Buffer[] = [];
      lastUrl = req.url;
      const apiKeyHeader = req.headers["x-goog-api-key"];
      lastApiKey = typeof apiKeyHeader === "string" ? apiKeyHeader : undefined;
      req.on("data", (chunk) => chunks.push(chunk));
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("calls the v1beta decisions endpoint with the API key header", async () => {
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    await provider.decide(request);
    expect(lastUrl).toBe("/decisions");
    expect(lastApiKey).toBe("test-key");
  });

  it("sends the text and named choice criteria", async () => {
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    await provider.decide(request);
    const body = JSON.parse(lastBody) as Record<string, any>;
    expect(body.model).toBe("gemini-decision-1");
    expect(body.input).toEqual([
      { type: "text", text: "A golden retriever is playing fetch in a park." },
    ]);
    expect(body.questions.animal).toEqual({
      type: "choice",
      instructions: "Which animal is described?",
      criteria: { dog: "A dog.", cat: "A cat.", bird: "A bird." },
    });
  });

  it("sends mixed media and questions in one request and maps answers by id", async () => {
    responseBody = {
      model: "gemini-decision-1",
      answers: {
        safe: { type: "noul", noul: 0.8, confidence: 0.8 },
        category: { type: "choice", choice: "spill", confidence: 0.9 },
      },
      usage: { total_input_tokens: 250, total_output_tokens: 0 },
    };
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    const before = requestCount;
    const result = await provider.decideMany({
      input: [
        { type: "text", text: "Counter photo" },
        { type: "image", mimeType: "image/png", data: Buffer.from("image") },
        { type: "audio", mimeType: "audio/wav", data: Buffer.from("audio") },
        { type: "video", mimeType: "video/mp4", data: Buffer.from("video") },
        {
          type: "document",
          mimeType: "application/pdf",
          data: Buffer.from("pdf"),
        },
      ],
      questions: [
        { question: { id: "safe", kind: "noul", instructions: "Is it safe?" } },
        {
          question: {
            id: "category",
            kind: "choice",
            instructions: "Classify it",
            options: ["spill", "clear"],
          },
        },
      ],
    });
    const body = JSON.parse(lastBody) as Record<string, any>;
    expect(requestCount - before).toBe(1);
    expect(body.input[1]).toEqual({
      type: "image",
      data: Buffer.from("image").toString("base64"),
      mime_type: "image/png",
    });
    expect(
      body.input
        .slice(2)
        .map((part: Record<string, string>) => [part.type, part.mime_type]),
    ).toEqual([
      ["audio", "audio/wav"],
      ["video", "video/mp4"],
      ["document", "application/pdf"],
    ]);
    expect(result.answers.map((answer) => answer.questionId)).toEqual([
      "safe",
      "category",
    ]);
    expect(result.answers[1]?.answer?.value).toEqual({
      kind: "choice",
      option: "spill",
    });
    expect(result.usage).toEqual({ input: 250, output: 0 });
    expect(result.answers[0]?.answer?.usage).toEqual({ input: 0, output: 0 });
    responseBody = {
      model: "gemini-decision-1",
      answers: {
        animal: {
          type: "choice",
          choice: "dog",
          confidence: 0.996,
          probabilities: { dog: 0.996, cat: 0.001, bird: 0.003 },
        },
      },
      usage: { total_input_tokens: 109, total_output_tokens: 0 },
    };
  });

  it("maps native choice probabilities and usage", async () => {
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    const answer = await provider.decide(request);
    expect(answer?.value).toEqual({
      kind: "choice",
      option: "dog",
      probabilities: { dog: 0.996, cat: 0.001, bird: 0.003 },
    });
    expect(answer?.confidence).toBe(0.996);
    expect(answer?.confidenceSource).toBe("native");
    expect(answer?.usage).toEqual({ input: 109, output: 0 });
  });

  it("maps noul probabilities and true/false criteria", async () => {
    responseBody = {
      answers: { safe: { type: "noul", noul: 0.92, confidence: 0.92 } },
      usage: { total_input_tokens: 40, total_output_tokens: 0 },
    };
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    const answer = await provider.decide({
      state: "clean frame",
      question: {
        id: "safe",
        kind: "noul",
        instructions: "Is this safe?",
        trueMeaning: "No text overlaps.",
        falseMeaning: "Text overlaps.",
      },
    });
    expect(answer?.value).toEqual({ kind: "noul", probability: 0.92 });
    expect(JSON.parse(lastBody).questions.safe.criteria).toEqual({
      true_description: "No text overlaps.",
      false_description: "Text overlaps.",
    });
    responseBody = {
      model: "gemini-decision-1",
      answers: {
        animal: {
          type: "choice",
          choice: "dog",
          confidence: 0.996,
          probabilities: { dog: 0.996, cat: 0.001, bird: 0.003 },
        },
      },
      usage: { total_input_tokens: 109, total_output_tokens: 0 },
    };
  });

  it("maps score output and derives the level legend", async () => {
    responseBody = {
      answers: { urgency: { type: "score", score: 0.25, confidence: 0.8 } },
      usage: { total_input_tokens: 50, total_output_tokens: 0 },
    };
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    const answer = await provider.decide({
      state: "routine request",
      question: {
        id: "urgency",
        kind: "score",
        instructions: "Rate urgency",
        levels: ["low", "high"],
      },
    });
    expect(answer?.value).toEqual({
      kind: "score",
      score: 0.25,
      legend: { "0": "low", "1": "high" },
    });
    expect(JSON.parse(lastBody).questions.urgency.criteria).toEqual([
      "low",
      "high",
    ]);
    responseBody = {
      model: "gemini-decision-1",
      answers: {
        animal: {
          type: "choice",
          choice: "dog",
          confidence: 0.996,
          probabilities: { dog: 0.996, cat: 0.001, bird: 0.003 },
        },
      },
      usage: { total_input_tokens: 109, total_output_tokens: 0 },
    };
  });

  it("returns null below minConfidence and records API failures", async () => {
    const provider = new GoogleDecisionProvider({
      baseUrl,
      apiKey: "test-key",
    });
    expect(await provider.decide({ ...request, minConfidence: 1 })).toBeNull();
    statusToSend = 402;
    expect(await provider.decide(request)).toBeNull();
    expect(provider.lastError?.message).toContain("Google Decisions API 402");
    statusToSend = 200;
    expect(await provider.decide(request)).not.toBeNull();
    expect(provider.lastError).toBeNull();
  });

  it("reports unavailable without a key", () => {
    expect(
      new GoogleDecisionProvider({ baseUrl, apiKey: "" }).available(),
    ).toBe(false);
  });
});
