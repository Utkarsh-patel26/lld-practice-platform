import { DatabaseSync } from "node:sqlite";
import type { TransactionRunner } from "../domain/practice-service.js";
import { migrate } from "./migrations.js";

/**
 * Node's built-in SQLite. Chosen over better-sqlite3 because it needs no native build, so
 * `npm install` works on any machine with Node 22.13+ (a fresh-clone install of better-sqlite3
 * failed on Windows without Visual Studio).
 */
export type Db = DatabaseSync;

/** Opens (and migrates) the database. ":memory:" gives tests an isolated DB per run. */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Runs `fn` in one transaction; a nested call joins the outer one. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export class SqliteTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Db) {}

  run<T>(fn: () => T): T {
    return inTransaction(this.db, fn);
  }
}
