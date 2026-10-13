import { DomainError } from "./errors.js";
import { ContentValidationError, type SubmissionContent } from "./content/submission-content.js";

export type SubmissionStatus = "SUBMITTED" | "EVALUATING" | "COMPLETED" | "FAILED";

/**
 * Legal status moves. A table, not the State pattern: the states have no behaviour of their own,
 * only rules about which state may follow which, and a table states those rules in one place.
 */
const TRANSITIONS: Readonly<Record<SubmissionStatus, readonly SubmissionStatus[]>> = {
  SUBMITTED: ["EVALUATING"],
  EVALUATING: ["COMPLETED", "FAILED"],
  FAILED: ["EVALUATING"],
  COMPLETED: [],
};

export class IllegalTransitionError extends DomainError {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(from: SubmissionStatus, to: SubmissionStatus) {
    super(`Cannot move a submission from ${from} to ${to}`);
  }
}

export interface SubmissionProps {
  readonly id: string;
  readonly attemptId: string;
  readonly content: SubmissionContent;
  readonly idempotencyKey: string;
  readonly status: SubmissionStatus;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** An immutable snapshot of what the learner submitted, plus where its evaluation stands. */
export class Submission {
  readonly id: string;
  readonly attemptId: string;
  readonly content: SubmissionContent;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  private _status: SubmissionStatus;
  private _failureReason: string | null;
  private _updatedAt: Date;

  constructor(props: SubmissionProps) {
    this.id = props.id;
    this.attemptId = props.attemptId;
    this.content = props.content;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
    this._status = props.status;
    this._failureReason = props.failureReason;
    this._updatedAt = props.updatedAt;
  }

  /** Same attempt + same content = same submission. Repeated clicks or network retries never double-evaluate. */
  static idempotencyKeyFor(attemptId: string, content: SubmissionContent): string {
    return `${attemptId}:${content.contentHash()}`;
  }

  /** Creates a SUBMITTED snapshot. Invalid content never becomes a Submission. */
  static create(args: {
    id: string;
    attemptId: string;
    content: SubmissionContent;
    idempotencyKey?: string;
    now: Date;
  }): Submission {
    const result = args.content.validate();
    if (!result.ok) throw new ContentValidationError(result.errors);
    return new Submission({
      id: args.id,
      attemptId: args.attemptId,
      content: args.content,
      idempotencyKey: args.idempotencyKey ?? Submission.idempotencyKeyFor(args.attemptId, args.content),
      status: "SUBMITTED",
      failureReason: null,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }

  get status(): SubmissionStatus {
    return this._status;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  static canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  /** SUBMITTED -> EVALUATING: the worker picks it up. */
  startEvaluation(now: Date): void {
    this.moveTo("EVALUATING", now);
    this._failureReason = null;
  }

  /**
   * FAILED -> EVALUATING: the learner asks for another evaluation. Checked separately because the table
   * also allows SUBMITTED -> EVALUATING, and a retry must not jump a submission that was never evaluated.
   */
  retryEvaluation(now: Date): void {
    if (this._status !== "FAILED") throw new IllegalTransitionError(this._status, "EVALUATING");
    this.startEvaluation(now);
  }

  complete(now: Date): void {
    this.moveTo("COMPLETED", now);
  }

  fail(reason: string, now: Date): void {
    this.moveTo("FAILED", now);
    this._failureReason = reason;
  }

  private moveTo(to: SubmissionStatus, now: Date): void {
    if (!Submission.canTransition(this._status, to)) throw new IllegalTransitionError(this._status, to);
    this._status = to;
    this._updatedAt = now;
  }
}

export interface SubmissionRepository {
  get(id: string): Submission | undefined;
  findByIdempotencyKey(key: string): Submission | undefined;
  listByAttempt(attemptId: string): Submission[];
  save(submission: Submission): void;
}
