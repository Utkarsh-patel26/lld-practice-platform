import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  PORT: int(3000),
  DB_PATH: z.string().default("lld-practice.db"),
  LLM_PROVIDER: z.enum(["mock", "anthropic", "openai"]).default("mock"),
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_TIMEOUT_MS: int(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  LLM_RETRY_BASE_MS: int(1_000),
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(1_500),
  WORKER_POLL_MS: int(2_000),
});

export type LlmProvider = "mock" | "anthropic" | "openai";

export interface Config {
  readonly port: number;
  readonly dbPath: string;
  readonly llm: {
    readonly provider: LlmProvider;
    readonly model: string;
    readonly apiKey: string | null;
    readonly timeoutMs: number;
    readonly retries: number;
    readonly retryBaseMs: number;
    readonly mockLatencyMs: number;
  };
  readonly worker: { readonly pollMs: number; readonly leaseMs: number };
  /** Set when the requested provider couldn't be used and the app fell back to mock. */
  readonly warning: string | null;
}

/** Worst case for one evaluation: two LLM calls (first + repair), each with its retries and backoff, plus slack. */
export function leaseFor(timeoutMs: number, retries: number, retryBaseMs: number): number {
  const perCall = (retries + 1) * timeoutMs + retryBaseMs * (2 ** retries - 1);
  return 2 * perCall + 30_000;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  let provider: LlmProvider = e.LLM_PROVIDER;
  let warning: string | null = null;
  const apiKey = provider === "anthropic" ? e.ANTHROPIC_API_KEY : provider === "openai" ? e.OPENAI_API_KEY : undefined;

  if (provider !== "mock" && !apiKey) {
    warning = `LLM_PROVIDER=${provider} but no API key is set; using the mock evaluator.`;
    provider = "mock";
  }
  if (provider === "openai" && !e.LLM_MODEL) throw new Error("LLM_PROVIDER=openai requires LLM_MODEL (e.g. LLM_MODEL=gpt-4.1).");

  const model = provider === "anthropic" ? (e.LLM_MODEL ?? "claude-sonnet-5-5") : provider === "openai" ? e.LLM_MODEL! : "mock-heuristic-v1";
  return {
    port: e.PORT,
    dbPath: e.DB_PATH,
    llm: {
      provider,
      model,
      apiKey: apiKey ?? null,
      timeoutMs: e.LLM_TIMEOUT_MS,
      retries: e.LLM_MAX_RETRIES,
      retryBaseMs: e.LLM_RETRY_BASE_MS,
      mockLatencyMs: e.MOCK_LATENCY_MS,
    },
    worker: { pollMs: e.WORKER_POLL_MS, leaseMs: leaseFor(e.LLM_TIMEOUT_MS, e.LLM_MAX_RETRIES, e.LLM_RETRY_BASE_MS) },
    warning,
  };
}
