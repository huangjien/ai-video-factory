import { withRetry } from "@video/llm";
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./image.js";

export interface GeminiImageProviderOptions {
  apiBaseUrl?: string | undefined;
  defaultModel?: string | undefined;
  /** Override the default retry sleeps (default: [1000, 2000, 4000]). Tests use [1,1,1]. */
  retrySleeps?: number[] | undefined;
}

/** Nano Banana 2.1 — the current general-purpose image model. */
const DEFAULT_MODEL = "gemini-3.1-flash-image";

/** Aspect ratios the API accepts for image output. */
const ASPECT_RATIOS: { ratio: string; w: number; h: number }[] = [
  { ratio: "1:1", w: 1, h: 1 },
  { ratio: "3:4", w: 3, h: 4 },
  { ratio: "4:3", w: 4, h: 3 },
  { ratio: "9:16", w: 9, h: 16 },
  { ratio: "16:9", w: 16, h: 9 },
  { ratio: "21:9", w: 21, h: 9 },
];

function closestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = ASPECT_RATIOS[0] ?? { ratio: "1:1", w: 1, h: 1 };
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const ar of ASPECT_RATIOS) {
    const diff = Math.abs(ar.w / ar.h - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ar;
    }
  }
  return best.ratio;
}

/**
 * Google image generation (ai.google.dev/gemini-api/docs/image-generation).
 *
 * POST `${apiBaseUrl}/interactions` with
 * `{model, input:[{type:"text",text}], response_format:{type:"image",
 * mime_type, aspect_ratio}}`. Auth is the `x-goog-api-key` header carrying
 * `GEMINI_API_KEY` — not a bearer token. The generated JPEG arrives as
 * base64 in `output_image.data`.
 *
 * Two response details worth knowing, both observed against the live API:
 * the parameter names are snake_case (`mime_type`, `aspect_ratio`) even
 * though the SDK docs show camelCase, and a failure response is a JSON
 * **array** of error objects rather than a single object.
 *
 * Bounded retry via @video/llm (no 4xx retry). Credentials are never
 * persisted or included in errors.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly name = "gemini-image";
  private readonly apiBaseUrl: string;
  private readonly defaultModel: string;
  private readonly retrySleeps: number[];

  constructor(opts: GeminiImageProviderOptions = {}) {
    this.apiBaseUrl =
      opts.apiBaseUrl ??
      process.env["GEMINI_API_BASE_URL"] ??
      "https://generativelanguage.googleapis.com/v1beta";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const key = process.env["GEMINI_API_KEY"];
    if (!key) {
      throw new ImageGenerationError(
        "GEMINI_API_KEY not set in environment",
        this.name,
      );
    }
    const data = await withRetry(
      async () => {
        const res = await fetch(`${this.apiBaseUrl}/interactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            model: this.defaultModel,
            input: [{ type: "text", text: req.prompt }],
            response_format: {
              type: "image",
              mime_type: "image/jpeg",
              aspect_ratio: closestAspectRatio(req.width, req.height),
            },
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          const err = new ImageGenerationError(
            `Gemini image API ${res.status}: ${describeError(text)}`,
            this.name,
          );
          (err as ImageGenerationError & { status: number }).status =
            res.status;
          (
            err as ImageGenerationError & { body_excerpt: string }
          ).body_excerpt = text.slice(0, 200);
          throw err;
        }
        return JSON.parse(text) as {
          output_image?: { data?: string; mime_type?: string } | null;
        };
      },
      {
        isRetriable: (err) => !/Gemini image API 4\d\d/.test(String(err)),
        sleeps: this.retrySleeps,
      },
    );
    const first = data.output_image?.data;
    if (!first) {
      throw new ImageGenerationError(
        "no image in response — the prompt may have been blocked by content safety",
        this.name,
      );
    }
    const bytes = Uint8Array.from(Buffer.from(first, "base64"));
    return { bytes, contentType: "image/jpeg" };
  }
}

/**
 * Pull a human-readable message out of an error body. The API returns
 * `[{"error":{"message":…}}]` on some failures (observed on the 402
 * depleted-credits case) and `{"error":{"message":…}}` on others.
 */
function describeError(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const message = (entry as { error?: { message?: string } })?.error
        ?.message;
      if (message) return message.slice(0, 120);
    }
  } catch {
    // fall through to the raw excerpt
  }
  return text.slice(0, 120);
}
