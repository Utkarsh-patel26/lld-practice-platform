import { Attempt, type AttemptRepository } from "../../domain/attempt.js";
import type { Db } from "../db.js";

interface Row {
  id: string;
  problem_id: string;
  learner_id: string;
  version: number;
  draft_json: string;
  draft_updated_at: string | null;
  created_at: string;
}

const toAttempt = (r: Row) =>
  new Attempt({
    id: r.id,
    problemId: r.problem_id,
    learnerId: r.learner_id,
    version: r.version,
    draft: JSON.parse(r.draft_json) as Record<string, unknown>,
    draftUpdatedAt: r.draft_updated_at ? new Date(r.draft_updated_at) : null,
    createdAt: new Date(r.created_at),
  });

export class SqliteAttemptRepository implements AttemptRepository {
  constructor(private readonly db: Db) {}

  get(id: string): Attempt | undefined {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as Row | undefined;
    return row && toAttempt(row);
  }

  save(a: Attempt): void {
    this.db
      .prepare(
        `INSERT INTO attempts (id, problem_id, learner_id, version, draft_json, draft_updated_at, created_at)
         VALUES (@id, @problemId, @learnerId, @version, @draft, @draftUpdatedAt, @createdAt)
         ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, draft_updated_at = excluded.draft_updated_at`,
      )
      .run({
        id: a.id,
        problemId: a.problemId,
        learnerId: a.learnerId,
        version: a.version,
        draft: JSON.stringify(a.draft),
        draftUpdatedAt: a.draftUpdatedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      });
  }

  listByLearner(learnerId: string, problemId?: string): Attempt[] {
    const rows = (
      problemId
        ? this.db.prepare("SELECT * FROM attempts WHERE learner_id = ? AND problem_id = ? ORDER BY created_at").all(learnerId, problemId)
        : this.db.prepare("SELECT * FROM attempts WHERE learner_id = ? ORDER BY created_at").all(learnerId)
    ) as unknown as Row[];
    return rows.map(toAttempt);
  }
}
