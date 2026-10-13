import { DomainError } from "../errors.js";
import type { EvaluationInput } from "../evaluation/evaluator.js";

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * What a learner submitted, in some format. The practice flow (Attempt, Submission, pipeline) only talks
 * to this interface, so a new format (e.g. a class diagram) is a new implementation, not a domain change.
 */
export interface SubmissionContent {
  /** "text-design" today; "class-diagram" later. A string, not a union, so new formats don't edit this file. */
  readonly format: string;
  /** Deterministic structural checks, run at submit time. */
  validate(): ValidationResult;
  /** Maps the format onto the role-based shape all evaluators read. */
  toEvaluationInput(): EvaluationInput;
  /** Stable hash of the content; part of the submission's idempotency key. */
  contentHash(): string;
  /** Plain data to persist; restored through the ContentFormatRegistry. */
  toJSON(): unknown;
}

export class ContentValidationError extends DomainError {
  readonly code = "VALIDATION_FAILED";
  constructor(readonly errors: readonly FieldError[]) {
    super(`Submission is incomplete: ${errors.map((e) => e.field).join(", ")}`);
  }
}

export class UnknownFormatError extends DomainError {
  readonly code = "UNKNOWN_FORMAT";
  constructor(format: string) {
    super(`Unknown submission format '${format}'`);
  }
}

type Restore = (data: unknown) => SubmissionContent;

/** Maps a format name to the function that rebuilds its content from JSON (API input or the database). */
export class ContentFormatRegistry {
  private readonly formats = new Map<string, Restore>();

  register(format: string, restore: Restore): this {
    this.formats.set(format, restore);
    return this;
  }

  restore(format: string, data: unknown): SubmissionContent {
    const restore = this.formats.get(format);
    if (!restore) throw new UnknownFormatError(format);
    return restore(data);
  }
}
