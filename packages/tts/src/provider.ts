export interface TTSRequest {
  text: string;
  voice: string;
  language: "zh-CN" | "en-US" | (string & {});
  /** When > 0, providers insert SSML `<break>` between sentences.
   * Honored by EdgeTTSProvider; defaults to 0 (no pause). */
  pauseBetweenSentencesSec?: number;
}

export interface TTSWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TTSResult {
  /** Audio bytes (mp3 or wav). */
  audio: Uint8Array;
  /** Total duration of the synthesized audio in milliseconds. */
  durationMs: number;
  /** Word-level timestamps when available. Empty array otherwise. */
  words: TTSWord[];
}

export interface TTSProvider {
  readonly name: string;
  synthesize(req: TTSRequest): Promise<TTSResult>;
}

export class TTSError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly status?: number | undefined,
  ) {
    super(message);
    this.name = "TTSError";
  }
}
