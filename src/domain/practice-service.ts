import { Attempt, type AttemptRepository, type Draft } from "./attempt.js";
import type { ContentFormatRegistry } from "./content/submission-content.js";
import { NotFoundError } from "./errors.js";
import type { Feedback, FeedbackRepository } from "./evaluation/feedback.js";
import type { Problem, ProblemRepository } from "./problem.js";
import { Submission, type SubmissionRepository } from "./submission.js";

/** Hands a submission to whatever evaluates it later. The practice flow never evaluates inline. */
export interface EvaluationQueue {
  enqueue(submissionId: string, now: Date): void;
}

/** Runs writes atomically, so a submission is never saved without its evaluation job (or vice versa). */
export interface TransactionRunner {
  run<T>(fn: () => T): T;
}

export interface Clock {
  now(): Date;
}

export interface PracticeDeps {
  readonly problems: ProblemRepository;
  readonly attempts: AttemptRepository;
  readonly submissions: SubmissionRepository;
  readonly feedback: FeedbackRepository;
  readonly queue: EvaluationQueue;
  readonly tx: TransactionRunner;
  readonly formats: ContentFormatRegistry;
  readonly clock: Clock;
  readonly newId: () => string;
}

export interface AttemptView {
  readonly attempt: Attempt;
  readonly problem: Problem;
  readonly submissions: Submission[];
}

export interface HistoryRow {
  readonly attempt: Attempt;
  readonly problem: Problem;
  readonly latestSubmission: Submission | null;
  readonly feedback: Feedback | null;
}

/**
 * The practice loop: choose problem -> start attempt -> draft -> submit -> (evaluated elsewhere) -> review -> try again.
 * It knows nothing about submission formats (ContentFormatRegistry) or evaluators (EvaluationQueue).
 */
export class PracticeService {
  constructor(private readonly d: PracticeDeps) {}

  listProblems(): Problem[] {
    return this.d.problems.list();
  }

  getProblem(id: string): Problem {
    const problem = this.d.problems.get(id);
    if (!problem) throw new NotFoundError("Problem", id);
    return problem;
  }

  /**
   * Reuses an attempt that has no submissions yet (so clicking "Start" twice doesn't burn a version);
   * otherwise starts version N+1, which brings in the change request.
   */
  startAttempt(learnerId: string, problemId: string): { attempt: Attempt; created: boolean } {
    this.getProblem(problemId);
    const previous = this.d.attempts.listByLearner(learnerId, problemId);
    const latest = previous.reduce<Attempt | undefined>((a, b) => (!a || b.version > a.version ? b : a), undefined);
    if (latest && this.d.submissions.listByAttempt(latest.id).length === 0) return { attempt: latest, created: false };

    const attempt = Attempt.start({
      id: this.d.newId(),
      problemId,
      learnerId,
      previousAttempts: previous.length,
      now: this.d.clock.now(),
    });
    this.d.attempts.save(attempt);
    return { attempt, created: true };
  }

  getAttempt(attemptId: string): AttemptView {
    const attempt = this.requireAttempt(attemptId);
    return {
      attempt,
      problem: this.getProblem(attempt.problemId),
      submissions: this.d.submissions.listByAttempt(attempt.id),
    };
  }

  saveDraft(attemptId: string, draft: Draft): Attempt {
    const attempt = this.requireAttempt(attemptId);
    attempt.saveDraft(draft, this.d.clock.now());
    this.d.attempts.save(attempt);
    return attempt;
  }

  /**
   * Validates, stores the submission as SUBMITTED and queues evaluation, all before any evaluator runs,
   * so a slow or failing evaluator can never lose the learner's work. A repeated key returns the original.
   */
  submit(args: { attemptId: string; format: string; data: unknown; idempotencyKey?: string }): {
    submission: Submission;
    created: boolean;
  } {
    const attempt = this.requireAttempt(args.attemptId);
    const content = this.d.formats.restore(args.format, args.data);
    const key = args.idempotencyKey ?? Submission.idempotencyKeyFor(attempt.id, content);

    const existing = this.d.submissions.findByIdempotencyKey(key);
    if (existing) return { submission: existing, created: false };

    const now = this.d.clock.now();
    const submission = Submission.create({ id: this.d.newId(), attemptId: attempt.id, content, idempotencyKey: key, now });
    this.d.tx.run(() => {
      this.d.submissions.save(submission);
      this.d.queue.enqueue(submission.id, now);
    });
    return { submission, created: true };
  }

  /** FAILED -> EVALUATING and back on the queue. Any other status is an IllegalTransitionError. */
  retryEvaluation(submissionId: string): Submission {
    const submission = this.requireSubmission(submissionId);
    const now = this.d.clock.now();
    submission.startEvaluation(now);
    this.d.tx.run(() => {
      this.d.submissions.save(submission);
      this.d.queue.enqueue(submission.id, now);
    });
    return submission;
  }

  getSubmission(submissionId: string): { submission: Submission; feedback: Feedback | null; attempt: Attempt; problem: Problem } {
    const submission = this.requireSubmission(submissionId);
    const attempt = this.requireAttempt(submission.attemptId);
    return {
      submission,
      feedback: this.d.feedback.get(submission.id) ?? null,
      attempt,
      problem: this.getProblem(attempt.problemId),
    };
  }

  history(learnerId: string, problemId?: string): HistoryRow[] {
    return this.d.attempts
      .listByLearner(learnerId, problemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((attempt) => {
        const latest =
          this.d.submissions.listByAttempt(attempt.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
          null;
        return {
          attempt,
          problem: this.getProblem(attempt.problemId),
          latestSubmission: latest,
          feedback: latest ? (this.d.feedback.get(latest.id) ?? null) : null,
        };
      });
  }

  private requireAttempt(id: string): Attempt {
    const attempt = this.d.attempts.get(id);
    if (!attempt) throw new NotFoundError("Attempt", id);
    return attempt;
  }

  private requireSubmission(id: string): Submission {
    const submission = this.d.submissions.get(id);
    if (!submission) throw new NotFoundError("Submission", id);
    return submission;
  }
}
