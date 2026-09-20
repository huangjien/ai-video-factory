export interface VideoRequest {
  prompt: string;
  width: number;
  height: number;
  durationSec: number;
  /**
   * Required by image-to-video providers (e.g. MiniMax Hailuo).
   * Either a public URL or a `data:image/...;base64,...` Data URL.
   * Providers that don't need a first frame can ignore this field.
   */
  firstFrameImageUrl?: string | undefined;
}

export interface VideoResult {
  bytes: Uint8Array;
  contentType: "video/mp4";
}

export interface VideoProvider {
  readonly name: string;
  generate(req: VideoRequest): Promise<VideoResult>;
}

/**
 * Mock VideoProvider — doc §60 (Advanced Media). Real AI video providers
 * (e.g. image-to-video services) are a v0.3 hook. v0.2 phase 8 ships only
 * the mock so the Shorts flow can be tested end-to-end without a real
 * video API. The mock returns a small text-only payload labelled
 * "placeholder" so downstream consumers can detect it.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async generate(req: VideoRequest): Promise<VideoResult> {
    const payload = `placeholder-video-bytes — generated for prompt="${req.prompt}" ${req.width}x${req.height}@${req.durationSec}s`;
    return {
      bytes: new TextEncoder().encode(payload),
      contentType: "video/mp4",
    };
  }
}
