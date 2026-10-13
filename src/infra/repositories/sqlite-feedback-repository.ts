import { Feedback, type FeedbackProps, type FeedbackRepository } from "../../domain/evaluation/feedback.js";
import type { Db } from "../db.js";

/** Feedback is read and written whole, so it is stored as one JSON document per submission. */
export class SqliteFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: Db) {}

  get(submissionId: string): Feedback | undefined {
    const row = this.db.prepare("SELECT json FROM feedback WHERE submission_id = ?").get(submissionId) as
      | { json: string }
      | undefined;
    if (!row) return undefined;
    const props = JSON.parse(row.json) as Omit<FeedbackProps, "createdAt"> & { createdAt: string };
    return Feedback.restore({ ...props, createdAt: new Date(props.createdAt) });
  }

  save(feedback: Feedback): void {
    this.db
      .prepare(
        `INSERT INTO feedback (submission_id, json, created_at) VALUES (?, ?, ?)
         ON CONFLICT(submission_id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`,
      )
      .run(feedback.submissionId, JSON.stringify(feedback.props), feedback.props.createdAt.toISOString());
  }
}
