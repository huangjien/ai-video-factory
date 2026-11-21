import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectDecision,
  loadDecisionInspectRequest,
} from "./decision-inspect.js";
import type { DecisionProvider } from "@video/llm";

describe("loadDecisionInspectRequest", () => {
  it("keeps the documented text-only example valid", async () => {
    const loaded = await loadDecisionInspectRequest(
      path.resolve("docs/examples/decision-inspect-text.yaml"),
    );
    expect(loaded.request.questions.map(({ question }) => question.id)).toEqual(
      ["explicit_refund_request", "request_type"],
    );
  });

  it("loads relative PDF paths and computes metadata without exposing bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "decision-inspect-"));
    await mkdir(path.join(root, "files"));
    await writeFile(
      path.join(root, "files", "contract.pdf"),
      "private-pdf-bytes",
    );
    const requestPath = path.join(root, "request.yaml");
    await writeFile(
      requestPath,
      [
        "input:",
        "  - type: text",
        "    text: Assess the contract",
        "  - type: document",
        "    path: ./files/contract.pdf",
        "questions:",
        "  - id: clause",
        "    kind: noul",
        "    instructions: Does it contain the clause?",
      ].join("\n"),
    );
    const loaded = await loadDecisionInspectRequest(requestPath);
    expect(loaded.request.input[1]).toMatchObject({
      type: "document",
      mimeType: "application/pdf",
      name: "contract.pdf",
    });
    expect(loaded.attachments[0]?.bytes).toBe("private-pdf-bytes".length);
    expect(JSON.stringify(loaded.attachments)).not.toContain(
      "private-pdf-bytes",
    );
    expect(loaded.request.questions[0]?.question.id).toBe("clause");
  });

  it("rejects unknown media types and repeated question IDs", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "decision-inspect-invalid-"),
    );
    const requestPath = path.join(root, "request.yaml");
    await writeFile(
      requestPath,
      [
        "input:",
        "  - type: text",
        "    text: hello",
        "questions:",
        "  - id: same",
        "    kind: noul",
        "    instructions: question one",
        "  - id: same",
        "    kind: noul",
        "    instructions: question two",
      ].join("\n"),
    );
    await expect(loadDecisionInspectRequest(requestPath)).rejects.toThrow(
      /duplicate/,
    );
  });

  it("rejects an unknown attachment MIME before a provider call", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "decision-inspect-mime-"),
    );
    const filePath = path.join(root, "attachment.unknown");
    await writeFile(filePath, "bytes");
    const requestPath = path.join(root, "request.yaml");
    await writeFile(
      requestPath,
      [
        "input:",
        "  - type: image",
        "    path: ./attachment.unknown",
        "questions:",
        "  - id: exists",
        "    kind: noul",
        "    instructions: Does it exist?",
      ].join("\n"),
    );
    await expect(loadDecisionInspectRequest(requestPath)).rejects.toThrow(
      /MIME type/,
    );
  });
});

describe("inspectDecision", () => {
  it("returns structured answers and attachment metadata, not input content", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "decision-inspect-call-"),
    );
    const requestPath = path.join(root, "request.yaml");
    await writeFile(
      requestPath,
      [
        "input:",
        "  - type: text",
        "    text: secret-context-text",
        "questions:",
        "  - id: exists",
        "    kind: noul",
        "    instructions: Does it exist?",
      ].join("\n"),
    );
    let calls = 0;
    const provider: DecisionProvider = {
      name: "fake",
      supportedModalities: ["text"],
      available: () => true,
      lastError: null,
      async decide() {
        return null;
      },
      async decideMany(req) {
        calls += 1;
        expect(req.input).toEqual([
          { type: "text", text: "secret-context-text" },
        ]);
        return {
          answers: [
            {
              questionId: "exists",
              answer: {
                value: { kind: "noul", probability: 0.9 },
                confidence: 0.9,
                confidenceSource: "native",
                usage: { input: 0, output: 0 },
                latencyMs: 7,
                provider: "fake",
                model: "fake-model",
              },
              error: null,
            },
          ],
          provider: "fake",
          model: "fake-model",
          usage: { input: 12, output: 0 },
          latencyMs: 7,
        };
      },
    };
    const result = await inspectDecision({ requestPath, provider });
    expect(calls).toBe(1);
    expect(result.answers[0]?.answer).toBe("0.9");
    expect(JSON.stringify(result)).not.toContain("secret-context-text");
  });
});
