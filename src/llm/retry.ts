import { LlmError, LlmTimeoutError } from "./llm-client.js";

export interface RetryPolicy {
  readonly timeoutMs: number;
  /** Extra attempts after the first one. */
  readonly retries: number;
  /** Delay before retry n is baseDelayMs * 2^(n-1). */
  readonly baseDelayMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onRetry?: (attempt: number, error: Error) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one provider call with a hard timeout, retrying transient failures with exponential backoff.
 * Non-retryable errors (bad key, bad request) fail immediately: retrying them only adds latency.
 */
export async function callWithRetry<T>(call: (signal: AbortSignal) => Promise<T>, policy: RetryPolicy): Promise<T> {
  const sleep = policy.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(call, policy.timeoutMs);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const retryable = !(error instanceof LlmError) || error.retryable;
      if (!retryable || attempt >= policy.retries) throw error;
      policy.onRetry?.(attempt + 1, error);
      await sleep(policy.baseDelayMs * 2 ** attempt);
    }
  }
}

async function withTimeout<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LlmTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    // Race as well as abort: a client that ignores the signal still can't hang the worker.
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
