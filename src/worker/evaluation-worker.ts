import type { AttemptRepository } from "../domain/attempt.js";
import type { FeedbackRepository } from "../domain/evaluation/feedback.js";
import type { EvaluationPipeline } from "../domain/evaluation/pipeline.js";
import type { Logger } from "../domain/logger.js";
import type { Clock, EvaluationQueue, TransactionRunner } from "../domain/practice-service.js";
import type { ProblemRepository } from "../domain/problem.js";
import type { SubmissionRepository } from "../domain/submission.js";

export interface ClaimedJob {
  readonly submissionId: string;
  /** How many times this job has been claimed since it was (re)queued. */
  readonly runs: number;
}

export interface JobQueue extends EvaluationQueue {
  claimNext(now: Date, leaseMs: number): ClaimedJob | null;
  markDone(submissionId: string, now: Date): void;
}

export interface WorkerDeps {
  readonly queue: JobQueue;
  readonly submissions: SubmissionRepository;
  readonly attempts: AttemptRepository;
  readonly problems: ProblemRepository;
  readonly feedback: FeedbackRepository;
  readonly pipeline: EvaluationPipeline;
  readonly tx: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Must exceed the worst-case pipeline time (all LLM retries), or a healthy job gets reclaimed. */
  readonly leaseMs: number;
  readonly pollMs: number;
  /** A job claimed this many times without finishing (the worker crashed each time) is failed for good. */
  readonly maxRuns?: number;
}

/**
 * In-process background loop: claim a job, run the pipeline, store feedback, set the final status.
 * It is the first thing to split into its own process as usage grows, because LLM calls are the
 * slow, costly, bursty part; it already talks to the app only through the jobs table.
 */
export class EvaluationWorker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly d: WorkerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), this.d.pollMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Processes jobs until the queue is empty. Ticks never overlap. */
  async drain(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let processed = 0;
    try {
      while (await this.tick()) processed++;
    } finally {
      this.busy = false;
    }
    return processed;
  }

  /** Claims and processes at most one job. Returns false when nothing was claimable. */
  async tick(): Promise<boolean> {
    const job = this.d.queue.claimNext(this.d.clock.now(), this.d.leaseMs);
    if (!job) return false;
    try {
      await this.process(job);
    } catch (err) {
      // Unexpected (e.g. storage) error: leave the lease to expire so the job is retried later.
      this.d.logger.warn(`job ${job.submissionId} crashed: ${(err as Error).message}`);
    }
    return true;
  }

  private async process(job: ClaimedJob): Promise<void> {
    const { submissions, attempts, problems, queue, tx, clock, logger } = this.d;
    const submission = submissions.get(job.submissionId);
    if (!submission || submission.status === "COMPLETED" || submission.status === "FAILED") {
      queue.markDone(job.submissionId, clock.now());
      return;
    }

    if (job.runs > (this.d.maxRuns ?? 3)) {
      tx.run(() => {
        submission.fail("Evaluation crashed repeatedly; please retry.", clock.now());
        submissions.save(submission);
        queue.markDone(submission.id, clock.now());
      });
      return;
    }

    // SUBMITTED on first pickup; already EVALUATING after a manual retry or a reclaimed lease.
    if (submission.status === "SUBMITTED") {
      submission.startEvaluation(clock.now());
      submissions.save(submission);
    }

    const attempt = attempts.get(submission.attemptId);
    const problem = attempt && problems.get(attempt.problemId);
    if (!attempt || !problem) throw new Error(`attempt or problem missing for submission ${submission.id}`);

    const started = Date.now();
    const outcome = await this.d.pipeline.run({
      submissionId: submission.id,
      input: submission.content.toEvaluationInput(),
      problem,
      attempt,
      now: () => clock.now(),
    });

    tx.run(() => {
      this.d.feedback.save(outcome.feedback);
      if (outcome.error)
        submission.fail(
          `AI evaluation failed (${outcome.error.message}). Rule-based feedback is shown; you can retry.`,
          clock.now(),
        );
      else submission.complete(clock.now());
      submissions.save(submission);
      queue.markDone(submission.id, clock.now());
    });
    logger.info(`submission ${submission.id} -> ${submission.status} in ${Date.now() - started}ms`);
  }
}
