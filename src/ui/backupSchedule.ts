import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import { systemClock, type Clock, type ClockTimer } from "../core/clock.ts";
import type { Logger } from "../core/logger.ts";
import { snapshotInto } from "./db/snapshot.ts";
import { stripVapidKeys } from "./dbBackup.ts";
import { readSettings } from "./dbSettings.ts";
import { nextCronRun, parseCron } from "./cron.ts";
import { readUploadTargets, type UploadTarget } from "./backupUpload.ts";

/**
 * Scheduled backups — roadmap 10.1. The dashboard's download (4.4) is the
 * backup somebody remembers to take; this is the one that is there anyway.
 *
 * On a cron expression, `VACUUM INTO` a dated file in a mounted folder, keep
 * the newest N, and optionally PUT each one to WebDAV or S3. A failure is
 * written down where the self-monitor (10.6) reads it, so it reaches the
 * operator the way every other alert does — through the diff engine and the
 * notifiers — and never as a message sent from here.
 */

/** Every file this module writes starts so: rotation never touches anything else in the folder. */
export const AUTO_PREFIX = "isitdown-auto-";

export const KEEP_DEFAULT = 7;
export const KEEP_MAX = 365;

/** Longest a timer waits before looking again: a clock that jumped, a schedule edited elsewhere. */
const MAX_WAIT_MS = 3_600_000;

/** Rows the scheduler writes after each run, read back by the dashboard and the self-monitor. */
const STATE_KEYS = {
  attemptAt: "backupLastAttemptAt",
  okAt: "backupLastOkAt",
  file: "backupLastFile",
  error: "backupLastError",
} as const;

export type PolicySource = "env" | "settings" | "default";

export interface BackupPolicy {
  /** Empty when scheduled backups are off. */
  cron: string;
  keep: number;
  dir: string;
  /** Where `cron` and `keep` came from: an environment variable wins over the dashboard. */
  source: { cron: PolicySource; keep: PolicySource };
  uploads: UploadTarget[];
}

const keepSchema = z.coerce.number().int().min(1).max(KEEP_MAX);

/**
 * The policy in force: `BACKUP_CRON` and `BACKUP_KEEP` when set, else what the
 * dashboard saved. `BACKUP_DIR` is environment only — a path on the server is
 * what a mount decides, not a browser — and defaults to `<data>/backups`, beside
 * the pre-upgrade copies of 10.2.
 */
export function readBackupPolicy(db: DatabaseSync, dbPath: string, env: Record<string, string | undefined>, logger: Logger): BackupPolicy {
  const settings = readSettings(db, logger);
  const envCron = env["BACKUP_CRON"]?.trim();
  const envKeep = env["BACKUP_KEEP"]?.trim();
  const keepFromEnv = envKeep === undefined || envKeep === "" ? undefined : keepSchema.safeParse(envKeep);
  if (keepFromEnv?.success === false) logger.warn("BACKUP_KEEP ignored: not a whole number from 1 to 365", { value: envKeep });
  return {
    cron: envCron !== undefined && envCron !== "" ? envCron : settings.backupCron,
    keep: keepFromEnv?.success === true ? keepFromEnv.data : settings.backupKeep,
    dir: env["BACKUP_DIR"]?.trim() || join(dirname(dbPath), "backups"),
    source: {
      cron: envCron !== undefined && envCron !== "" ? "env" : settings.backupCron === "" ? "default" : "settings",
      keep: keepFromEnv?.success === true ? "env" : settings.backupKeep === KEEP_DEFAULT ? "default" : "settings",
    },
    uploads: readUploadTargets(env),
  };
}

