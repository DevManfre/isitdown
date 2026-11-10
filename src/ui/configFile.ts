import { parse, stringify } from "yaml";
import { z } from "zod";
import { type DatabaseSync } from "node:sqlite";
import { cadenceProblems } from "../adapters/index.ts";
import type { Logger } from "../core/logger.ts";
import { FILE_CHANNEL_IDS, fileConfigSchema } from "../light/config/schema.ts";
import {
  deliveryOf,
  insertService,
  listChannels,
  listRecipients,
  listRoutingRules,
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
 * The UI edition's configuration as the Light edition's own `config.yml`, and
 * back (roadmap 4.3).
 *
 * Everything the dashboard configures lives in one SQLite file, which makes a
 * backup a database copy and makes "try it in the UI edition, then run it in
 * Light" a retyping exercise. A round trip through the file format both
 * editions already validate against is the cheapest honest answer to both: the
 * export is a file Light can be started on unchanged, and the import is that
 * same file read back.
 *
 * Secrets never appear in either direction. The dashboard stores the *name* of
 * the environment variable carrying a credential, so the export writes
 * `${TELEGRAM_BOT_TOKEN}` — the same reference an operator would have written by
 * hand — and the import refuses a literal, because a config file that ends up
 * in a git history must not be able to carry one.
 */

/** How the environment reference is written in the file, both ways. */
const ENV_REFERENCE = /^\$\{([A-Z0-9_]+)\}$/;
const ENV_SUFFIX = "Env";

export function exportConfigYaml(db: DatabaseSync, logger: Logger): string {
  return `${HEADER}${stringify(buildConfigDocument(db, logger), { lineWidth: 0 })}`;
}

/** The configuration as the plain object the file format serialises. */
export function buildConfigDocument(db: DatabaseSync, logger: Logger): Record<string, unknown> {
  const settings = readSettings(db, logger);
  const delivery = deliveryOf(settings);

  const notifications: Record<string, Record<string, unknown>> = {};
  for (const channel of listChannels(db)) {
    // Webpush and anything else the file format has no place for is skipped
    // rather than written: a `config.yml` carrying a key the Light loader
    // rejects is not a config.yml, it is a file that refuses to start.
    if (!FILE_CHANNEL_IDS.includes(channel.id)) continue;
    const fields: Record<string, unknown> = { enabled: channel.enabled };
    for (const [key, envVar] of Object.entries(channel.config)) {
      if (!key.endsWith(ENV_SUFFIX) || envVar === "") continue;
      fields[key.slice(0, -ENV_SUFFIX.length)] = `\${${envVar}}`;
    }
    notifications[channel.id] = fields;
  }

  const document = {
    pollIntervalMinutes: settings.pollIntervalMinutes,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    maxRetries: settings.maxRetries,
    failureThreshold: settings.failureThreshold,
    adaptivePolling: settings.adaptivePolling,
    adaptiveIntervalMinutes: settings.adaptiveIntervalMinutes,
    confirmSamples: settings.confirmSamples,
    correlationThreshold: settings.correlationThreshold,
    correlationWindowMinutes: settings.correlationWindowMinutes,
    locale: settings.uiLocale,
    // Exactly what the file schema takes, field for field: a service that
    // round-trips through this must come back the same service.
    services: listServices(db).map((service) => ({
      id: service.id,
      name: service.name,
      adapter: service.adapter,
      baseUrl: service.baseUrl,
      enabled: service.enabled,
      ...(service.intervalMinutes === undefined ? {} : { intervalMinutes: service.intervalMinutes }),
      ...(service.intervalSeconds === undefined ? {} : { intervalSeconds: service.intervalSeconds }),
      ...(service.options === undefined ? {} : { options: service.options }),
      ...(service.mutedUntil === undefined ? {} : { mutedUntil: service.mutedUntil }),
      ...(service.components.length === 0 ? {} : { components: service.components }),
      ...(service.scopeToComponents ? { scopeToComponents: true } : {}),
      ...(service.favorite === true ? { favorite: true } : {}),
      ...(service.group === undefined ? {} : { group: service.group }),
      ...(service.dependsOn === undefined
        ? {}
        : { dependsOn: service.dependsOn }),
      ...(service.crossChecks === undefined ? {} : { crossChecks: service.crossChecks }),
      ...(service.slaTarget === undefined ? {} : { slaTarget: service.slaTarget }),
      ...(service.outageCostPerHour === undefined ? {} : { outageCostPerHour: service.outageCostPerHour }),
      ...(service.impact === undefined ? {} : { impact: service.impact }),
      ...(service.owner === undefined ? {} : { owner: service.owner }),
      ...(service.runbook === undefined ? {} : { runbook: service.runbook }),
      ...(service.tags === undefined ? {} : { tags: service.tags }),
      ...(service.muteSchedules === undefined ? {} : { muteSchedules: service.muteSchedules }),
      ...(service.maintenanceWindows === undefined ? {} : { maintenanceWindows: service.maintenanceWindows }),
    })),
    notifications,
    routing: listRoutingRules(db, logger).rules,
    delivery,
    // Only the channels the file format has, for the reason `notifications`
    // skips the rest; a recipient left with fewer than two is no recipient.
    recipients: listRecipients(db, logger)
      .map((recipient) => ({
        ...recipient,
        channels: recipient.channels.filter((channel) => FILE_CHANNEL_IDS.includes(channel)),
      }))
      .filter((recipient) => recipient.channels.length >= 2),
  };

  return document;
}

const HEADER = `# IsItDown configuration, exported from the UI edition (see README §4.3).
#
# This is a Light edition config.yml: mount it at /app/config/config.yml and the
# Light image runs this fleet as it stands. Credentials are references, not
# values — every \${VAR} has to exist in the environment the edition runs in.
`;

type ConfigFile = z.infer<typeof fileConfigSchema>;

interface ValidatedConfig {
  file: ConfigFile;
  channelWrites: { id: string; enabled: boolean; fields: Record<string, string> }[];
}

/**
 * Everything an import checks before its first write, as one function so the
 * preview (roadmap 5.9) refuses exactly what the import refuses: YAML, the
 * file schema, duplicate ids, cadences, literal credentials, unknown channels.
 */
function validateConfigSource(db: DatabaseSync, source: string): ValidatedConfig {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    throw new Error(`not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = fileConfigSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error(
      `invalid config file: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const file = parsed.data;

  const duplicate = file.services.find(
    (service, index) => file.services.findIndex((other) => other.id === service.id) !== index,
  );
  if (duplicate !== undefined) {
    throw new Error(`the file defines the service id "${duplicate.id}" more than once`);
  }

  // Checked before the first write for the same reason as the credentials
  // below: a cadence the runtime would refuse (roadmap 1.6) changes nothing.
  for (const service of file.services) {
    const problems = cadenceProblems(service);
    if (problems.length > 0) throw new Error(`service ${service.id}: ${problems.join("; ")}`);
  }

  // Every credential is checked before the first write, so a file with one
  // literal secret in it changes nothing at all rather than half the fleet.
  const channelWrites: { id: string; enabled: boolean; fields: Record<string, string> }[] = [];
  const known = new Set(listChannels(db).map((channel) => channel.id));
  for (const [id, raw] of Object.entries(file.notifications)) {
    if (raw === undefined) continue;
    if (!known.has(id)) throw new Error(`unknown notification channel: ${id}`);
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "enabled" || typeof value !== "string" || value === "") continue;
      const reference = ENV_REFERENCE.exec(value);
      if (reference === null) {
        throw new Error(
          `${id}.${key} must be an environment reference like \${MY_VARIABLE}, never a literal value`,
        );
      }
      fields[`${key}${ENV_SUFFIX}`] = reference[1] as string;
    }
    channelWrites.push({ id, enabled: raw.enabled, fields });
  }

  // A recipient naming a channel this edition does not have is refused here,
  // before the first write, like a literal credential above.
  for (const recipient of file.recipients ?? []) {
    const unknown = recipient.channels.find((channel) => !known.has(channel));
    if (unknown !== undefined) throw new Error(`recipient ${recipient.id}: unknown notification channel: ${unknown}`);
  }

  return { file, channelWrites };
}

