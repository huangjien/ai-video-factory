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
- Add a shared-input batch request: an ordered content-block input plus 1–1000 independently typed questions. Each question retains its own ID, kind, instructions, criteria, and optional minimum confidence.
- Support content blocks for text, image, audio, video, and PDF/document. A media block carries a MIME type and either bytes/base64 or a URI. Raw media bytes are not included in decision logs.
- Add a batch method to decision providers. Google submits all questions in one `/v1beta/decisions` call; OpenAI may submit its batch in one call; MiniMax adapts by making one text-only call per question.
- Return one answer/error slot per question, including provider/model, confidence source, usage and latency. Missing or invalid answers remain null and do not cause per-question provider switching.
- Enforce the Google API's 1,000-question and input-size limits before sending a request. The batch unit is one shared input; this does not batch independent media files into a single request.

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

## Source

- [Gemini Decisions API reference](https://ai.google.dev/api/decisions)
- [Gemini Decisions API announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/)
