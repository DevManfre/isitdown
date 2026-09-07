import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { writeSettings } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { NormalizedStatus } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

const snap = (fetchedAt: string): NormalizedStatus => ({
  provider: "github",
  overallStatus: "operational",
  activeIncidents: [],
  components: [],
  maintenances: [],
  fetchedAt,
});

const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

/**
 * The prune runs on boot, so retention is proved across two runtimes over one
 * database: the first seeds the samples and the setting, the second prunes.
 */
test("the boot prune honours the configured retention rather than a fixed window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-rt-retention-"));
  const dbPath = join(dir, "isitdown.db");

  const first = await buildUiRuntime({ dbPath, env: {}, logger: silent });
  await first.store.saveStatus(snap(daysAgo(40)));
  await first.store.saveStatus(snap(daysAgo(2)));
  writeSettings(first.db, { retentionDays: 7 });
  await first.close();

  const second = await buildUiRuntime({ dbPath, env: {}, logger: silent });
  try {
    const rows = second.db.prepare("SELECT observed_at FROM status_samples").all() as {
      observed_at: string;
    }[];
    assert.equal(rows.length, 1, "the 40-day-old sample is past a 7-day retention");
  } finally {
    await second.close();
  }
});