/** `isitdown-auto-20261124T030000Z-v2.48.0.db`: sorts by name in the order taken, says which version wrote it. */
export function backupFileName(at: Date, version: string = pkg.version): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${AUTO_PREFIX}${stamp}Z-v${version}.db`;
}

/** Deletes all but the newest `keep` of this module's own files; returns what it deleted. */
export function rotateBackups(dir: string, keep: number): string[] {
  const ours = readdirSync(dir)
    .filter((name) => name.startsWith(AUTO_PREFIX) && name.endsWith(".db"))
    .sort()
    .reverse();
  const old = ours.slice(keep);
  for (const name of old) rmSync(join(dir, name), { force: true });
  return old;
}

export interface BackupState {
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  lastFile: string | null;
  /** Set while the most recent attempt failed; cleared by the next one that works. */
  lastError: string | null;
}

export function readBackupState(db: DatabaseSync): BackupState {
  const rows = new Map(
    (db
      .prepare(`SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)`)
      .all(STATE_KEYS.attemptAt, STATE_KEYS.okAt, STATE_KEYS.file, STATE_KEYS.error) as { key: string; value: string }[]).map(
      (row) => [row.key, row.value],
    ),
  );
  const read = (key: string): string | null => {
    const value = rows.get(key);
    return value === undefined || value === "" ? null : value;
  };
  return {
    lastAttemptAt: read(STATE_KEYS.attemptAt),
    lastOkAt: read(STATE_KEYS.okAt),
    lastFile: read(STATE_KEYS.file),
    lastError: read(STATE_KEYS.error),
  };
}

function writeState(db: DatabaseSync, patch: Partial<Record<(typeof STATE_KEYS)[keyof typeof STATE_KEYS], string>>): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) upsert.run(key, value);
}

export interface BackupRunResult {
  ok: boolean;
  file: string | null;
  error: string | null;
}

export interface BackupSchedulerDeps {
  db: DatabaseSync;
  dbPath: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  clock?: Clock;
  /** The zone the cron expression is read in: the instance's own setting. */
  timeZone?: () => string;
  fetchImpl?: typeof fetch;
}

export interface BackupScheduler {
  start(): void;
  stop(): void;
  /** Looks at the policy again — after the dashboard saved a new one. */
  reschedule(): void;
  /** Takes a backup now, whatever the schedule says. Never throws: the result says. */
  runNow(): Promise<BackupRunResult>;
  /** When the next scheduled one runs; null while off or with a schedule that never fires. */
  nextAt(): string | null;
  policy(): BackupPolicy;
}

export function createBackupScheduler(deps: BackupSchedulerDeps): BackupScheduler {
  const { db, logger } = deps;
  const clock = deps.clock ?? systemClock;
  const zone = (): string => {
    const value = deps.timeZone?.() ?? "auto";
    return value === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : value;
  };
  let timer: ClockTimer | null = null;
  let next: number | null = null;
  let running: Promise<BackupRunResult> | null = null;
  let started = false;

  const policy = (): BackupPolicy => readBackupPolicy(db, deps.dbPath, deps.env, logger);

  async function take(): Promise<BackupRunResult> {
    const at = new Date(clock.now());
    writeState(db, { [STATE_KEYS.attemptAt]: at.toISOString() });
    try {
      const current = policy();
      const name = backupFileName(at);
      const path = join(current.dir, name);
      // Without the web-push key pair, like the download: a file that may
      // travel to a bucket must not carry the key that signs this server's pushes.
      snapshotInto(db, path, stripVapidKeys);
      const deleted = rotateBackups(current.dir, current.keep);
      if (current.uploads.length > 0) {
        const body = readFileSync(path);
        for (const target of current.uploads) await target.put(name, body, deps.fetchImpl);
      }
      writeState(db, { [STATE_KEYS.okAt]: at.toISOString(), [STATE_KEYS.file]: path, [STATE_KEYS.error]: "" });
      logger.info("scheduled backup written", {
        file: path,
        rotated: deleted.length,
        uploaded: current.uploads.map((target) => target.label),
      });
      return { ok: true, file: path, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeState(db, { [STATE_KEYS.error]: message });
      logger.error("scheduled backup failed", { error: message });
      return { ok: false, file: null, error: message };
    }
  }

  function runNow(): Promise<BackupRunResult> {
    // One at a time: a press during a scheduled run gets that run's result.
    running ??= take().finally(() => {
      running = null;
    });
    return running;
  }

  function arm(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    next = null;
    if (!started) return;
    let current: BackupPolicy;
    try {
      current = policy();
      if (current.cron === "") return;
      next = nextCronRun(parseCron(current.cron), clock.now(), zone());
    } catch (error) {
      logger.error("scheduled backups are off: the schedule cannot be read", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (next === null) return;
    const due = next;
    timer = clock.setTimeout(() => {
      timer = null;
      if (clock.now() >= due) {
        void runNow().finally(arm);
      } else {
        arm();
      }
    }, Math.min(due - clock.now(), MAX_WAIT_MS));
    if (typeof timer === "object") timer.unref();
  }

  return {
    start() {
      started = true;
      arm();
    },
    stop() {
      started = false;
      arm();
    },
    reschedule: arm,
    runNow,
    nextAt: () => (next === null ? null : new Date(next).toISOString()),
    policy,
  };
}