export interface ImportReport {
  /** Service ids, by what the import did with each. */
  added: string[];
  updated: string[];
  /** Present in the database, absent from the file: removed the same way the dashboard removes. */
  removed: string[];
  /** Channel ids whose enablement or references the file changed. */
  channels: string[];
  routingRules: number;
  /** Settings the file carried, so a report can say what it moved. */
  settings: string[];
}

/**
 * Reads a `config.yml` back into the dashboard's database.
 *
 * A service the file does not mention is removed the way the dashboard's own
 * remove works — soft, restorable, history intact — rather than purged: an
 * import is a configuration statement, and it must not be a data-loss event.
 *
 * Throws on anything the file schema rejects, and on a literal credential,
 * before writing anything.
 */
export function importConfigYaml(db: DatabaseSync, source: string, logger: Logger): ImportReport {
  const { file, channelWrites } = validateConfigSource(db, source);

  const settings = {
    pollIntervalMinutes: file.pollIntervalMinutes,
    requestTimeoutSeconds: file.requestTimeoutSeconds,
    maxRetries: file.maxRetries,
    failureThreshold: file.failureThreshold,
    adaptivePolling: file.adaptivePolling,
    adaptiveIntervalMinutes: file.adaptiveIntervalMinutes,
    confirmSamples: file.confirmSamples,
    correlationThreshold: file.correlationThreshold,
    correlationWindowMinutes: file.correlationWindowMinutes,
    uiLocale: file.locale,
    ...(file.delivery === undefined
      ? {}
      : {
          quietHoursEnabled: file.delivery.quietHours?.enabled,
          quietHoursStart: file.delivery.quietHours?.start,
          quietHoursEnd: file.delivery.quietHours?.end,
          quietHoursTimeZone: file.delivery.quietHours?.timeZone,
          quietHoursMinSeverity: file.delivery.quietHours?.minSeverity,
          digestEnabled: file.delivery.digest?.enabled,
          digestWindowMinutes: file.delivery.digest?.windowMinutes,
          digestImmediateFloor: file.delivery.digest?.immediateFloor,
          alertCapEnabled: file.delivery.cap?.enabled,
          alertCapPerHour: file.delivery.cap?.maxPerHour,
          updateInPlace: file.delivery.updateInPlace,
          maintenanceNoticeEnabled: file.delivery.maintenanceNotice?.enabled,
          maintenanceNoticeLeadMinutes: file.delivery.maintenanceNotice?.leadMinutes,
          escalationEnabled: file.delivery.escalation?.enabled,
          escalationAfterMinutes: file.delivery.escalation?.afterMinutes,
          escalationChannel: file.delivery.escalation?.channel,
          escalationMinSeverity: file.delivery.escalation?.minSeverity,
          channelHealthEnabled: file.delivery.channelHealth?.enabled,
          channelHealthAfterFailures: file.delivery.channelHealth?.afterFailures,
          incidentSummaryEnabled: file.delivery.incidentSummary?.enabled,
          coalesceEnabled: file.delivery.coalesce?.enabled,
          coalesceWindowMinutes: file.delivery.coalesce?.windowMinutes,
          knownOutageEnabled: file.delivery.knownOutage?.enabled,
          attachChart: file.delivery.attachChart,
          reportEnabled: file.delivery.report?.enabled,
          reportFrequency: file.delivery.report?.frequency,
          reportChannel: file.delivery.report?.channel,
          onCallEnabled: file.delivery.onCall?.enabled,
          onCallMinSeverity: file.delivery.onCall?.minSeverity,
          onCallRotation: file.delivery.onCall?.rotation?.join(","),
          onCallStartsOn: file.delivery.onCall?.startsOn,
          deliveryTestEnabled: file.delivery.deliveryTest?.enabled,
        }),
  };
  const carried = Object.entries(settings).filter(([, value]) => value !== undefined);
  writeSettings(db, Object.fromEntries(carried));

  const existing = new Set(listServices(db).map((service) => service.id));
  const report: ImportReport = {
    added: [],
    updated: [],
    removed: [],
    channels: [],
    routingRules: 0,
    settings: carried.map(([key]) => key),
  };

  const apply = (service: ConfigFile["services"][number]): void => {
    updateService(db, service.id, {
      name: service.name,
      baseUrl: service.baseUrl,
      enabled: service.enabled,
      intervalMinutes: service.intervalMinutes ?? null,
      intervalSeconds: service.intervalSeconds ?? null,
      components: service.components,
      scopeToComponents: service.scopeToComponents,
      favorite: service.favorite === true,
      // Null rather than omitted: an import is the file's whole fleet, so a
      // service that no longer carries a group or a cross-check has to lose
      // the one the database is still holding.
      group: service.group ?? null,
      dependsOn: service.dependsOn ?? null,
      crossChecks: service.crossChecks ?? null,
      slaTarget: service.slaTarget ?? null,
      outageCostPerHour: service.outageCostPerHour ?? null,
      impact: service.impact ?? null,
      owner: service.owner ?? null,
      runbook: service.runbook ?? null,
      tags: service.tags ?? null,
      muteSchedules: service.muteSchedules ?? null,
      maintenanceWindows: service.maintenanceWindows ?? null,
      ...(service.options === undefined ? {} : { options: service.options }),
    });
  };

  for (const service of file.services) {
    if (existing.has(service.id)) {
      apply(service);
      report.updated.push(service.id);
    } else if (restoreService(db, service.id)) {
      // Removed earlier and still inside its grace period: an insert would
      // collide with the row, and the history it kept is exactly what a
      // snapshot or an old file means to bring back.
      apply(service);
      report.added.push(service.id);
    } else {
      insertService(db, service);
      report.added.push(service.id);
    }
  }

  const inFile = new Set(file.services.map((service) => service.id));
  for (const id of existing) {
    if (inFile.has(id)) continue;
    if (softDeleteService(db, id)) report.removed.push(id);
  }

  for (const write of channelWrites) {
    updateChannel(db, write.id, {
      enabled: write.enabled,
      ...(Object.keys(write.fields).length === 0 ? {} : { fields: write.fields }),
    });
    report.channels.push(write.id);
  }

  // Absent means "leave the routing alone": a file written before routing
  // existed, or one an operator trimmed, must not silently flatten every rule
  // into the catch-all.
  if (file.routing !== undefined) {
    replaceRoutingRules(db, file.routing);
    report.routingRules = file.routing.length;
  }
  // Absent leaves the recipients alone, for the same reason.
  if (file.recipients !== undefined) replaceRecipients(db, file.recipients);

  logger.info("configuration imported", {
    added: report.added.length,
    updated: report.updated.length,
    removed: report.removed.length,
  });
  return report;
}

