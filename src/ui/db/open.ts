import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Opens the UI edition's database. Built into the runtime, so no native module
 * and no compiler in any build stage.
 *
 * WAL keeps the dashboard's reads from blocking the poller's writes, and the busy
 * timeout absorbs the overlap between a poll cycle and a burst of requests from
 * the status grid's refresh.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
