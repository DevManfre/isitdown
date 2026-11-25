import { dirname, join } from "node:path";
import { SOURCE_LOCALE, t } from "../core/i18n/index.ts";
import { openDatabase } from "./db/open.ts";
import { downgradeFloor, migrateDown } from "./db/migrateDown.ts";

/**
 * `node dist/ui/server.js --migrate-down <N>` — roadmap 10.2. Takes the schema
 * down to `N` for an image rollback, copying the file to
 * `<data>/backups/pre-down-v<N>.db` first, and returns the exit code. Words on
 * stdout and stderr: run by hand, read by a person.
 */
export function runMigrateDown(dbPath: string, arg: string | undefined): number {
  const target = Number(arg);
  if (arg === undefined || !Number.isInteger(target)) {
    process.stderr.write(`${t(SOURCE_LOCALE, "ui.migrateDown.usage", { floor: downgradeFloor() })}\n`);
    return 2;
  }
  let db;
  try {
    db = openDatabase(dbPath);
    const report = migrateDown(db, target, { backupDir: join(dirname(dbPath), "backups") });
    process.stdout.write(
      `${t(SOURCE_LOCALE, "ui.migrateDown.done", { from: report.from, to: report.to, backup: report.backup ?? "-" })}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `${t(SOURCE_LOCALE, "ui.migrateDown.failed", { detail: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
