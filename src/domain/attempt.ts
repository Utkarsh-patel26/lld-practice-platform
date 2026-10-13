import type { Problem, Requirement } from "./problem.js";

/** Opaque draft data; the content format decides what the keys mean. */
export type Draft = Readonly<Record<string, unknown>>;

export interface AttemptProps {
  readonly id: string;
  readonly problemId: string;
  readonly learnerId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly draft: Draft;
  readonly draftUpdatedAt: Date | null;
}

/**
 * One learner try at a problem. Version 1 uses the base requirements; version 2+ adds the problem's
 * change request, so a retry tests whether the design absorbs a new requirement.
 */
export class Attempt {
  readonly id: string;
  readonly problemId: string;
  readonly learnerId: string;
  readonly version: number;
  readonly createdAt: Date;
  private _draft: Draft;
  private _draftUpdatedAt: Date | null;

  constructor(props: AttemptProps) {
    if (!Number.isInteger(props.version) || props.version < 1) throw new Error("Attempt version must be >= 1");
    this.id = props.id;
    this.problemId = props.problemId;
    this.learnerId = props.learnerId;
    this.version = props.version;
    this.createdAt = props.createdAt;
    this._draft = props.draft;
    this._draftUpdatedAt = props.draftUpdatedAt;
  }

  /** Starts the next attempt; `previousAttempts` is how many attempts the learner already made on this problem. */
  static start(args: { id: string; problemId: string; learnerId: string; previousAttempts: number; now: Date }): Attempt {
    return new Attempt({
      id: args.id,
      problemId: args.problemId,
      learnerId: args.learnerId,
      version: args.previousAttempts + 1,
      createdAt: args.now,
      draft: {},
      draftUpdatedAt: null,
    });
  }

  get includesChangeRequest(): boolean {
    return this.version >= 2;
  }

  get draft(): Draft {
    return this._draft;
  }

  get draftUpdatedAt(): Date | null {
    return this._draftUpdatedAt;
  }

  /** The requirements this attempt is graded against. */
  effectiveRequirements(problem: Problem): Requirement[] {
    if (problem.id !== this.problemId) throw new Error(`Attempt ${this.id} is not for problem ${problem.id}`);
    if (!this.includesChangeRequest) return [...problem.requirements];
    const cr = problem.changeRequest;
    return [...problem.requirements, { id: cr.id, text: cr.text, keywords: cr.keywords, fromChangeRequest: true }];
  }

  saveDraft(draft: Draft, now: Date): void {
    this._draft = draft;
    this._draftUpdatedAt = now;
  }
}

export interface AttemptRepository {
  get(id: string): Attempt | undefined;
  save(attempt: Attempt): void;
  listByLearner(learnerId: string, problemId?: string): Attempt[];
}
