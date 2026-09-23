import { withRetry } from "@vf/llm";
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./image.js";

export interface MiniMaxImageProviderOptions {
  apiHost?: string | undefined;
  defaultModel?: string | undefined;
  /** Override the default retry sleeps (default: [1000, 2000, 4000]). Tests use [1,1,1]. */
  retrySleeps?: number[] | undefined;
}

const DEFAULT_MODEL = "image-01";

/** Width/height pairs the MiniMax image API supports via aspect_ratio
 * (per platform.minimax.io OpenAPI). aspect_ratio takes priority over raw
 * width/height, so we always map to the closest supported ratio. */
const ASPECT_RATIOS: { ratio: string; w: number; h: number }[] = [
  { ratio: "1:1", w: 1024, h: 1024 },
  { ratio: "16:9", w: 1280, h: 720 },
  { ratio: "4:3", w: 1152, h: 864 },
  { ratio: "3:2", w: 1248, h: 832 },
  { ratio: "2:3", w: 832, h: 1248 },
  { ratio: "3:4", w: 864, h: 1152 },
  { ratio: "9:16", w: 720, h: 1280 },
  { ratio: "21:9", w: 1344, h: 576 },
];

function closestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = ASPECT_RATIOS[0] ?? { ratio: "1:1", w: 1024, h: 1024 };
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

/** MiniMax image generation (platform.minimax.io context7-verified).
 * POST `${apiHost}/v1/image_generation` with `{model, prompt, aspect_ratio,
 * response_format: "base64"}`. Bearer `MINIMAX_API_KEY`. Response carries
 * base64-encoded JPEGs in `data.image_base64[]`. Bounded retry via @vf/llm
 * (no 4xx retry). Credentials never persisted or logged. */
export class MiniMaxImageProvider implements ImageProvider {
  readonly name = "minimax-image";
  private readonly apiHost: string;
  private readonly defaultModel: string;
  private readonly retrySleeps: number[];

  constructor(opts: MiniMaxImageProviderOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      const err = new ImageGenerationError(
        "MINIMAX_API_KEY not set in environment",
        this.name,
      );
      throw err;
    }
    const data = await withRetry(
      async () => {
        const res = await fetch(`${this.apiHost}/v1/image_generation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: this.defaultModel,
            prompt: req.prompt,
            aspect_ratio: closestAspectRatio(req.width, req.height),
            response_format: "base64",
            n: 1,
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          const excerpt = text.slice(0, 200);
          const err = new ImageGenerationError(
            `MiniMax image API ${res.status}: ${excerpt.slice(0, 80)}`,
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
          data?: { image_base64?: string[] } | null;
          metadata?: { success_count?: number; failed_count?: number };
          base_resp?: { status_code?: number; status_msg?: string };
        };
      },
      {
        isRetriable: (err) => !/MiniMax image API 4\d\d/.test(String(err)),
        sleeps: this.retrySleeps,
      },
    );
    // MiniMax reports quota/auth failures inside a 200 via base_resp
    // (envelope semantics per platform docs: 1004 auth, 2038 verification,
    // 2056 quota…). Surface them instead of returning "no image".
    const envelope = data.base_resp;
    if (envelope && (envelope.status_code ?? 0) !== 0) {
      throw new ImageGenerationError(
        `MiniMax image API envelope error ${envelope.status_code}: ${envelope.status_msg ?? "unknown"}`,
        this.name,
      );
    }
    const images = data.data?.image_base64 ?? [];
    const first = images[0];
    if (!first) {
      const blocked = (data.metadata?.failed_count ?? 0) > 0;
      throw new ImageGenerationError(
        blocked
          ? `no image generated — blocked by content safety (failed_count=${data.metadata?.failed_count})`
          : "no image in response",
        this.name,
      );
    }
    const bytes = Uint8Array.from(Buffer.from(first, "base64"));
    return { bytes, contentType: "image/jpeg" };
  }
}
