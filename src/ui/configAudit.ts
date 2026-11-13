import type { NextFunction, Request, Response } from "express";
import { type DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Logger } from "../core/logger.ts";
import { buildConfigDocument } from "./configFile.ts";
import {
  listServices,
  readSettings,
  replaceRecipients,
  replaceRoutingRules,
  restoreService,
  softDeleteService,
  updateChannel,
  updateService,
  writeSettings,
} from "./dbConfigSource.ts";

/**
 * Configuration history (roadmap 5.7): every write that moved a value, with
 * when, who, what it was and what it became — an audit trail with no identity
 * system behind it.
 *
 * The trail is *derived*, not hand-instrumented: a middleware reads the
 * configuration (the same document `config.yml` exports, plus each provider's
 * mute) before a write and after it, and records the difference. A new route
 * that edits configuration is therefore audited without anyone remembering to
 * say so, and what is recorded is exactly what changed rather than what the
 * request claimed.
 *
 * The document holds `${VAR}` references, never credential values, so the trail
 * cannot leak one. A credential being set or cleared (`secrets.env`, outside
 * the document) is recorded as an event with no value at all.
 */

/** Rows kept; the oldest go first. A trail nobody prunes would outgrow the fleet it describes. */
export const AUDIT_KEEP = 5000;

export type AuditKind = "service" | "setting" | "channel" | "routing" | "recipients" | "credential";

export interface AuditChange {
  kind: AuditKind;
  target: string;
  /** `*` for a provider added or removed as a whole. */
  field: string;
  before: unknown;
  after: unknown;
}

export interface AuditEntry extends AuditChange {
  id: number;
  at: string;
  actor: string;
  method: string;
  route: string;
  /** Whether "restore this value" can be offered: the old value is known and writable. */
  revertible: boolean;
}

/** The configuration as the audit sees it: the export, with each provider's mute added. */
export function auditDocument(db: DatabaseSync, logger: Logger): unknown {
  const document = buildConfigDocument(db, logger);
  const mutes = new Map(listServices(db).map((service) => [service.id, service.mutedUntil ?? null]));
  const services = (document["services"] as { id: string }[]).map((service) => ({
    ...service,
    mutedUntil: mutes.get(service.id) ?? null,
  }));
  // Round-tripped so `undefined` keys vanish and two equal values compare equal.
  // Dashboard-only settings the file format has no place for, but a write moves.
  const settings = readSettings(db, logger);
  const extra = {
    retentionDays: settings.retentionDays,
    updateCheckEnabled: settings.updateCheckEnabled,
    catalogFeedEnabled: settings.catalogFeedEnabled,
  };
  return JSON.parse(JSON.stringify({ ...document, ...extra, services }));
}

type Doc = {
  services?: ({ id: string } & Record<string, unknown>)[];
  notifications?: Record<string, Record<string, unknown>>;
  routing?: unknown;
  recipients?: unknown;
} & Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What moved between two audit documents, one change per top-level value. */
export function diffAuditDocuments(beforeDoc: unknown, afterDoc: unknown): AuditChange[] {
  const before = beforeDoc as Doc;
  const after = afterDoc as Doc;
  const out: AuditChange[] = [];

  const was = new Map((before.services ?? []).map((service) => [service.id, service]));
  const now = new Map((after.services ?? []).map((service) => [service.id, service]));
  for (const [id, service] of now) {
    const old = was.get(id);
    if (old === undefined) {
      out.push({ kind: "service", target: id, field: "*", before: null, after: { name: service["name"] } });
      continue;
    }
    for (const field of new Set([...Object.keys(old), ...Object.keys(service)])) {
      if (field === "id" || same(old[field], service[field])) continue;
      out.push({ kind: "service", target: id, field, before: old[field] ?? null, after: service[field] ?? null });
    }
  }
  for (const [id, service] of was) {
    if (!now.has(id)) out.push({ kind: "service", target: id, field: "*", before: { name: service["name"] }, after: null });
  }

  const skip = new Set(["services", "notifications", "routing", "recipients"]);
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.has(field) || same(before[field], after[field])) continue;
    out.push({ kind: "setting", target: "settings", field, before: before[field] ?? null, after: after[field] ?? null });
  }

  const channelsBefore = before.notifications ?? {};
  const channelsAfter = after.notifications ?? {};
  for (const id of new Set([...Object.keys(channelsBefore), ...Object.keys(channelsAfter)])) {
    const a = channelsBefore[id] ?? {};
    const b = channelsAfter[id] ?? {};
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!same(a[field], b[field])) out.push({ kind: "channel", target: id, field, before: a[field] ?? null, after: b[field] ?? null });
    }
  }

  if (!same(before.routing, after.routing)) out.push({ kind: "routing", target: "routing", field: "rules", before: before.routing ?? [], after: after.routing ?? [] });
  if (!same(before.recipients, after.recipients)) out.push({ kind: "recipients", target: "recipients", field: "list", before: before.recipients ?? [], after: after.recipients ?? [] });
  return out;
}

