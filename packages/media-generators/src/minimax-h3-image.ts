import { withRetry } from "@video/llm";
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./image.js";

export interface MiniMaxH3ImageProviderOptions {
  apiHost?: string | undefined;
  /** `MiniMax-H3-Image` (quality) or `MiniMax-H3-Image-Highspeed` (same
   *  parameters, faster, ~1.6–2× the price). Default: the quality model. */
  model?: string | undefined;
  /** Let the API rewrite the prompt before generating (its default is
   *  enhancement ON; the rewritten text comes back as `revised_prompt`,
   *  and the rewritten text is what the model actually draws from).
   *  Default FALSE — the same policy as the image-01 provider: our brief
   *  is deliberately composed (palette lock, reserved overlay zone, era
   *  constraints) and must reach the model as written. Note the API's
   *  own trade-off: with enhancement disabled, only the first ~4096
   *  tokens of the prompt take effect.
   *
   *  This is the quality dial for `constraintGuard` below: enhancement
   *  ON reads better (the 2026-11-14 A/B preferred it), enhancement OFF
   *  guarantees the constraints verbatim. The guard reconciles the two. */
  disablePromptEnhanced?: boolean | undefined;
  /** Strings that MUST survive into `revised_prompt` when enhancement is
   *  on — palette hex codes, "no text", the reserved overlay zone. When
   *  the rewrite drops one, the provider retries ONCE with enhancement
   *  disabled (our verbatim brief, constraints guaranteed) and uses that
   *  image instead. Default: auto-extracted from the prompt — every
   *  #RRGGBB hex code, plus "no text" when the prompt says it. Pass an
   *  empty array to disable the guard. */
  constraintGuard?: string[] | undefined;
  /** Hard ceiling on a single in-flight HTTP request. Default 180 s —
   *  H3 at 4K generates noticeably slower than image-01. */
  requestTimeoutMs?: number | undefined;
  retrySleeps?: number[] | undefined;
}

/** H3 Image models. Both take identical parameters. */
export const MINIMAX_H3_MODELS = [
  "MiniMax-H3-Image",
  "MiniMax-H3-Image-Highspeed",
] as const;

const DEFAULT_MODEL = "MiniMax-H3-Image";
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

/** Output pixel area bounds the API enforces on `size` (platform.minimax.io
 *  OpenAPI h3-image-generations.json + guides/image-generation#output-size,
 *  read 2026-11-15). Outside the bounds (or ratio beyond 1:3–3:1) the API
 *  returns 400 and "the size is never scaled or rounded" — so the check
 *  happens here, before the spend. */
const MIN_AREA_PX = 655_360;
const MAX_AREA_PX = 20_000_000;

/** `image-01` accepted ≤1500 chars; H3 accepts ≤32000 (Unicode chars).
 *  Prompts are expanded briefs — the cap is the API's, the check is ours. */
const MAX_PROMPT_CHARS = 32_000;

/** One reference image for an edit request. `base64` is the raw Base64
 *  body (no `data:` prefix); `contentType` is `image/jpeg`-style. */
export interface H3ReferenceImage {
  base64: string;
  contentType: string;
}

interface H3ImageData {
  url?: string;
  b64_json?: string;
  size?: string;
  revised_prompt?: string;
  error?: { message?: string; code?: string };
}

