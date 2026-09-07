import type { DatabaseSync } from "node:sqlite";

/**
 * What a retention window costs on disk, so choosing one is a decision with a
 * number next to it rather than a guess.
 *
 * The per-sample figure is measured from this database where there is enough
 * history to measure — `status_samples` and its index are what retention
 * actually governs, and the index is roughly as large as the table, so leaving
 * it out would understate the cost by half. Below that, page granularity makes
 * the division meaningless (one sample still occupies a whole 4 KiB page), so a
 * figure measured on a real 56k-sample database stands in and the report says
 * so.
 */
const ESTIMATED_BYTES_PER_SAMPLE = 100;
const MEASURABLE_FROM_SAMPLES = 1000;

const SAMPLE_STORAGE = ["status_samples", "idx_status_samples_provider_time"];

export interface StorageReport {
  /** The whole file, history and everything else alike. */
  dbBytes: number;
  sampleCount: number;
  bytesPerSample: number;
  /** False when `bytesPerSample` is the built-in figure rather than this database's. */
  measured: boolean;
  /** At the current provider count and poll interval. */
  samplesPerDay: number;
}

export function storageReport(
  db: DatabaseSync,
  usage: { providerCount: number; intervalMinutes: number },
): StorageReport {
  const [pages] = db.prepare("PRAGMA page_count").all() as { page_count: number }[];
  const [size] = db.prepare("PRAGMA page_size").all() as { page_size: number }[];
  const [samples] = db.prepare("SELECT COUNT(*) AS n FROM status_samples").all() as { n: number }[];
  const sampleCount = samples?.n ?? 0;

  return {
    dbBytes: (pages?.page_count ?? 0) * (size?.page_size ?? 0),
    sampleCount,
    ...perSample(db, sampleCount),
    samplesPerDay: Math.round(usage.providerCount * (1440 / usage.intervalMinutes)),
  };
}

function perSample(db: DatabaseSync, sampleCount: number): { bytesPerSample: number; measured: boolean } {
  if (sampleCount < MEASURABLE_FROM_SAMPLES) {
    return { bytesPerSample: ESTIMATED_BYTES_PER_SAMPLE, measured: false };
  }
  try {
    // `dbstat` is a compile-time option: an sqlite without it must still answer.
    const [used] = db
      .prepare(`SELECT SUM(pgsize) AS bytes FROM dbstat WHERE name IN (${SAMPLE_STORAGE.map(() => "?").join(", ")})`)
      .all(...SAMPLE_STORAGE) as { bytes: number | null }[];
    const bytes = used?.bytes ?? null;
    if (bytes === null) return { bytesPerSample: ESTIMATED_BYTES_PER_SAMPLE, measured: false };
    return { bytesPerSample: Math.round(bytes / sampleCount), measured: true };
  } catch {
    return { bytesPerSample: ESTIMATED_BYTES_PER_SAMPLE, measured: false };
  }
}
