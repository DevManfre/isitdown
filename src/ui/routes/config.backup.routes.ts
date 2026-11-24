import { dirname, join } from "node:path";
import type { Router } from "express";
import { resetValidators } from "../../core/http.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { createBackup, restoreBackup } from "../dbBackup.ts";
import { noteInstallEvent } from "../installHealth.ts";
import { z } from "zod";
import { KEEP_MAX, readBackupState } from "../backupSchedule.ts";
import { parseCron } from "../cron.ts";
import { writeSettings } from "../dbSettings.ts";
import { issues } from "./config.shared.ts";

/** Roadmap 10.1: either field alone, as the dashboard's rows save one at a time. */
const schedulePatchSchema = z
  .object({
    cron: z.string().trim().max(100).optional(),
    keep: z.number().int().min(1).max(KEEP_MAX).optional(),
  })
  .strict();

export function configBackupRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  /**
   * Scheduled backups — roadmap 10.1. The policy in force, where each half of
   * it came from, the folder, the upload targets (labels only, never a key),
   * and the last and next run: everything the Data section shows.
   */
  const describeSchedule = () => {
    const policy = runtime.backups.policy();
    return {
      cron: policy.cron,
      keep: policy.keep,
      dir: policy.dir,
      source: policy.source,
      uploads: policy.uploads.map((target) => ({ kind: target.kind, label: target.label })),
      nextAt: runtime.backups.nextAt(),
      ...readBackupState(db),
    };
  };

  router.get("/config/backup/schedule", (_req, res) => {
    try {
      res.json(describeSchedule());
    } catch (error) {
      // An upload target the environment names wrongly: said, not a 500 page.
      res.status(500).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  router.put("/config/backup/schedule", (req, res) => {
    const parsed = schedulePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const { cron, keep } = parsed.data;
    if (cron !== undefined && cron !== "") {
      try {
        parseCron(cron);
      } catch (error) {
        res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
        return;
      }
    }
    // A value the environment sets would be saved and then never used: refused
    // with the reason, rather than accepted and silently shadowed.
    const policy = runtime.backups.policy();
    const shadowed = [
      ...(cron !== undefined && policy.source.cron === "env" ? ["BACKUP_CRON"] : []),
      ...(keep !== undefined && policy.source.keep === "env" ? ["BACKUP_KEEP"] : []),
    ];
    if (shadowed.length > 0) {
      res.status(409).json({ error: { message: `set by the environment (${shadowed.join(", ")}); change it there` } });
      return;
    }
    writeSettings(db, { backupCron: cron, backupKeep: keep });
    runtime.backups.reschedule();
    res.json(describeSchedule());
  });

  /** A backup now, on the schedule's own path: same folder, rotation and uploads. */
  router.post("/config/backup/run", async (_req, res) => {
    const result = await runtime.backups.runNow();
    res.status(result.ok ? 200 : 500).json({ ...describeSchedule(), ...(result.ok ? {} : { error: { message: result.error } }) });
  });

  /**
   * The whole database, as one file (roadmap 4.4). `VACUUM INTO` rather than a
   * read of the file on disk: the poller writes while this streams, and WAL
   * keeps the newest pages in a second file beside it, so copying the bytes as
   * they are would hand back a torn snapshot.
   *
   * The header says in words what the download does not carry: `secrets.env`
   * holds the channel credentials and stays here. A backup that silently
   * omitted them would be discovered on the one day it matters. The web-push
   * VAPID key pair (two `settings` rows) is left out for the same reason: its
   * private half signs push messages as this server.
   */
  router.get("/config/backup", (_req, res) => {
    const snapshot = createBackup(db);
    noteInstallEvent(db, "backup");
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${snapshot.filename}"`,
    );
    res.setHeader("x-isitdown-secrets", "excluded");
    res.send(snapshot.bytes);
  });

  /**
   * The same file, put back. The upload is brought up to the current schema as
   * its own database and then copied in table by table inside one transaction,
   * so the handle the rest of the runtime holds stays valid and the dashboard
   * shows the restored fleet without a restart.
   *
   * Destructive by definition — it replaces every row this edition stores — so
   * everything that can be checked is checked before the first `DELETE`: the
   * magic bytes, the tables, and the schema version, which may be older but
   * never newer than this build reads.
   */
  router.post("/config/restore", (req, res) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res
        .status(400)
        .json({
          error: {
            message:
              "send the .db file as the request body, as application/octet-stream",
          },
        });
      return;
    }

    let report;
    try {
      report = restoreBackup(
        db,
        body,
        join(dirname(runtime.dbPath), "secrets.env"),
      );
    } catch (error) {
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      return;
    }

    // Every provider in the file is a different provider now, so a cached
    // `ETag` from the fleet that was here would revalidate the wrong reading.
    resetValidators();
    runtime.logger.warn("the database was restored from a backup", {
      services: report.tables["services"] ?? 0,
      samples: report.tables["status_samples"] ?? 0,
    });
    res.json(report);
  });
}
