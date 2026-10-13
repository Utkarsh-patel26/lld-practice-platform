export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  /** JSON Schema the response must match; providers that support structured output enforce it. */
  readonly jsonSchema?: Record<string, unknown>;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

/** The only thing evaluators know about a model provider. Swapping Anthropic/OpenAI/mock is a config change. */
export interface LlmClient {
  readonly model: string;
  complete(request: LlmRequest): Promise<string>;
}

/** Provider failure. `retryable` separates "try again" (429, 5xx, network) from "won't fix itself" (401, 400). */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }

  static fromStatus(provider: string, status: number, detail: string): LlmError {
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    return new LlmError(`${provider} returned HTTP ${status}: ${detail.slice(0, 300)}`, retryable, status);
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`, true);
  }
}
