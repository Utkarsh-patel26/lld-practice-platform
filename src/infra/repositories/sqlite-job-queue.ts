import type { ClaimedJob, JobQueue } from "../../worker/evaluation-worker.js";
import type { Db } from "../db.js";

/**
 * SQLite table as a job queue: enough for one process, survives restarts, and the worker
 * could move to its own process against the same table before a real queue is needed.
 */
export class SqliteJobQueue implements JobQueue {
  constructor(private readonly db: Db) {}

  enqueue(submissionId: string, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO evaluation_jobs (submission_id, state, run_after, lease_until, runs, updated_at)
         VALUES (@id, 'queued', @now, NULL, 0, @now)
         ON CONFLICT(submission_id) DO UPDATE SET state = 'queued', run_after = @now, lease_until = NULL, runs = 0, updated_at = @now`,
      )
      .run({ id: submissionId, now: now.toISOString() });
  }

  /** Claims the oldest queued job, or a running job whose lease expired (its worker died or hung). */
  claimNext(now: Date, leaseMs: number): ClaimedJob | null {
    const nowIso = now.toISOString();
    const row = this.db
      .prepare(
        `UPDATE evaluation_jobs
           SET state = 'running', lease_until = @leaseUntil, runs = runs + 1, updated_at = @now
         WHERE submission_id = (
           SELECT submission_id FROM evaluation_jobs
            WHERE (state = 'queued' AND run_after <= @now) OR (state = 'running' AND lease_until < @now)
            ORDER BY run_after LIMIT 1)
         RETURNING submission_id, runs`,
      )
      .get({ now: nowIso, leaseUntil: new Date(now.getTime() + leaseMs).toISOString() }) as
      | { submission_id: string; runs: number }
      | undefined;
    return row ? { submissionId: row.submission_id, runs: row.runs } : null;
  }

  markDone(submissionId: string, now: Date): void {
    this.db
      .prepare("UPDATE evaluation_jobs SET state = 'done', lease_until = NULL, updated_at = ? WHERE submission_id = ?")
      .run(now.toISOString(), submissionId);
  }
}