/** One value that would move, as dotted path plus both sides. */
export interface ConfigChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface ConfigDiff {
  services: {
    added: string[];
    removed: string[];
    changed: { id: string; changes: ConfigChange[] }[];
  };
  /** Polling, delivery and locale: every top-level setting the file would move. */
  settings: ConfigChange[];
  channels: { id: string; changes: ConfigChange[] }[];
  /** Null when the file leaves the rules alone (no `routing` block) or they are identical. */
  routing: { from: number; to: number } | null;
  recipients: { from: number; to: number } | null;
  /** True when importing the file would change nothing. */
  empty: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Leaves of a nested object by dotted path; arrays are atoms, compared whole. */
function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!isPlainObject(value)) {
    if (prefix !== "") out.set(prefix, value);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(child)) for (const [k, v] of flatten(child, path)) out.set(k, v);
    else out.set(path, child);
  }
  return out;
}

function changesBetween(before: unknown, after: unknown, skip: (path: string) => boolean = () => false): ConfigChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const out: ConfigChange[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (skip(path)) continue;
    const from = a.get(path);
    const to = b.get(path);
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ path, from, to });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/**
 * What importing `source` would do, without doing it (roadmap 5.9).
 *
 * Both sides go through the file schema, so a default the file leaves out and
 * the database holds explicitly is not reported as a change. The comparison
 * follows what the import writes: a service field the file omits is cleared
 * (except `options`, which an import leaves alone), a channel the file does not
 * mention is untouched, and an absent `routing` or `recipients` block leaves
 * the rules and the people alone.
 *
 * Throws what `importConfigYaml` throws on a file it would refuse.
 */