interface H3ImagesResponse {
  created?: number;
  data?: H3ImageData[];
  usage?: {
    generated_images?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  output_format?: string;
  request_id?: string;
  /** Legacy envelope — H3 uses OpenAI-style HTTP errors, but a defensive
   *  check costs one branch (the old image-01 endpoint reported quota and
   *  auth failures inside a 200 via base_resp). */
  base_resp?: { status_code?: number; status_msg?: string };
}

/**
 * MiniMax H3 Image — generation AND editing
 * (platform.minimax.io OpenAPI h3-image-generations.json / h3-image-edits.json,
 * verified against the live API 2026-11-15).
 *
 * Two endpoints, same provider:
 *  - generate (no references): POST `/v1/images/generations` — text-to-image;
 *  - edit (references present): POST `/v1/images/edits` — the reference
 *    images are sent as `data:image/<format>;base64,<b64>` data URIs
 *    (1–16 refs, body ≤ 64 MiB, dims 128–8192 px, ratio ≤ 4:1).
 *
 * Size: the request carries the EXACT pixel size (`size: "WxH"`); the API
 * never scales or rounds it, and rejects areas outside 655,360–20,000,000 px
 * or ratios beyond 1:3–3:1 — both validated here first. 1280×720 thumbnails
 * and 1920×1080 scenes both sit inside the bounds.
 *
 * Cost control is the caller's, via the size it asks for: pricing is
 * token-based ($2.30/M text-in, $1.50/M image-in, $3.80/M image-out for the
 * Standard model — platform.minimax.io/docs/pricing/overview, read
 * 2026-11-15), and the measured probe (1K-area t2i) reported 1817 text-in +
 * 4056 image-out tokens ≈ $0.02/image. The API's own default `area` is 4K —
 * passing the exact size avoids accidentally paying for pixels nobody uses.
 *
 * Auth: the same `MINIMAX_API_KEY` as the chat/image-01 endpoints, and the
 * probe succeeded while the chat Token Plan quota was exhausted — image
 * generation bills separately.
 */
/** Extract the constraint markers a prompt itself declares: every
 *  #RRGGBB hex code (the palette lock), and "no text" when present (the
 *  reserved caption band). Case-insensitive matching downstream — the
 *  rewrite may recase. */
export function autoConstraintMarkers(prompt: string): string[] {
  const markers: string[] = [];
  for (const m of prompt.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
    const hex = m[0];
    if (hex !== undefined && !markers.includes(hex.toUpperCase())) {
      markers.push(hex);
    }
  }
  if (/\bno text\b/i.test(prompt)) markers.push("no text");
  return markers;
}

export class MiniMaxH3ImageProvider implements ImageProvider {
  readonly name = "minimax-h3";
  private readonly apiHost: string;
  private readonly model: string;
  private readonly requestTimeoutMs: number;
  private readonly retrySleeps: number[];

  private readonly disablePromptEnhanced: boolean;
  private readonly constraintGuard: string[] | null;

  constructor(opts: MiniMaxH3ImageProviderOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.model = opts.model ?? DEFAULT_MODEL;
    this.disablePromptEnhanced = opts.disablePromptEnhanced ?? false;
    this.constraintGuard = opts.constraintGuard ?? null;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      throw new ImageGenerationError(
        "MINIMAX_API_KEY not set in environment",
        this.name,
      );
    }
    if (req.prompt.length > MAX_PROMPT_CHARS) {
      throw new ImageGenerationError(
        `prompt is ${req.prompt.length} characters; the H3 image API accepts at most ${MAX_PROMPT_CHARS}`,
        this.name,
      );
    }
    const area = req.width * req.height;
    if (area < MIN_AREA_PX || area > MAX_AREA_PX) {
      throw new ImageGenerationError(
        `requested size ${req.width}x${req.height} is ${area} px; the H3 image API accepts ${MIN_AREA_PX}–${MAX_AREA_PX} px`,
        this.name,
      );
    }
    const ratio = Math.max(req.width, req.height) / Math.min(req.width, req.height);
    if (ratio > 3) {
      throw new ImageGenerationError(
        `requested size ${req.width}x${req.height} has a ratio beyond 3:1; the H3 image API accepts 1:3–3:1`,
        this.name,
      );
    }

