import type { DatabaseSync } from "node:sqlite";

/**
 * The two things anyone who cares about a SQLite file eventually runs — roadmap
 * 6.13.
 *
 * Settings already reports what the database weighs (`GET /config/storage`), and
 * the daily prune already deletes rows past the retention window — but SQLite
 * keeps the freed pages for itself, so the number an operator is reading never
 * moves after a large prune. `VACUUM` is what returns them, and `PRAGMA
 * integrity_check` is what says the file is worth keeping first.
 *
 * The order matters: a corrupt database must not be rewritten. `integrity_check`
 * runs first and a failure stops there, with whatever sqlite said, rather than
 * vacuuming a file whose pages are already wrong.
 */

export interface DbMaintenanceReport {
  /** False when `integrity_check` found something; nothing was rewritten. */
  ok: boolean;
  /** Sqlite's own words: `ok`, or the first problems it found. */
  integrity: string;
  bytesBefore: number;
  /** Equal to `bytesBefore` when the check failed and the vacuum was skipped. */
  bytesAfter: number;
  /** Never negative: a vacuum that ends up larger reclaimed nothing. */
  reclaimed: number;
  durationMs: number;
}

/** What the file occupies right now, the same reading `storageReport` takes. */
function fileBytes(db: DatabaseSync): number {
  const [pages] = db.prepare("PRAGMA page_count").all() as { page_count: number }[];
  const [size] = db.prepare("PRAGMA page_size").all() as { page_size: number }[];
  return (pages?.page_count ?? 0) * (size?.page_size ?? 0);
}

export function runDbMaintenance(db: DatabaseSync, now: () => number = () => Date.now()): DbMaintenanceReport {
  const startedAt = now();
  const bytesBefore = fileBytes(db);

  // One row per problem, or a single `ok`. Joined rather than truncated to the
  // first: a report that named one broken index and hid the rest would send an
  // operator back for a second run to learn the same thing.
  const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
  const integrity = rows.map((row) => row.integrity_check).join("; ");

  if (integrity !== "ok") {
    return {
      ok: false,
      integrity,
      bytesBefore,
      bytesAfter: bytesBefore,
      reclaimed: 0,
      durationMs: now() - startedAt,
    };
  }

  db.exec("VACUUM");
  const bytesAfter = fileBytes(db);

  return {
    ok: true,
    integrity,
    bytesBefore,
    bytesAfter,
    reclaimed: Math.max(0, bytesBefore - bytesAfter),
    durationMs: now() - startedAt,
  };
}
