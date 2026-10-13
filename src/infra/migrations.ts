import type { Db } from "./db.js";

/** Append-only list; the index + 1 is the schema version stored in PRAGMA user_version. */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE attempts (
    id               TEXT PRIMARY KEY,
    problem_id       TEXT NOT NULL,
    learner_id       TEXT NOT NULL,
    version          INTEGER NOT NULL,
    draft_json       TEXT NOT NULL DEFAULT '{}',
    draft_updated_at TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE (learner_id, problem_id, version)
  );

  CREATE TABLE submissions (
    id              TEXT PRIMARY KEY,
    attempt_id      TEXT NOT NULL REFERENCES attempts(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    format          TEXT NOT NULL,
    content_json    TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('SUBMITTED','EVALUATING','COMPLETED','FAILED')),
    failure_reason  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX submissions_by_attempt ON submissions(attempt_id);

  -- The job queue. Rows survive restarts; a 'running' row whose lease expired is reclaimed.
  CREATE TABLE evaluation_jobs (
    submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
    state         TEXT NOT NULL CHECK (state IN ('queued','running','done')),
    run_after     TEXT NOT NULL,
    lease_until   TEXT,
    runs          INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX jobs_claimable ON evaluation_jobs(state, run_after);

  CREATE TABLE feedback (
    submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
    json          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  `,
];

export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
