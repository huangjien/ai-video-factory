export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string | undefined;
  temperature?: number | undefined;
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
