import { LlmError, type LlmClient, type LlmRequest } from "./llm-client.js";

/**
 * OpenAI Chat Completions over fetch (one endpoint, so no SDK dependency).
 * Sends temperature 0; some models only accept the default, so a 400 that names `temperature`
 * is retried once without it.
 */
export class OpenAiClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async complete(req: LlmRequest): Promise<string> {
    try {
      return await this.send(req, true);
    } catch (err) {
      if (err instanceof LlmError && err.status === 400 && /temperature/i.test(err.message)) return this.send(req, false);
      throw err;
    }
  }

  private async send(req: LlmRequest, withTemperature: boolean): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: req.maxTokens,
        ...(withTemperature ? { temperature: 0 } : {}),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: req.system }, ...req.messages],
      }),
    });
    if (!res.ok) throw LlmError.fromStatus("OpenAI", res.status, await res.text());
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  }
}
