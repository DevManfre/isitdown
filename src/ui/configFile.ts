import { parse, stringify } from "yaml";
import { type DatabaseSync } from "node:sqlite";
import type { Logger } from "../core/logger.ts";
import { FILE_CHANNEL_IDS, fileConfigSchema } from "../light/config/schema.ts";
import {
  deliveryOf,
  insertService,
  listChannels,
  listRoutingRules,
  listServices,
  readSettings,
  replaceRoutingRules,
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
      ...(service.options === undefined ? {} : { options: service.options }),
      ...(service.mutedUntil === undefined ? {} : { mutedUntil: service.mutedUntil }),
      ...(service.components.length === 0 ? {} : { components: service.components }),
      ...(service.scopeToComponents ? { scopeToComponents: true } : {}),
    })),
    notifications,
    routing: listRoutingRules(db, logger).rules,
    delivery,
  };

  return `${HEADER}${stringify(document, { lineWidth: 0 })}`;
}

const HEADER = `# IsItDown configuration, exported from the UI edition (see README §4.3).
#
# This is a Light edition config.yml: mount it at /app/config/config.yml and the
# Light image runs this fleet as it stands. Credentials are references, not
# values — every \${VAR} has to exist in the environment the edition runs in.
`;

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

  const settings = {
    pollIntervalMinutes: file.pollIntervalMinutes,
    requestTimeoutSeconds: file.requestTimeoutSeconds,
    maxRetries: file.maxRetries,
    failureThreshold: file.failureThreshold,
    adaptivePolling: file.adaptivePolling,
    adaptiveIntervalMinutes: file.adaptiveIntervalMinutes,
    confirmSamples: file.confirmSamples,
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

  for (const service of file.services) {
    if (existing.has(service.id)) {
      updateService(db, service.id, {
        name: service.name,
        baseUrl: service.baseUrl,
        enabled: service.enabled,
        intervalMinutes: service.intervalMinutes ?? null,
        components: service.components,
        scopeToComponents: service.scopeToComponents,
        ...(service.options === undefined ? {} : { options: service.options }),
      });
      report.updated.push(service.id);
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

  logger.info("configuration imported", {
    added: report.added.length,
    updated: report.updated.length,
    removed: report.removed.length,
  });
  return report;
}
