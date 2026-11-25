import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A consistent copy of the open database at `path` — roadmap 10.1 and 10.2.
 *
 * `VACUUM INTO` rather than copying the file: the poller writes while it runs
 * and WAL keeps the newest pages in a second file, so a byte copy can hand back
 * a torn snapshot. The copy is written beside its final name — `prepare`, when
 * given, edits it there — and checked with `integrity_check` before it is
 * renamed into place, so a file under that name is always one that opens: a
 * disk that filled half way leaves the error and no file, never a backup that
 * is not one.
 *
 * `path` is the server's own (the data directory or `BACKUP_DIR`), never
 * anything a request names: `VACUUM INTO` takes a string literal, so the quote
 * doubling below is the only escaping there is.
 */
export function snapshotInto(db: DatabaseSync, path: string, prepare?: (copy: DatabaseSync) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  // `VACUUM INTO` refuses a target that already exists.
  rmSync(partial, { force: true });
  try {
    db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    const copy = new DatabaseSync(partial, { readOnly: prepare === undefined });
    try {
      prepare?.(copy);
      const rows = copy.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      const problems = rows.map((row) => row.integrity_check).filter((line) => line !== "ok");
      if (problems.length > 0) throw new Error(`the copy failed its integrity check: ${problems.join("; ")}`);
    } finally {
      copy.close();
    }
    renameSync(partial, path);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}
