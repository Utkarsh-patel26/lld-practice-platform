import type { ContentFormatRegistry } from "../../domain/content/submission-content.js";
import { Submission, type SubmissionRepository, type SubmissionStatus } from "../../domain/submission.js";
import type { Db } from "../db.js";

interface Row {
  id: string;
  attempt_id: string;
  idempotency_key: string;
  format: string;
  content_json: string;
  status: SubmissionStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Stores content as {format, JSON} and rebuilds it through the format registry, so new formats need no schema change. */
export class SqliteSubmissionRepository implements SubmissionRepository {
  constructor(
    private readonly db: Db,
    private readonly formats: ContentFormatRegistry,
  ) {}

  get(id: string): Submission | undefined {
    return this.one("SELECT * FROM submissions WHERE id = ?", id);
  }

  findByIdempotencyKey(key: string): Submission | undefined {
    return this.one("SELECT * FROM submissions WHERE idempotency_key = ?", key);
  }

  listByAttempt(attemptId: string): Submission[] {
    const rows = this.db.prepare("SELECT * FROM submissions WHERE attempt_id = ? ORDER BY created_at").all(attemptId) as unknown as Row[];
    return rows.map((r) => this.toSubmission(r));
  }

  save(s: Submission): void {
    this.db
      .prepare(
        `INSERT INTO submissions (id, attempt_id, idempotency_key, format, content_json, status, failure_reason, created_at, updated_at)
         VALUES (@id, @attemptId, @key, @format, @content, @status, @failureReason, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, failure_reason = excluded.failure_reason, updated_at = excluded.updated_at`,
      )
      .run({
        id: s.id,
        attemptId: s.attemptId,
        key: s.idempotencyKey,
        format: s.content.format,
        content: JSON.stringify(s.content.toJSON()),
        status: s.status,
        failureReason: s.failureReason,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      });
  }

  private one(sql: string, param: string): Submission | undefined {
    const row = this.db.prepare(sql).get(param) as Row | undefined;
    return row && this.toSubmission(row);
  }

  private toSubmission(r: Row): Submission {
    return new Submission({
      id: r.id,
      attemptId: r.attempt_id,
      idempotencyKey: r.idempotency_key,
      content: this.formats.restore(r.format, JSON.parse(r.content_json)),
      status: r.status,
      failureReason: r.failure_reason,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    });
  }
}