    const references = req.referenceImages ?? [];
    const endpoint = references.length > 0 ? "edits" : "generations";
    const guardMarkers =
      this.constraintGuard ?? autoConstraintMarkers(req.prompt);
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      size: `${req.width}x${req.height}`,
      n: 1,
      output_format: "jpeg",
      // Sent explicitly rather than omitted — the same policy as the
      // image-01 provider's prompt_optimizer: a server default moving
      // must not silently start rewriting a composed brief.
      disable_prompt_enhanced: this.disablePromptEnhanced,
      // Self-contained like the image-01 provider: the bytes come back in
      // the response instead of a URL that has to be fetched separately.
      response_format: "b64_json",
    };
    if (references.length > 0) {
      body["images"] = references.map((ref) => ({
        image_url: `data:${ref.contentType};base64,${ref.base64}`,
      }));
    }

    const callOnce = async (): Promise<H3ImagesResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let res: Response;
        try {
          res = await fetch(`${this.apiHost}/v1/images/${endpoint}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          if ((err as { name?: string }).name === "AbortError") {
            const e = new ImageGenerationError(
              `MiniMax H3 image request timed out after ${this.requestTimeoutMs}ms`,
              this.name,
            );
            (e as ImageGenerationError & { timeoutMs: number }).timeoutMs =
              this.requestTimeoutMs;
            throw e;
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
        const text = await res.text();
        if (!res.ok) {
          const excerpt = text.slice(0, 200);
          const err = new ImageGenerationError(
            `MiniMax H3 image API ${res.status}: ${excerpt.slice(0, 80)}`,
            this.name,
          );
          (err as ImageGenerationError & { status: number }).status = res.status;
          (
            err as ImageGenerationError & { body_excerpt: string }
          ).body_excerpt = excerpt;
          throw err;
        }
        return JSON.parse(text) as H3ImagesResponse;
    };

    let data = await withRetry(callOnce, {
        // Retry transient/network failures; never a 4xx (the client's own
        // bad request will not improve) and never a client-side timeout
        // (each attempt re-spends; a hung connection is reported instead).
        isRetriable: (err) =>
          !/MiniMax H3 image API (?:4\d\d|request timed out)/.test(String(err)),
        sleeps: this.retrySleeps,
      });

    // The constraint guard: enhancement rewrites the prompt, and the
    // rewritten text is what the model drew from. If the rewrite dropped
    // a hard constraint, re-generate ONCE with our verbatim brief
    // (enhancement off — constraints guaranteed, the older look).
    if (
      !this.disablePromptEnhanced &&
      guardMarkers.length > 0 &&
      data.data?.[0]?.revised_prompt !== undefined
    ) {
      const revised = data.data[0]!.revised_prompt ?? "";
      const dropped = guardMarkers.filter(
        (marker: string) => !revised.toLowerCase().includes(marker.toLowerCase()),
      );
      if (dropped.length > 0) {
        console.error(
          `  H3 prompt enhancement dropped ${dropped.length} constraint marker(s) (${dropped.join(", ").slice(0, 80)}) — regenerating with the verbatim brief`,
        );
        body["disable_prompt_enhanced"] = true;
        data = await withRetry(callOnce, {
          isRetriable: (err) =>
            !/MiniMax H3 image API (?:4\d\d|request timed out)/.test(String(err)),
          sleeps: this.retrySleeps,
        });
      }
    }

    const envelope = data.base_resp;
    if (envelope && (envelope.status_code ?? 0) !== 0) {
      throw new ImageGenerationError(
        `MiniMax H3 image API envelope error ${envelope.status_code}: ${envelope.status_msg ?? "unknown"}`,
        this.name,
      );
    }
    const images = data.data ?? [];
    const first = images.find((item) => typeof item.b64_json === "string");
    if (!first) {
      const blocked = images.some((item) => item.error !== undefined);
      const detail = images.find((item) => item.error !== undefined)?.error?.message;
      throw new ImageGenerationError(
        blocked
          ? `no image generated — rejected (${detail ?? "content safety or balance"})`
          : "no image in response",
        this.name,
      );
    }
    const bytes = Uint8Array.from(Buffer.from(first.b64_json ?? "", "base64"));
    return { bytes, contentType: "image/jpeg" };
  }
}
