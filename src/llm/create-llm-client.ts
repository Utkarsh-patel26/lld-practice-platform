import type { Config } from "../config.js";
import { AnthropicClient } from "./anthropic-client.js";
import type { LlmClient } from "./llm-client.js";
import { MockLlmClient } from "./mock-client.js";
import { OpenAiClient } from "./openai-client.js";

export function createLlmClient(llm: Config["llm"]): LlmClient {
  switch (llm.provider) {
    case "anthropic":
      return new AnthropicClient(llm.apiKey!, llm.model);
    case "openai":
      return new OpenAiClient(llm.apiKey!, llm.model);
    case "mock":
      return new MockLlmClient(llm.mockLatencyMs);
  }
}
