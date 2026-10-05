import { withRetry } from "@video/llm";
import {
  AudioAssetError,
  type AudioAssetProvider,
  type AssetResult,
  type BgmOptions,
  type SfxOptions,
} from "./schemas.js";

export interface MiniMaxMusicProviderOptions {
  apiHost?: string | undefined;
  defaultModel?: string | undefined;
  /** Override the default retry sleeps (default: [1000, 2000, 4000]). Tests use [1,1,1]. */
  retrySleeps?: number[] | undefined;
}

const DEFAULT_MODEL = "music-01";

/**
 * Tag → generation prompt. Tags not listed here are passed through as the
 * prompt itself (the API accepts free-text style descriptions in either
 * language). Add entries here to grow the project's music vocabulary —
 * e.g. `liubang-xiaodiao` was requested for the 鸿门宴 project.
 */
export const MUSIC_PROMPTS: Record<string, string> = {
  calm: "平静舒缓的背景音乐，钢琴与弦乐，克制柔和，无打击乐重音",
  epic: "史诗感配乐，大规模弦乐与定音鼓，紧张推进，气势磅礴",
  guofeng: "中国风民族管弦乐，古筝琵琶与竹笛，古韵悠长",
  "liubang-xiaodiao":
    "中国古风小调，琵琶与竹笛为主，鼓点沉稳，汉代帝王气象，大气的民族管弦乐",
  "fanzhuan-march":
    "剧情反转进行曲，弦乐与定音鼓层层推进，由压抑渐强到爆发，悬疑转高昂",
};

function promptForTag(tag: string, mood?: string): string {
  return MUSIC_PROMPTS[tag] ?? mood ?? tag.replace(/[-_]+/g, " ");
}

/** MiniMax music generation (music-01, platform.minimax.io OpenAPI — same
 * envelope as the image/TTS APIs). POST `${apiHost}/v1/music_generation`
 * with `{model, prompt, audio_setting}`; Bearer `MINIMAX_API_KEY`; response
 * carries hex-encoded MP3 in `data.audio` and `base_resp.status_code` (0 =
 * ok). Bounded retry via @video/llm (no 4xx retry). BGM only — the music
 * API does not cover short SFX, so `pickSoundEffect` always refuses.
 * Credentials never persisted or logged. */
export class MiniMaxMusicProvider implements AudioAssetProvider {
  readonly name = "minimax-music";
  private readonly apiHost: string;
  private readonly defaultModel: string;
  private readonly retrySleeps: number[];

  constructor(opts: MiniMaxMusicProviderOptions = {}) {
    this.apiHost =
      opts.apiHost ??
      process.env["MINIMAX_API_HOST"] ??
      "https://api.minimax.io";
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.retrySleeps = opts.retrySleeps ?? [1000, 2000, 4000];
  }

  async pickBackgroundMusic(opts?: BgmOptions): Promise<AssetResult> {
    const key = process.env["MINIMAX_API_KEY"];
    if (!key) {
      throw new AudioAssetError(
        "MINIMAX_API_KEY not set in environment",
        this.name,
      );
    }
    const tag = opts?.tag ?? "default";
    const prompt = promptForTag(tag, opts?.mood);
    const body = await withRetry(
      async () => {
        const res = await fetch(`${this.apiHost}/v1/music_generation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: this.defaultModel,
            prompt,
            audio_setting: {
              sample_rate: 44100,
              bitrate: 256000,
              format: "mp3",
            },
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          throw Object.assign(
            new Error(
              `MiniMax music_generation ${res.status}: ${text.slice(0, 80)}`,
            ),
            { status: res.status },
          );
        }
        return JSON.parse(text) as {
          data?: { audio?: string } | null;
          base_resp?: { status_code?: number; status_msg?: string };
        };
      },
      {
        isRetriable: (err) =>
          !/music_generation 4\d\d/.test(String(err)),
        sleeps: this.retrySleeps,
      },
    );
    // MiniMax reports quota/auth failures inside a 200 via base_resp
    // (envelope semantics per platform docs). Surface them immediately.
    const envelope = body.base_resp;
    if (envelope && (envelope.status_code ?? 0) !== 0) {
      throw new AudioAssetError(
        `MiniMax music API envelope error ${envelope.status_code}: ${envelope.status_msg ?? "unknown"}`,
        this.name,
      );
    }
    const audio = body.data?.audio;
    if (typeof audio !== "string" || audio.length === 0) {
      throw new AudioAssetError(
        "music_generation returned no audio payload",
        this.name,
      );
    }
    const bytes = Buffer.from(audio, "hex");
    // The API does not return a duration; downstream probes the written
    // file when it needs the real length (bgm-timeline ffprobes narrated
    // wavs, mix resamples whatever decodes). Nominal 60s = typical bed.
    return {
      bytes: new Uint8Array(bytes),
      contentType: "audio/mpeg",
      durationSec: 60,
      license: `MiniMax generated (music-01, prompt: ${prompt.slice(0, 60)})`,
      source: `minimax://music-01/${tag}`,
    };
  }

  async pickSoundEffect(_opts: SfxOptions): Promise<AssetResult> {
    throw new AudioAssetError(
      "minimax-music generates BGM only — route SFX to the mock or file-based provider",
      this.name,
    );
  }
}
