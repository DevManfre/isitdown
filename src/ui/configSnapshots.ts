import { type DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Logger } from "../core/logger.ts";
import { diffConfigYaml, exportConfigYaml, importConfigYaml, type ConfigDiff, type ImportReport } from "./configFile.ts";

/**
 * Named configuration snapshots (roadmap 5.8): "save the fleet as
 * *before-the-migration*", and put it back later.
 *
 * A snapshot is the `config.yml` export kept as text, so saving and restoring
 * ride the same validated path as the file import — nothing here knows the
 * shape of a provider. Credentials are `${VAR}` references in that text, which
 * is why a snapshot can sit in the database and in a backup without carrying a
 * secret. History is never part of one: restoring moves the configuration, not
 * the samples.
 */

export const SNAPSHOT_NAME_MAX = 80;

export const snapshotNameSchema = z.string().trim().min(1).max(SNAPSHOT_NAME_MAX);

export interface SnapshotSummary {
  id: number;
  name: string;
  createdAt: string;
  /** Providers the snapshot holds, so the list says how big each one is. */
  services: number;
}

const rowSchema = z.object({ id: z.number(), name: z.string(), yaml: z.string(), created_at: z.string() });

const countServices = (yaml: string): number => (yaml.match(/^ {2}- id: /gm) ?? []).length;

const summary = (row: z.infer<typeof rowSchema>): SnapshotSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  services: countServices(row.yaml),
});

export function listSnapshots(db: DatabaseSync): SnapshotSummary[] {
  return db
    .prepare("SELECT id, name, yaml, created_at FROM config_snapshots ORDER BY created_at DESC, id DESC")
    .all()
    .map((row) => summary(rowSchema.parse(row)));
}

function readSnapshot(db: DatabaseSync, id: number): z.infer<typeof rowSchema> | undefined {
  const row = db.prepare("SELECT id, name, yaml, created_at FROM config_snapshots WHERE id = ?").get(id);
  return row === undefined ? undefined : rowSchema.parse(row);
}

export class SnapshotNameTaken extends Error {
  constructor(name: string) {
    super(`a snapshot called "${name}" already exists`);
  }
}

/** Saves the configuration as it stands. Throws `SnapshotNameTaken` on a repeated name. */
export function saveSnapshot(db: DatabaseSync, name: string, logger: Logger, at: Date = new Date()): SnapshotSummary {
  const clean = snapshotNameSchema.parse(name);
  const taken = db.prepare("SELECT 1 AS one FROM config_snapshots WHERE name = ?").get(clean);
  if (taken !== undefined) throw new SnapshotNameTaken(clean);
  const yaml = exportConfigYaml(db, logger);
  const result = db
    .prepare("INSERT INTO config_snapshots (name, yaml, created_at) VALUES (?, ?, ?)")
    .run(clean, yaml, at.toISOString());
  const row = readSnapshot(db, Number(result.lastInsertRowid));
  if (row === undefined) throw new Error("snapshot vanished after insert");
  return summary(row);
}

export function deleteSnapshot(db: DatabaseSync, id: number): boolean {
  return db.prepare("DELETE FROM config_snapshots WHERE id = ?").run(id).changes > 0;
}

/** What restoring would change, without changing it. Undefined for an unknown id. */
export function previewSnapshot(db: DatabaseSync, id: number, logger: Logger): ConfigDiff | undefined {
  const row = readSnapshot(db, id);
  return row === undefined ? undefined : diffConfigYaml(db, row.yaml, logger);
}

export interface RestoredSnapshot {
  report: ImportReport;
  /** The snapshot taken of the configuration just before it was replaced. */
  safety: SnapshotSummary;
}

/**
 * Puts a snapshot back through the file import. The configuration being
 * replaced is saved first under `Before restoring <name>`, so a restore is
 * itself undoable. Undefined for an unknown id.
 */
export function restoreSnapshot(
  db: DatabaseSync,
  id: number,
  logger: Logger,
  at: Date = new Date(),
): RestoredSnapshot | undefined {
  const row = readSnapshot(db, id);
  if (row === undefined) return undefined;
  // Validate before saving the safety copy, so a snapshot the current schema
  // refuses leaves no stray entry behind.
  diffConfigYaml(db, row.yaml, logger);
  const stem = `Before restoring ${row.name}`.slice(0, SNAPSHOT_NAME_MAX - 21);
  const safety = saveSnapshot(db, `${stem} ${at.toISOString().slice(0, 19)}Z`, logger, at);
  const report = importConfigYaml(db, row.yaml, logger);
  return { report, safety };
}
