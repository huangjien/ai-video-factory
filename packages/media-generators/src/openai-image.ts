import { withRetry } from "@video/llm";
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./image.js";

export interface OpenAIImageProviderOptions {
  apiBaseUrl?: string | undefined;
  defaultModel?: string | undefined;
  /**
   * Render quality: `low` | `medium` | `high` | `xhigh` | `max`.
   * Default `low` — the 2.6 models bill per image output token, so
   * low keeps a bulk scene render around $0.020/image (measured
   * 2026-11-16: 622 output tokens = $0.0203, 8.1 s).
   */
  quality?: string | undefined;
  /** Override the default retry sleeps (default: [1000, 2000, 4000]). Tests use [1,1,1]. */
  retrySleeps?: number[] | undefined;
}

/** `flare` is the fast everyday model; `sunburst` is the editing-precision
 * one. Both bill at the same token rate.
 *
 * The default moved to **2.6** on 2026-11-16, measured against
 * MiniMax image-01 on a real shipped scene prompt (the same prompt,
 * the same minute):
 *
 * | provider | wall clock | cost/image | prompt fidelity |
 * |---|---|---|---|
 * | minimax image-01 | 17.2 s | $0.0196 | atmosphere, but the diagram was unreadable |
 * | gpt-image-2.6-flare `low` | **8.1 s** | **$0.0203** | followed the prompt's two-part structure and drew a legible diagram |
 * | gpt-image-2.6-flare `medium` | 8.6 s | $0.0357 | same structure, cleaner glyphs |
 * | gpt-image-2.6-sunburst `medium` | 41.7 s | $0.0357 | same price, 4x slower |
 *
 * So `low` costs what image-01 costs, renders twice as fast, and is
 * the only one of the three that drew the diagram the prompt asked
 * for. The 2.5 models stay reachable through `defaultModel`. */
const DEFAULT_MODEL = "gpt-image-2.6-flare";

/**
 * Sizes the Images API documents as recommended. Custom `WIDTHxHEIGHT`
 * is accepted by the API, but the recommended set is what the model
 * quality tiers are calibrated for, so we snap to it — the same way
 * MiniMaxImageProvider snaps to a supported aspect_ratio. Aspect ratio
 * dominates the choice; area only breaks ties.
 */
const SUPPORTED_SIZES: { w: number; h: number }[] = [
  { w: 1024, h: 1024 },
  { w: 1536, h: 1024 },
  { w: 1024, h: 1536 },
];

function closestSize(width: number, height: number): string {
  const target = width / height;
  let best = SUPPORTED_SIZES[0] ?? { w: 1024, h: 1024 };
  let bestScore = Number.POSITIVE_INFINITY;
  for (const size of SUPPORTED_SIZES) {
    const aspectScore = Math.abs(size.w / size.h - target) * 1000;
    const areaScore = Math.abs(size.w * size.h - width * height) / 1e6;
    const score = aspectScore + areaScore;
    if (score < bestScore) {
      bestScore = score;
      best = size;
    }
  }
  return `${best.w}x${best.h}`;
}

/** GPT-Image-2.6 accepts custom dimensions: both edges multiples of 16,
 *  ratio between 1:3 and 3:1, total pixels between 655,360 and
 *  8,294,400 (4K). Returns null when the request does not fit, and
 *  the caller falls back to the recommended set.
 *
 * This is what buys the pipeline its real 16:9: the recommended set
 * tops out at 1536x1024 (3:2), so a 1920x1080 composition used to be
 * snapped to a 3:2 frame and cropped by the renderer. 2.6 renders
 * 1920x1088 (the nearest multiple of 16) instead. */
function customSize(width: number, height: number): string | null {
  const w = Math.round(width / 16) * 16;
  const h = Math.round(height / 16) * 16;
  const pixels = w * h;
  if (pixels < 655_360 || pixels > 8_294_400) return null;
  if (Math.max(w / h, h / w) > 3) return null;
  return `${w}x${h}`;
}

/** Does this model take custom dimensions? Only the 2.6 line does —
 *  the 2.5 models reject a size outside the recommended set. */
function supportsCustomSize(model: string): boolean {
  return /gpt-image-2\.6/.test(model);
}

/**
 * OpenAI image generation (developers.openai.com/api/docs/guides/image-generation).
 *
 * POST `${apiBaseUrl}/images/generations` with
 * `{model, prompt, size, quality, n, output_format}`. Bearer `OPENAI_API_KEY`.
 * The response always carries base64 PNG in `data[].b64_json` — gpt-image
 * models do not return image URLs. Bounded retry via @video/llm (no 4xx
 * retry). Credentials are never persisted or included in errors.
 *
 * `referenceImage` is not used: driving the `/images/edits` multipart
 * endpoint is a separate change.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai-image";
  private readonly apiBaseUrl: string;
  private readonly defaultModel: string;
  private readonly quality: string;
  private readonly retrySleeps: number[];

  constructor(opts: OpenAIImageProviderOptions = {}) {
    this.apiBaseUrl =
      opts.apiBaseUrl ??
      process.env["OPENAI_API_BASE_URL"] ??
      "https://api.openai.com/v1";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.quality = opts.quality ?? "low";
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) {
      throw new ImageGenerationError(
        "OPENAI_API_KEY not set in environment",
        this.name,
      );
    }
    const data = await withRetry(
      async () => {
        const res = await fetch(`${this.apiBaseUrl}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: this.defaultModel,
            prompt: req.prompt,
            size: supportsCustomSize(this.defaultModel)
              ? (customSize(req.width, req.height) ??
                closestSize(req.width, req.height))
              : closestSize(req.width, req.height),
            quality: this.quality,
            n: 1,
            output_format: "png",
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          const excerpt = text.slice(0, 200);
          const err = new ImageGenerationError(
            `OpenAI image API ${res.status}: ${excerpt.slice(0, 80)}`,
            this.name,
          );
          (err as ImageGenerationError & { status: number }).status =
            res.status;
          (
            err as ImageGenerationError & { body_excerpt: string }
          ).body_excerpt = excerpt;
          throw err;
        }
        return JSON.parse(text) as {
          data?: { b64_json?: string }[] | null;
          error?: { message?: string } | null;
        };
      },
      {
        isRetriable: (err) => !/OpenAI image API 4\d\d/.test(String(err)),
        sleeps: this.retrySleeps,
      },
    );
    if (data.error) {
      throw new ImageGenerationError(
        `OpenAI image API error: ${data.error.message ?? "unknown"}`,
        this.name,
      );
    }
    const first = data.data?.[0]?.b64_json;
    if (!first) {
      throw new ImageGenerationError(
        "no image in response — the prompt may have been blocked by content safety",
        this.name,
      );
    }
    const bytes = Uint8Array.from(Buffer.from(first, "base64"));
    return { bytes, contentType: "image/png" };
  }
}
