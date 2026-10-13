import type { Attempt } from "../attempt.js";
import type { Logger } from "../logger.js";
import type { Problem } from "../problem.js";
import type { EvaluationInput, Evaluator, Finding } from "./evaluator.js";
import { Feedback } from "./feedback.js";

/** Removes findings whose quoted evidence is not actually in the submission. */
export interface EvidenceCheck {
  verify(findings: readonly Finding[], input: EvaluationInput): { kept: Finding[]; dropped: Finding[] };
}

export interface PipelineOutcome {
  readonly feedback: Feedback;
  /** Set when an evaluator threw; feedback then holds the findings gathered before it, marked partial. */
  readonly error: Error | null;
}

/**
 * Runs evaluators in order (deterministic rules first) and merges their findings into one Feedback.
 * - A blocking finding stops the run, so the LLM is never called on a structurally broken design.
 * - Findings from non-rule evaluators must quote the submission; unverifiable ones are dropped.
 * - If an evaluator fails, earlier findings are kept and the Feedback is marked partial.
 * Adding an evaluator (e.g. human review) means adding it to the list; nothing else changes.
 */
export class EvaluationPipeline {
  constructor(
    private readonly evaluators: readonly Evaluator[],
    private readonly evidence: EvidenceCheck,
    private readonly logger: Logger,
  ) {}

  async run(args: {
    submissionId: string;
    input: EvaluationInput;
    problem: Problem;
    attempt: Attempt;
    now: () => Date;
  }): Promise<PipelineOutcome> {
    const requirements = args.attempt.effectiveRequirements(args.problem);
    const findings: Finding[] = [];
    const evaluatedBy: string[] = [];
    let provenance: Evaluator["provenance"];
    let dropped = 0;
    let stoppedEarly = false;
    let error: Error | null = null;

    for (const evaluator of this.evaluators) {
      let produced: Finding[];
      try {
        produced = await evaluator.evaluate({
          input: args.input,
          problem: args.problem,
          attempt: args.attempt,
          requirements,
          priorFindings: findings,
        });
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`evaluator ${evaluator.name} failed for ${args.submissionId}: ${error.message}`);
        break;
      }

      if (evaluator.source !== "rule") {
        const checked = this.evidence.verify(produced, args.input);
        if (checked.dropped.length > 0)
          this.logger.info(
            `evidence check dropped ${checked.dropped.length}/${produced.length} findings from ${evaluator.name}`,
          );
        dropped += checked.dropped.length;
        produced = checked.kept;
      }

      findings.push(...produced);
      evaluatedBy.push(evaluator.name);
      provenance = evaluator.provenance ?? provenance;

      if (produced.some((f) => f.blocking)) {
        stoppedEarly = true;
        break;
      }
    }

    const feedback = Feedback.fromFindings({
      submissionId: args.submissionId,
      findings,
      partial: error !== null,
      stoppedEarly,
      evaluatedBy,
      model: provenance?.model ?? null,
      promptVersion: provenance?.promptVersion ?? null,
      droppedFindings: dropped,
      createdAt: args.now(),
    });
    return { feedback, error };
  }
}