/** Settings a revert can write back as they are: scalars. `delivery` is derived from several keys. */
const SETTING_ALIASES: Record<string, string> = { locale: "uiLocale" };

function revertibleChange(change: AuditChange): boolean {
  switch (change.kind) {
    case "credential":
      return false;
    case "service":
      return change.field === "*" || change.before !== null || NULLABLE_SERVICE_FIELDS.has(change.field);
    case "setting":
      return ["number", "boolean", "string"].includes(typeof change.before);
    case "channel":
      return change.field === "enabled" ? typeof change.before === "boolean" : typeof change.before === "string" || change.before === null;
    case "routing":
    case "recipients":
      return Array.isArray(change.before);
  }
}

/** Provider fields a null clears — the same ones the service patch takes null for. */
const NULLABLE_SERVICE_FIELDS = new Set([
  "intervalMinutes", "intervalSeconds", "mutedUntil", "group", "dependsOn", "crossChecks",
  "slaTarget", "outageCostPerHour", "impact", "owner", "runbook", "tags", "muteSchedules", "maintenanceWindows",
]);

const rowSchema = z.object({
  id: z.number(), at: z.string(), actor: z.string(), method: z.string(), route: z.string(),
  kind: z.enum(["service", "setting", "channel", "routing", "recipients", "credential"]),
  target: z.string(), field: z.string(), before: z.string().nullable(), after: z.string().nullable(),
});

const entryOf = (row: z.infer<typeof rowSchema>): AuditEntry => {
  const change: AuditChange = {
    kind: row.kind, target: row.target, field: row.field,
    before: row.before === null ? null : JSON.parse(row.before),
    after: row.after === null ? null : JSON.parse(row.after),
  };
  return { ...change, id: row.id, at: row.at, actor: row.actor, method: row.method, route: row.route, revertible: revertibleChange(change) };
};

export interface AuditContext {
  at: Date;
  actor: string;
  method: string;
  route: string;
}

