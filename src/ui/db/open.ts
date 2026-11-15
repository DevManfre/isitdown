import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A database file SQLite cannot trust — roadmap 10.4. Thrown before anything
 * is written to it, so the file the operator restores from, or hands to
 * `sqlite3 .recover`, is the one the power cut left behind, not one this
 * process went on to make worse.
 */
export class DatabaseCorruptError extends Error {
  readonly path: string;
  /** What SQLite said: the `quick_check` findings, or the error opening it. */
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(`database at ${path} is corrupt: ${detail}`);
    this.name = "DatabaseCorruptError";
    this.path = path;
    this.detail = detail;
  }
}

/** `SQLITE_CORRUPT` and `SQLITE_NOTADB`: the file is damaged, or not a database at all. */
const CORRUPT_CODES = new Set([11, 26]);

const isCorruption = (error: unknown): boolean =>
  CORRUPT_CODES.has((error as { errcode?: unknown } | null)?.errcode as number);

/**
 * Opens the UI edition's database. Built into the runtime, so no native module
 * and no compiler in any build stage.
 *
 * `quick_check` first, before a pragma writes anything: a page a power cut
 * tore stops the start here, with the path, rather than surfacing later as a
 * failed poll cycle — or as a write that spreads the damage.
 *
 * WAL keeps the dashboard's reads from blocking the poller's writes, and the busy
 * timeout absorbs the overlap between a poll cycle and a burst of requests from
 * the status grid's refresh. `synchronous = FULL` is stated rather than left to
 * the build's default: with it a committed cycle survives a power cut, not only
 * a crash, for one fsync per commit — nothing beside a poll every few minutes.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    const findings = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    const problems = findings.map((row) => row.quick_check).filter((line) => line !== "ok");
    if (problems.length > 0) throw new DatabaseCorruptError(path, problems.join("; "));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
  } catch (error) {
    db?.close();
    if (error instanceof DatabaseCorruptError) throw error;
    if (isCorruption(error)) {
      throw new DatabaseCorruptError(path, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
