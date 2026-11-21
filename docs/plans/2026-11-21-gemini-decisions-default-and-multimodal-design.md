# Gemini Decisions API as the default decision provider (2026-11-21)

## Goal

Make Gemini Decisions API the default provider for the shared decision layer and expose the API's high-volume, shared-context, multimodal capabilities to the repository's workflows and CLI.

## Current limitations

- `createDecisionProvider()` defaults to OpenAI → MiniMax. Google is only available through explicit selection.
- `DecisionRequest` carries one question and serializable text state. The Google provider serializes that state to a string and submits one question.
- Prompt evaluation scores each rubric axis with a separate call. QA triage also consults once per finding.
- There is no general CLI surface for structured decisions over local images, audio, video, or PDF files.

## Provider routing

- Change the default chain to Google → OpenAI → MiniMax. Existing `DECISION_PROVIDER` and model overrides remain supported.
- Preserve the current fallback rule: continue to the next provider only when the current provider is unavailable or fails at the service level. A malformed/partial answer is a quality signal and does not get silently replaced.
- Providers declare supported input modalities and batch capability. A request is sent only to a provider that supports its input; an unsupported media request is never converted to text as an implicit fallback.
- Gemini remains the native multi-question, multimodal primary. OpenAI Decisions supports batch questions and can act as a text fallback; MiniMax remains the single-question text fallback.

## Decision contract

- Preserve `decide(request)` as the one-question compatibility surface.
- Add `DecisionBatchRequest` with one ordered shared `input` and 1–1000 unique-ID questions. Each question is a `DecisionQuestion` plus optional `minConfidence`; duplicate IDs are rejected before provider calls.
- `DecisionInputPart` is a discriminated union: `{type:"text", text}` or `{type:"image"|"audio"|"video"|"document", mimeType, data: Uint8Array}`. The CLI accepts local paths and reads bytes; provider adapters own API-specific serialization. Initial media scope is PDF for `document`; arbitrary office files and remote URLs are out of scope.
- `DecisionBatchResult` has an ordered `answers` array (`questionId`, normalized answer or null, error or null) and one request-level metadata object (`provider`, `model`, total usage, total latency). Request-level usage is recorded once, never copied and summed once per answer.
- Add `decideMany(request)` to the provider contract. Google submits one native `/v1beta/decisions` request. OpenAI uses one native batch request for text. MiniMax implements a text-only adapter with one call per question. The existing `decide(request)` API remains and is equivalent to a one-question request.
- Missing IDs, duplicate/invalid answers, and low-confidence answers occupy their question's null slot. They do not trigger provider switching. A service failure can retry the whole batch at the next compatible provider; the log identifies this fallback.
- Google validates the documented 1,000-question ceiling locally. The API remains authoritative for content/token limits; a provider size rejection is returned as a request failure rather than attempting a potentially lossy input truncation. One batch always means one shared input, never unrelated files bundled as if they were shared context.

### Provider capability and fallback contract

| Provider | Default order | Input support in this change | Batch behavior |
|---|---:|---|---|
| Google Gemini Decisions | 1 | text, image, audio, video, PDF | native shared-input batch |
| OpenAI Decisions | 2 | text | native shared-input batch |
| MiniMax | 3 | text | sequential single-question adapter |

`auto` skips unavailable providers and providers that cannot represent the request input. It falls through on request/service failure only. Explicit provider selection stays pinned: unsupported input or service failure returns a diagnostic/null result instead of silently switching providers. `DECISION_PROVIDER` and `DECISION_MODEL` remain honored.

### Inspect request format

`video decision inspect --request <yaml> [--json]` accepts a YAML document with `input` blocks and `questions`. A media block uses `path` relative to the YAML file; optional `mimeType` overrides extension detection. The CLI validates the file, MIME type, and question IDs before making a request. It prints answers and metadata; it does not persist request bodies or media bytes.

```yaml
input:
  - type: text
    text: "判断合同是否包含可单方退款条款。"
  - type: document
    path: ./合同.pdf
questions:
  - id: refund_clause
    kind: noul
    instructions: "合同是否明确授予客户单方退款权？"
    trueMeaning: "存在明确的单方退款权"
    falseMeaning: "不存在，或文本不足以确认"
```

## CLI and workflow integration

- Add `video decision inspect --request <yaml>` for explicit, user-initiated structured decisions over local media and text. The YAML request supports text blocks, local attachment paths, and multiple `noul`, `choice`, or `score` questions. The command prints structured answers and confidence; it does not trigger follow-up actions.
- Batch prompt-eval rubric axes against the same output in one shared-input request.
- Batch QA triage findings against one report context, with one question per finding. Attach answers as advisory metadata; the existing deterministic levels and gates remain authoritative.
- Existing decision surfaces continue recording baselines and decisions in shadow/advisory form. `DECISION_MODE` behavior does not change.

## Failure and data handling

- Service outage may fall through to the next compatible provider. Unsupported modalities, invalid answers, or missing question IDs produce null results with diagnostics.
- Local file paths are resolved by the CLI; the LLM provider receives only MIME-tagged content or a supported URI. Logs retain filenames, MIME types, input digests, and answers, never raw media or base64.
- `inspect` is explicit because it transmits selected local media to the configured external provider and incurs API usage.

## Verification plan

- Provider routing: default is Google → OpenAI → MiniMax; explicit provider/model overrides still work.
- Provider contract: legacy `decide` remains compatible; mixed question types map back by ID; native Google batch issues one request; malformed/partial answers remain null.
- Media: request construction supports text plus image/audio/video/PDF blocks and rejects unsupported provider/media combinations without sending an altered request.
- Integrations: prompt-eval calls once for multiple axes; QA uses one shared report input and maps answers back to findings; inspect parses request YAML and outputs structured answers without writing raw media to logs.
- Run package builds and focused provider/decision-surface tests; no live paid request is needed for automated tests.

## Delivery plan

The implementation checklist, stable task IDs, dependencies, affected files, and acceptance checks are in [the implementation plan](./2026-11-21-gemini-decisions-implementation-plan.md). The checklist is the source of delivery status; this document is the design contract.

## Source

- [Gemini Decisions API reference](https://ai.google.dev/api/decisions)
- [Gemini Decisions API announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/)