export function recordChanges(db: DatabaseSync, changes: AuditChange[], context: AuditContext): void {
  if (changes.length === 0) return;
  const insert = db.prepare(
    "INSERT INTO config_audit (at, actor, method, route, kind, target, field, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const text = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));
  db.exec("BEGIN");
  try {
    for (const change of changes) {
      insert.run(context.at.toISOString(), context.actor, context.method, context.route, change.kind, change.target, change.field, text(change.before), text(change.after));
    }
    db.prepare("DELETE FROM config_audit WHERE id <= (SELECT MAX(id) FROM config_audit) - ?").run(AUDIT_KEEP);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface AuditQuery {
  kind?: AuditKind | undefined;
  target?: string | undefined;
  limit: number;
}

/** Newest first. */
export function listAudit(db: DatabaseSync, query: AuditQuery): AuditEntry[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (query.kind !== undefined) { where.push("kind = ?"); args.push(query.kind); }
  if (query.target !== undefined) { where.push("target = ?"); args.push(query.target); }
  const sql = `SELECT id, at, actor, method, route, kind, target, field, before, after FROM config_audit${where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`} ORDER BY at DESC, id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, query.limit).map((row) => entryOf(rowSchema.parse(row)));
}

export function readAuditEntry(db: DatabaseSync, id: number): AuditEntry | undefined {
  const row = db.prepare("SELECT id, at, actor, method, route, kind, target, field, before, after FROM config_audit WHERE id = ?").get(id);
  return row === undefined ? undefined : entryOf(rowSchema.parse(row));
}

const ENV_REFERENCE = /^\$\{([A-Z0-9_]+)\}$/;

/**
 * Writes an entry's old value back. The write is an ordinary one, so the
 * middleware records the revert itself in the trail. Throws a readable message
 * when the old value is no longer valid (a channel renamed away, a schema that
 * grew a rule).
 */
export function revertEntry(db: DatabaseSync, entry: AuditEntry): void {
  if (!entry.revertible) throw new Error("this change cannot be restored: its old value is not one the dashboard can write back");
  const { kind, target, field, before } = entry;
  switch (kind) {
    case "service":
      if (field === "*") {
        if (before === null) {
          if (!softDeleteService(db, target)) throw new Error(`service ${target} is already gone`);
        } else if (!restoreService(db, target)) {
          throw new Error(`service ${target} cannot be restored: it was removed for good`);
        }
        return;
      }
      if (!updateService(db, target, { [field]: before } as never)) throw new Error(`service ${target} no longer exists`);
      return;
    case "setting":
      writeSettings(db, { [SETTING_ALIASES[field] ?? field]: before } as never);
      return;
    case "channel": {
      if (field === "enabled") {
        if (!updateChannel(db, target, { enabled: before as boolean })) throw new Error(`channel ${target} no longer exists`);
        return;
      }
      const reference = typeof before === "string" ? ENV_REFERENCE.exec(before) : null;
      if (typeof before === "string" && reference === null) throw new Error(`${target}.${field}: the old value is not an environment reference`);
      if (!updateChannel(db, target, { fields: { [`${field}Env`]: reference === null ? "" : (reference[1] as string) } })) {
        throw new Error(`channel ${target} no longer exists`);
      }
      return;
    }
    case "routing":
      replaceRoutingRules(db, before as never);
      return;
    case "recipients":
      replaceRecipients(db, before as never);
      return;
    case "credential":
      throw new Error("a credential is never restored from the trail");
  }
}

/** Where the actor comes from: the named request header, else `local`. */
export function actorOf(req: Request, headerName: string | undefined): string {
  if (headerName === undefined || headerName === "") return "local";
  const raw = req.header(headerName);
  // Control characters dropped by code point: a header value can carry any byte
  // the proxy let through, and none of them belongs in a log line or a list.
  const clean =
    typeof raw === "string"
      ? [...raw].filter((char) => (char.codePointAt(0) ?? 0) > 0x1f).join("").trim().slice(0, 120)
      : "";
  return clean === "" ? "local" : clean;
}

const SECRETS_ROUTE = /^\/config\/channels\/([^/]+)\/secrets(?:\/([^/]+))?$/;
/** Writes that replace the whole database or only read: the diff would be noise. */
const UNAUDITED = /^\/config\/(restore|backup|storage|push|snapshots(?:\/\d+)?$|catalog)/;

export interface AuditOptions {
  db: DatabaseSync;
  logger: Logger;
  /** `AUDIT_ACTOR_HEADER`: which request header names the actor. */
  actorHeader: string | undefined;
}

/**
 * Wraps every configuration write: reads the document before, lets the handler
 * run, and records what moved once it answered below 400. A failure to audit is
 * logged and never turned into a failed write — the trail is observation.
 */
export function auditWrites(options: AuditOptions) {
  const { db, logger } = options;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const route = `${req.baseUrl}${req.path}`;
    if (UNAUDITED.test(route)) return next();

    let before: unknown;
    try {
      before = auditDocument(db, logger);
    } catch (error) {
      logger.warn("config audit: could not read the configuration before a write", { error: String(error) });
      return next();
    }

    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      try {
        const context: AuditContext = { at: new Date(), actor: actorOf(req, options.actorHeader), method: req.method, route };
        // Roadmap 6.10: the AI key is a credential like a channel's — recorded
        // as set or cleared, never with a value.
        if (route === "/config/ai/key" || route === "/config/ai/cli-token") {
          recordChanges(db, [{ kind: "credential", target: "ai", field: route.slice("/config/ai/".length), before: null, after: req.method === "DELETE" ? "cleared" : "set" }], context);
          return;
        }
        const secrets = SECRETS_ROUTE.exec(route);
        if (secrets !== null) {
          const channel = secrets[1] as string;
          const named = secrets[2];
          recordChanges(db, [{ kind: "credential", target: channel, field: named ?? "*", before: null, after: req.method === "DELETE" ? "cleared" : "set" }], context);
          return;
        }
        recordChanges(db, diffAuditDocuments(before, auditDocument(db, logger)), context);
      } catch (error) {
        logger.warn("config audit: could not record a write", { error: String(error) });
      }
    });
    next();
  };
}
