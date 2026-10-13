import Database from "better-sqlite3";
import type { TransactionRunner } from "../domain/practice-service.js";
import { migrate } from "./migrations.js";

export type Db = Database.Database;

/** Opens (and migrates) the database. ":memory:" gives tests an isolated DB per run. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export class SqliteTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Db) {}

  run<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
