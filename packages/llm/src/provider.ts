export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string | undefined;
  temperature?: number | undefined;
  /** OpenAI-compatible structured-output hint; ignored by providers
   * that don't support it. Currently honored by GLMProvider. */
  response_format?: { type: "json_object" | "text" } | undefined;
}

export interface Usage {
  input: number;
  output: number;
}

export interface ChatResponse {
  content: string;
  usage: Usage;
}

export interface ChatError extends Error {
  provider: string;
  status?: number | undefined;
  body_excerpt?: string | undefined;
}

export interface Provider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
