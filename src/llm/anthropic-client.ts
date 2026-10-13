import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmClient, type LlmRequest } from "./llm-client.js";

/**
 * Claude via the official SDK.
 * - Structured output (`output_config.format`) enforces the JSON schema server-side; zod still re-checks it.
 * - No `temperature`: current Claude models reject non-default sampling parameters. Consistency comes
 *   from the fixed rubric anchors, the schema, and scores being computed in code.
 * - `fallbacks: "default"` re-runs a request the model declines on Anthropic's recommended fallback model.
 * - SDK retries are off; callWithRetry owns timeouts and retries so every provider behaves the same.
 */
export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(req: LlmRequest): Promise<string> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          output_config: {
            effort: "medium",
            ...(req.jsonSchema ? { format: { type: "json_schema", schema: req.jsonSchema } } : {}),
          },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: req.signal },
      );
    } catch (err) {
      if (err instanceof Anthropic.APIError && typeof err.status === "number")
        throw LlmError.fromStatus("Anthropic", err.status, err.message);
      throw err; // connection errors and aborts: retryable by default
    }

    if (response.stop_reason === "refusal") throw new LlmError("Anthropic declined to evaluate this submission", false);
    if (response.stop_reason === "max_tokens") throw new LlmError("Anthropic response hit max_tokens", true);
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text;
  }
}
