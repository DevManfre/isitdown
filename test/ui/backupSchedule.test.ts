import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../src/core/logger.ts";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate, SCHEMA_VERSION } from "../../src/ui/db/migrate.ts";
import { writeSettings } from "../../src/ui/dbSettings.ts";
import {
  AUTO_PREFIX,
  backupFileName,
  createBackupScheduler,
  readBackupPolicy,
  readBackupState,
  rotateBackups,
} from "../../src/ui/backupSchedule.ts";
import { readUploadTargets, signS3Put } from "../../src/ui/backupUpload.ts";
import { selfFindings, type SelfSignals } from "../../src/ui/selfMonitor.ts";
import { manualClock } from "../helpers/manualClock.ts";

/**
 * Scheduled backups — roadmap 10.1. The timer on an injected clock, rotation,
 * the file reopened and checked, the failure handed to the self-monitor, and
 * the two upload targets.
 */

const silent = createLogger("error", () => {});

async function instance(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-scheduled-backup-"));
  const dbPath = join(dir, "isitdown.db");
  const db = openDatabase(dbPath);
  migrate(db);
  return { dir, dbPath, db, env: { BACKUP_DIR: join(dir, "backups"), ...env } };
}

/** Lets the promise chain a fired timer started run to its end. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("the timer fires on the cron expression and the rotation keeps the newest N", async () => {
  const { dir, dbPath, db, env } = await instance();
  writeSettings(db, { backupCron: "0 3 * * *", backupKeep: 2 });
  const clock = manualClock("2026-11-24T01:00:00.000Z");
  const scheduler = createBackupScheduler({ db, dbPath, env, logger: silent, clock, timeZone: () => "UTC" });
  scheduler.start();
  assert.equal(scheduler.nextAt(), "2026-11-24T03:00:00.000Z");

  clock.advance(2 * 3_600_000 - 1);
  await settle();
  await assert.rejects(readdir(join(dir, "backups")), "nothing before three");

  for (let day = 0; day < 3; day++) {
    clock.advance(day === 0 ? 1 : 24 * 3_600_000);
    await settle();
  }
  scheduler.stop();

  const files = (await readdir(join(dir, "backups"))).sort();
  assert.deepEqual(files, [
    backupFileName(new Date("2026-11-25T03:00:00.000Z")),
    backupFileName(new Date("2026-11-26T03:00:00.000Z")),
  ]);
  const state = readBackupState(db);
  assert.equal(state.lastOkAt, "2026-11-26T03:00:00.000Z");
  assert.equal(state.lastError, null);
  db.close();
});

test("the file a scheduled backup writes reopens, passes integrity_check and carries no VAPID key", async () => {
  const { dbPath, db, env } = await instance();
  db.prepare("INSERT INTO settings (key, value) VALUES ('vapidPrivateKey', 'secret')").run();
  const scheduler = createBackupScheduler({ db, dbPath, env, logger: silent });
  const result = await scheduler.runNow();
  assert.equal(result.ok, true, result.error ?? "");

  const copy = new DatabaseSync(result.file!, { readOnly: true });
  try {
    const [{ integrity_check }] = copy.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    assert.equal(integrity_check, "ok");
    const [{ user_version }] = copy.prepare("PRAGMA user_version").all() as { user_version: number }[];
    assert.equal(user_version, SCHEMA_VERSION);
    assert.equal(copy.prepare("SELECT 1 FROM settings WHERE key = 'vapidPrivateKey'").get(), undefined);
  } finally {
    copy.close();
  }
  db.close();
});

test("off by default: no schedule, no timer, no next run", async () => {
  const { dbPath, db, env } = await instance();
  const clock = manualClock();
  const scheduler = createBackupScheduler({ db, dbPath, env, logger: silent, clock });
  scheduler.start();
  assert.equal(scheduler.nextAt(), null);
  assert.equal(scheduler.policy().source.cron, "default");
  db.close();
});

test("the environment wins over the dashboard, and says so", async () => {
  const { dbPath, db, env } = await instance({ BACKUP_CRON: "15 4 * * *", BACKUP_KEEP: "30" });
  writeSettings(db, { backupCron: "0 3 * * *", backupKeep: 2 });
  const policy = readBackupPolicy(db, dbPath, env, silent);
  assert.deepEqual(
    { cron: policy.cron, keep: policy.keep, source: policy.source },
    { cron: "15 4 * * *", keep: 30, source: { cron: "env", keep: "env" } },
  );
  db.close();
});

test("rotation leaves alone every file it did not write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-rotate-"));
  for (const name of ["pre-v42.db", "isitdown-2026-11-01.db", "notes.txt"]) await writeFile(join(dir, name), "");
  for (let day = 1; day <= 4; day++) await writeFile(join(dir, backupFileName(new Date(Date.UTC(2026, 10, day)))), "");
  const deleted = rotateBackups(dir, 1);
  assert.equal(deleted.length, 3);
  assert.ok(deleted.every((name) => name.startsWith(AUTO_PREFIX)));
  assert.deepEqual((await readdir(dir)).sort(), [
    "isitdown-2026-11-01.db",
    backupFileName(new Date(Date.UTC(2026, 10, 4))),
    "notes.txt",
    "pre-v42.db",
  ]);
});

test("a failed backup is written down, and the self-monitor reports it on its database component", async () => {
  const { dir, dbPath, db } = await instance();
  // A file where the folder should be: the copy cannot be made.
  await writeFile(join(dir, "not-a-folder"), "");
  const scheduler = createBackupScheduler({ db, dbPath, env: { BACKUP_DIR: join(dir, "not-a-folder") }, logger: silent });
  const result = await scheduler.runNow();
  assert.equal(result.ok, false);
  const state = readBackupState(db);
  assert.ok(state.lastError !== null);
  assert.equal(state.lastOkAt, null, "never run is not the same as worked");

  const signals: SelfSignals = {
    now: Date.now(),
    bootedAt: Date.now() - 60_000,
    cycles: [],
    providers: [],
    failureThreshold: 5,
    failedDeliveries: 0,
    freeBytes: null,
    backupError: state.lastError,
  };
  const findings = selfFindings(signals);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.component, "database");
  assert.match(findings[0]!.note, /scheduled backup failed/);

  // The next one that works clears it.
  const fixed = createBackupScheduler({ db, dbPath, env: { BACKUP_DIR: join(dir, "backups") }, logger: silent });
  assert.equal((await fixed.runNow()).ok, true);
  assert.equal(readBackupState(db).lastError, null);
  db.close();
});

test("each backup is PUT to WebDAV with the URL's own credentials, and a refusal fails the run", async () => {
  const { dbPath, db, env } = await instance({ BACKUP_WEBDAV_URL: "https://alice:p%40ss@dav.example/backups" });
  const calls: { url: string; auth: string | null; bytes: number }[] = [];
  let status = 201;
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), auth: headers.get("authorization"), bytes: (init.body as Uint8Array).byteLength });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  const scheduler = createBackupScheduler({ db, dbPath, env, logger: silent, fetchImpl });

  const result = await scheduler.runNow();
  assert.equal(result.ok, true, result.error ?? "");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /^https:\/\/dav\.example\/backups\/isitdown-auto-.*\.db$/);
  assert.equal(calls[0]!.auth, `Basic ${Buffer.from("alice:p@ss").toString("base64")}`);
  assert.ok(calls[0]!.bytes > 0);
  assert.equal(scheduler.policy().uploads[0]!.label, "https://dav.example/backups/", "no password in what is shown");

  status = 507;
  const failed = await scheduler.runNow();
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? "", /507/);
  db.close();
});

test("S3 takes its keys from the URL, and the signature is AWS's own published one", () => {
  assert.throws(() => readUploadTargets({ BACKUP_S3_URL: "https://s3.example/bucket" }), /access key/);
  const [s3] = readUploadTargets({ BACKUP_S3_URL: "https://AKIA:se%2Fcret@minio.lan:9000/backups/isitdown?region=eu-south-1" });
  assert.equal(s3!.label, "https://minio.lan:9000/backups/isitdown/", "no key and no secret in what is shown");

  // AWS Signature Version 4, "Example: PUT Object".
  const headers = signS3Put(
    new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
    Buffer.from("Welcome to Amazon S3."),
    { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" },
    new Date("2013-05-24T00:00:00Z"),
    { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
  );
  assert.match(headers["authorization"]!, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test("each backup is PUT to S3, signed for the URL's region, with no key in the request URL", async () => {
  const { dbPath, db, env } = await instance({ BACKUP_S3_URL: "https://AKIA:se%2Fcret@minio.lan:9000/backups?region=eu-south-1" });
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const result = await createBackupScheduler({ db, dbPath, env, logger: silent, fetchImpl }).runNow();
  assert.equal(result.ok, true, result.error ?? "");
  assert.match(calls[0]!.url, /^https:\/\/minio\.lan:9000\/backups\/isitdown-auto-.*\.db$/);
  assert.match(calls[0]!.auth ?? "", /^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/eu-south-1\/s3\/aws4_request, /);
  db.close();
});
