/** A requirement the learner's design must handle. Keywords power the deterministic coverage hint only. */
export interface Requirement {
  readonly id: string;
  readonly text: string;
  readonly keywords: readonly string[];
  /** True for the requirement added by the problem's change request (attempt v2+). */
  readonly fromChangeRequest?: boolean;
}

/** The twist a learner faces on retry; surviving it is how extensibility gets tested. */
export interface ChangeRequest {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly keywords: readonly string[];
}

export type Difficulty = "easy" | "medium" | "hard";

export interface Problem {
  readonly id: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly summary: string;
  readonly description: string;
  readonly requirements: readonly Requirement[];
  readonly constraints: readonly string[];
  readonly changeRequest: ChangeRequest;
}

export interface ProblemRepository {
  list(): Problem[];
  get(id: string): Problem | undefined;
}
