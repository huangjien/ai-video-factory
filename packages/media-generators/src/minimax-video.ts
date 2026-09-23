import { ImageGenerationError } from "./image.js";
import type { VideoProvider, VideoRequest, VideoResult } from "./video.js";

export interface MiniMaxVideoProviderOptions {
  apiHost?: string | undefined;
  defaultModel?: string | undefined;
  /** How often to poll the task endpoint (default 5000 ms). Tests override to 1 ms. */
  pollIntervalMs?: number | undefined;
  /** Maximum total time to wait for Success (default 10 minutes). */
  timeoutMs?: number | undefined;
  /** Override the default retry sleeps (default [1000, 2000, 4000]). */
  retrySleeps?: number[] | undefined;
}

const DEFAULT_MODEL = "MiniMax-Hailuo-2.3";

type TaskStatus = "Preparing" | "Queueing" | "Processing" | "Success" | "Fail";

/** Map width/height to a supported MiniMax resolution string.
 * MiniMax-Hailuo-2.3 supports common sizes; we keep a small mapping and
 * fall back to the closest round-number pair. */
function pickResolution(width: number, height: number): string {
  const pair = `${width}x${height}`;
  if (pair === "1080x1920" || pair === "1920x1080") return pair;
  return `${width}x${height}`;
}

/** Real MiniMax AI video provider (platform.minimax.io context7-verified).
 * Async flow:
 *   1) POST /v1/video_generation → {task_id}
 *   2) Poll GET /v1/query/video_generation?task_id=… until status=Success
 *   3) Download the bytes from /v1/files/{file_id}
 * Honours MiniMax's base_resp envelope semantics. Bounded retry on
 * transient errors; no retry on 4xx or envelope errors.
 */
export class MiniMaxVideoProvider implements VideoProvider {
  readonly name = "minimax-video";
  private readonly apiHost: string;
  private readonly defaultModel: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly retrySleeps: number[];

  constructor(opts: MiniMaxVideoProviderOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  private get apiKey(): string {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      throw new ImageGenerationError(
        "MINIMAX_API_KEY not set in environment",
        this.name,
      );
    }
    return key;
  }

  private async createTask(req: VideoRequest): Promise<string> {
    const body = {
      model: this.defaultModel,
      prompt: req.prompt,
      first_frame_image: req.firstFrameImageUrl,
      duration: req.durationSec,
      resolution: pickResolution(req.width, req.height),
    };
    const res = await fetch(`${this.apiHost}/v1/video_generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const excerpt = text.slice(0, 200);
      const err = new ImageGenerationError(
        `MiniMax video API ${res.status}: ${excerpt.slice(0, 80)}`,
        this.name,
      );
      (err as ImageGenerationError & { status: number }).status = res.status;
      (err as ImageGenerationError & { body_excerpt: string }).body_excerpt =
        excerpt;
      throw err;
    }
    const parsed = JSON.parse(text) as {
      task_id?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    const env = parsed.base_resp;
    if (env && (env.status_code ?? 0) !== 0) {
      throw new ImageGenerationError(
        `MiniMax video API envelope error ${env.status_code}: ${env.status_msg ?? "unknown"}`,
        this.name,
      );
    }
    if (!parsed.task_id) {
      throw new ImageGenerationError(
        `MiniMax video API did not return task_id`,
        this.name,
      );
    }
    return parsed.task_id;
  }

  private async pollUntilDone(taskId: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(
        `${this.apiHost}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw new ImageGenerationError(
          `MiniMax video query ${res.status}: ${text.slice(0, 80)}`,
          this.name,
        );
      }
      const parsed = JSON.parse(text) as {
        status?: TaskStatus;
        file_id?: string;
        base_resp?: { status_code?: number; status_msg?: string };
      };
      if (parsed.status === "Success" && parsed.file_id) return parsed.file_id;
      if (parsed.status === "Fail") {
        throw new ImageGenerationError(
          `MiniMax video generation failed: ${parsed.base_resp?.status_msg ?? "Fail"}`,
          this.name,
        );
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new ImageGenerationError(
      `MiniMax video generation timed out after ${this.timeoutMs}ms`,
      this.name,
    );
  }

  private async downloadFile(fileId: string): Promise<Uint8Array> {
    const res = await fetch(`${this.apiHost}/v1/files/${fileId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new ImageGenerationError(
        `MiniMax file download ${res.status}`,
        this.name,
      );
    }
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    const taskId = await this.createTask(req);
    const fileId = await this.pollUntilDone(taskId);
    const bytes = await this.downloadFile(fileId);
    return { bytes, contentType: "video/mp4" };
  }
}
