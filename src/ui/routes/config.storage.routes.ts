import type { Router } from "express";
import { listServices, readSettings } from "../dbConfigSource.ts";
import { runDbMaintenance } from "../dbMaintenance.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { storageReport } from "../storageReport.ts";

export function configStorageRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  /**
   * What the retention setting costs on disk. Kept apart from `GET /config`
   * because it measures the database on every read, and because the dashboard
   * wants it while the operator is still typing a number.
   */
  router.get("/config/storage", (_req, res) => {
    const settings = readSettings(db, runtime.logger);
    res.json(
      storageReport(db, {
        providerCount: listServices(db).filter((service) => service.enabled)
          .length,
        intervalMinutes: settings.pollIntervalMinutes,
      }),
    );
  });

  /**
   * Roadmap 6.13. `PRAGMA integrity_check` then `VACUUM`, in that order: a file
   * whose pages are already wrong must not be rewritten. Answers with the bytes
   * the vacuum returned, which is what finishes the sentence the storage report
   * above starts — the daily prune deletes rows, and until this runs, sqlite
   * keeps their pages.
   *
   * A `POST` because it rewrites the database, and on its own path rather than
   * as a flag on the read for the same reason.
   */
  router.post("/config/storage/maintenance", (_req, res) => {
    // A failed check is a real answer, not a request error: the operator asked
    // whether the file is sound and now knows that it is not.
    res.json(runDbMaintenance(db));
  });
}
