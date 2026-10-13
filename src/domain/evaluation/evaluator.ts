import type { Attempt } from "../attempt.js";
import type { Problem, Requirement } from "../problem.js";
import type { RubricDimension, Score } from "./rubric.js";

/** Roles of the parts of a design. Every content format maps itself onto these, so evaluators never see the format. */
export type SectionRole = "requirements" | "classes" | "interfaces" | "flow" | "tradeoffs";

export interface EvaluationSection {
  readonly role: SectionRole;
  readonly title: string;
  readonly text: string;
  readonly isCode: boolean;
}

/** The one shape every evaluator reads, whatever format the learner submitted. */
export interface EvaluationInput {
  readonly format: string;
  readonly sections: readonly EvaluationSection[];
}

export type FindingSource = "rule" | "llm" | "human";

export interface Finding {
  readonly criterion: RubricDimension;
  readonly score: Score;
  /** Verbatim quote from the submission. Null only for deterministic "nothing mentions X" findings. */
  readonly evidence: string | null;
  readonly concern: string;
  readonly suggestion: string;
  /** 0..1. Below 0.5 the UI shows the finding as "worth checking" and it does not move the score. */
  readonly confidence: number;
  readonly source: FindingSource;
  /** A structural problem that makes further evaluation pointless; the pipeline stops after this evaluator. */
  readonly blocking?: boolean;
}

/** Everything an evaluator may look at. One object, so adding context later doesn't change every evaluator. */
export interface EvaluationContext {
  readonly input: EvaluationInput;
  readonly problem: Problem;
  readonly attempt: Attempt;
  readonly requirements: readonly Requirement[];
  /** Findings from evaluators that ran earlier, e.g. rule hints the LLM should confirm or reject. */
  readonly priorFindings: readonly Finding[];
}

export interface Evaluator {
  readonly source: FindingSource;
  readonly name: string;
  /** Set by evaluators whose output depends on a model and a prompt; stored with the Feedback. */
  readonly provenance?: { readonly model: string; readonly promptVersion: string };
  evaluate(ctx: EvaluationContext): Promise<Finding[]>;
}

export function submissionText(input: EvaluationInput): string {
  return input.sections.map((s) => s.text).join("\n\n");
}

export function findSection(input: EvaluationInput, role: SectionRole): EvaluationSection | undefined {
  return input.sections.find((s) => s.role === role);
}
