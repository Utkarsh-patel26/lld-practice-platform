import { z } from "zod";
import type { EvaluationContext, Evaluator, Finding } from "../domain/evaluation/evaluator.js";
import { RUBRIC_DIMENSIONS, type Score } from "../domain/evaluation/rubric.js";
import type { Logger } from "../domain/logger.js";
import type { LlmClient, LlmMessage } from "../llm/llm-client.js";
import { callWithRetry, type RetryPolicy } from "../llm/retry.js";
import type { RubricPrompt } from "../prompts/rubric-prompt.js";

export const MAX_EVIDENCE_CHARS = 200;

const llmFindingSchema = z.object({
  criterion: z.enum(RUBRIC_DIMENSIONS),
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  // Slightly above the 200 asked for: a longer verbatim quote is trimmed (a prefix is still verbatim), not rejected.
  evidence: z.string().trim().min(1).max(400),
  concern: z.string().trim().min(1).max(600),
  suggestion: z.string().trim().min(1).max(600),
  confidence: z.number().min(0).max(1),
});

export const llmOutputSchema = z
  .object({ findings: z.array(llmFindingSchema).min(RUBRIC_DIMENSIONS.length).max(30) })
  .superRefine((out, ctx) => {
    const missing = RUBRIC_DIMENSIONS.filter((d) => !out.findings.some((f) => f.criterion === d));
    if (missing.length > 0) ctx.addIssue({ code: "custom", message: `No finding for: ${missing.join(", ")}` });
  });

/** Same contract as llmOutputSchema, for providers that enforce a schema server-side. */
export const LLM_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "score", "evidence", "concern", "suggestion", "confidence"],
        properties: {
          criterion: { type: "string", enum: [...RUBRIC_DIMENSIONS] },
          score: { type: "integer", enum: [1, 2, 3, 4] },
          evidence: { type: "string" },
          concern: { type: "string" },
          suggestion: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

/** The model's output failed the schema even after one repair attempt. */
export class LlmOutputError extends Error {}

/**
 * Scores a design with an LLM, using a fixed rubric and structured output.
 * Output is never trusted: JSON is parsed and zod-validated, one repair retry gets the validation
 * error back, and quotes are later checked against the submission by the pipeline's EvidenceVerifier.
 */
export class LlmRubricEvaluator implements Evaluator {
  readonly source = "llm" as const;
  readonly name = "llm-rubric";
  readonly provenance: { model: string; promptVersion: string };

  constructor(
    private readonly client: LlmClient,
    private readonly prompt: RubricPrompt,
    private readonly retry: RetryPolicy,
    private readonly logger: Logger,
    private readonly maxTokens = 8000,
  ) {
    this.provenance = { model: client.model, promptVersion: prompt.version };
  }

  async evaluate(ctx: EvaluationContext): Promise<Finding[]> {
    const { system, user } = this.prompt.build(ctx);
    const messages: LlmMessage[] = [{ role: "user", content: user }];

    const first = await this.call(system, messages);
    const parsed = parseOutput(first);
    if (parsed.ok) return parsed.findings;

    this.logger.warn(`LLM output invalid (${parsed.error}); sending one repair request`);
    const repairMessages: LlmMessage[] = [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          `Your previous reply was not valid: ${parsed.error}\n` +
          "Reply again with only the corrected JSON object that matches the required format. No other text.",
      },
    ];
    const repaired = parseOutput(await this.call(system, repairMessages));
    if (repaired.ok) return repaired.findings;
    throw new LlmOutputError(`LLM output invalid after repair retry: ${repaired.error}`);
  }

  private call(system: string, messages: readonly LlmMessage[]): Promise<string> {
    return callWithRetry(
      (signal) =>
        this.client.complete({ system, messages, jsonSchema: LLM_OUTPUT_JSON_SCHEMA, maxTokens: this.maxTokens, signal }),
      {
        ...this.retry,
        onRetry: (n, err) => this.logger.warn(`LLM call retry ${n}/${this.retry.retries}: ${err.message}`),
      },
    );
  }
}

type ParseResult = { ok: true; findings: Finding[] } | { ok: false; error: string };

export function parseOutput(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch (err) {
    return { ok: false, error: `not valid JSON (${(err as Error).message})` };
  }
  const result = llmOutputSchema.safeParse(json);
  if (!result.success)
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; "),
    };
  return {
    ok: true,
    findings: result.data.findings.map((f) => ({
      criterion: f.criterion,
      score: f.score as Score,
      evidence: f.evidence.slice(0, MAX_EVIDENCE_CHARS),
      concern: f.concern,
      suggestion: f.suggestion,
      confidence: f.confidence,
      source: "llm" as const,
    })),
  };
}

/** Tolerates a model wrapping JSON in ```json fences despite instructions; anything else must be pure JSON. */
function stripFences(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}