export function diffConfigYaml(db: DatabaseSync, source: string, logger: Logger): ConfigDiff {
  const { file } = validateConfigSource(db, source);
  const current = fileConfigSchema.parse(buildConfigDocument(db, logger));

  const before = new Map(current.services.map((service) => [service.id, service]));
  const incoming = new Set(file.services.map((service) => service.id));
  const added: string[] = [];
  const changed: ConfigDiff["services"]["changed"] = [];
  for (const service of file.services) {
    const existing = before.get(service.id);
    if (existing === undefined) {
      added.push(service.id);
      continue;
    }
    const changes = changesBetween(existing, service, (path) => service.options === undefined && path.startsWith("options"));
    if (changes.length > 0) changed.push({ id: service.id, changes });
  }
  const removed = current.services.map((service) => service.id).filter((id) => !incoming.has(id));

  const { services: _a, notifications: _b, routing: _c, recipients: _d, ...currentSettings } = current;
  const { services: _e, notifications: _f, routing: _g, recipients: _h, ...fileSettings } = file;
  const settings = changesBetween(currentSettings, fileSettings);

  const channels: ConfigDiff["channels"] = [];
  for (const [id, raw] of Object.entries(file.notifications)) {
    if (raw === undefined) continue;
    const changes = changesBetween(current.notifications[id as keyof typeof current.notifications] ?? {}, raw);
    if (changes.length > 0) channels.push({ id, changes });
  }

  const listDiff = (from: unknown[] | undefined, to: unknown[] | undefined) =>
    to === undefined || JSON.stringify(from ?? []) === JSON.stringify(to)
      ? null
      : { from: (from ?? []).length, to: to.length };
  const routing = listDiff(current.routing, file.routing);
  const recipients = listDiff(current.recipients, file.recipients);

  return {
    services: { added, removed, changed },
    settings,
    channels,
    routing,
    recipients,
    empty:
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      settings.length === 0 &&
      channels.length === 0 &&
      routing === null &&
      recipients === null,
  };
}
