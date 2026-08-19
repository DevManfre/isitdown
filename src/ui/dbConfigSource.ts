import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { localeSchema, pollingSchema, serviceDefinitionSchema } from "../core/config.schema.ts";
import type {
  ChannelConfig,
  ConfigSource,
  RuntimeConfig,
  ServiceDefinition,
} from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";

/**
 * The UI edition's configuration lives in SQLite and is read afresh every poll
 * cycle, which is what makes a dashboard edit take effect without a restart.
 *
 * Secrets are the one thing the database never holds. A channel row stores the
 * *name* of the environment variable carrying each credential — `botTokenEnv`,
 * `urlEnv` — and they are resolved here at load time. Nothing writes a value in,
 * and `describeChannels` is the only shape the API ever returns.
 *
 * Loading is deliberately forgiving where the Light edition is fatal: a running
 * dashboard that drops one bad provider is more useful than one that refuses to
 * serve, and the operator can see and fix the row in the UI.
 */

const ENV_SUFFIX = "Env";

export type ThemePreference = "light" | "dark" | "system";

const settingsSchema = z.object({
  pollIntervalMinutes: z.coerce.number().int().positive().max(1440).catch(3),
  requestTimeoutSeconds: z.coerce.number().int().positive().max(120).catch(8),
  maxRetries: z.coerce.number().int().positive().max(10).catch(3),
  failureThreshold: z.coerce.number().int().positive().max(100).catch(5),
  theme: z.enum(["light", "dark", "system"]).catch("system"),
  uiLocale: localeSchema.catch("en"),
  notificationLocale: localeSchema.catch("en"),
});

export type Settings = z.infer<typeof settingsSchema>;

const channelRowSchema = z.object({
  id: z.string(),
  enabled: z.number(),
  config: z.string(),
});

const serviceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  adapter: z.string(),
  base_url: z.string(),
  options: z.string().nullable(),
  enabled: z.number(),
});

export interface StoredChannel {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface DescribedField {
  name: string;
  envVar: string;
  isSet: boolean;
}

export interface DescribedChannel {
  id: string;
  enabled: boolean;
  fields: DescribedField[];
}

export function readSettings(db: DatabaseSync, logger: Logger): Settings {
  const raw = Object.fromEntries(
    db
      .prepare("SELECT key, value FROM settings")
      .all()
      .map((row) => z.object({ key: z.string(), value: z.string() }).parse(row))
      .map((row) => [row.key, row.value]),
  );

  const settings = settingsSchema.parse(raw);
  // `catch` above replaces an unusable value silently, so compare and say so.
  for (const [key, value] of Object.entries(settings)) {
    const stored = raw[key];
    if (stored !== undefined && stored !== String(value)) {
      logger.warn("setting fell back to its default", { key, stored });
    }
  }
  return settings;
}

export function writeSettings(db: DatabaseSync, patch: Partial<Record<keyof Settings, unknown>>): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    upsert.run(key, String(value));
  }
}

export function listServices(db: DatabaseSync): ServiceDefinition[] {
  return db
    .prepare("SELECT id, name, adapter, base_url, options, enabled FROM services ORDER BY id")
    .all()
    .map((row) => serviceRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      ...(row.options === null ? {} : { options: JSON.parse(row.options) as Record<string, string> }),
    }));
}

export function insertService(db: DatabaseSync, definition: ServiceDefinition): void {
  const parsed = serviceDefinitionSchema.parse(definition);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    parsed.id,
    parsed.name,
    parsed.adapter,
    parsed.baseUrl,
    parsed.options === undefined ? null : JSON.stringify(parsed.options),
    parsed.enabled ? 1 : 0,
    new Date().toISOString(),
  );
}

const servicePatchSchema = serviceDefinitionSchema.partial().omit({ id: true });

/** Returns false when there was no such service, so a route can answer 404. */
export function updateService(
  db: DatabaseSync,
  id: string,
  patch: z.input<typeof servicePatchSchema>,
): boolean {
  const parsed = servicePatchSchema.parse(patch);
  const columns: Record<string, string | number | null> = {};
  if (parsed.name !== undefined) columns["name"] = parsed.name;
  if (parsed.adapter !== undefined) columns["adapter"] = parsed.adapter;
  if (parsed.baseUrl !== undefined) columns["base_url"] = parsed.baseUrl;
  if (parsed.enabled !== undefined) columns["enabled"] = parsed.enabled ? 1 : 0;
  if (parsed.options !== undefined) columns["options"] = JSON.stringify(parsed.options);
  if (Object.keys(columns).length === 0) return exists(db, id);

  const assignments = Object.keys(columns)
    .map((column) => `${column} = ?`)
    .join(", ");
  const result = db
    .prepare(`UPDATE services SET ${assignments} WHERE id = ?`)
    .run(...Object.values(columns), id);
  return result.changes > 0;
}

export function deleteService(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
}

export function listChannels(db: DatabaseSync): StoredChannel[] {
  return db
    .prepare("SELECT id, enabled, config FROM channels ORDER BY id")
    .all()
    .map((row) => channelRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      enabled: row.enabled === 1,
      config: z.record(z.string()).parse(JSON.parse(row.config)),
    }));
}

export interface ChannelPatch {
  enabled?: boolean | undefined;
  /** Only `*Env` keys are accepted: the database stores references, not secrets. */
  fields?: Record<string, string> | undefined;
}

export function updateChannel(db: DatabaseSync, id: string, patch: ChannelPatch): boolean {
  const current = listChannels(db).find((channel) => channel.id === id);
  if (current === undefined) return false;

  let config = current.config;
  if (patch.fields !== undefined) {
    for (const key of Object.keys(patch.fields)) {
      if (!key.endsWith(ENV_SUFFIX)) {
        throw new Error(
          `channel ${id}: only environment variable references may be stored, so "${key}" must be named "${key}${ENV_SUFFIX}" and hold a variable name`,
        );
      }
    }
    config = { ...config, ...patch.fields };
  }

  db.prepare("UPDATE channels SET enabled = ?, config = ? WHERE id = ?").run(
    (patch.enabled ?? current.enabled) ? 1 : 0,
    JSON.stringify(config),
    id,
  );
  return true;
}

/** The only channel shape the API returns: names and whether they resolve. */
export function describeChannels(db: DatabaseSync, env: NodeJS.ProcessEnv): DescribedChannel[] {
  return listChannels(db).map((channel) => ({
    id: channel.id,
    enabled: channel.enabled,
    fields: Object.entries(channel.config)
      .filter(([key]) => key.endsWith(ENV_SUFFIX))
      .map(([key, envVar]) => ({
        name: key.slice(0, -ENV_SUFFIX.length),
        envVar,
        isSet: (env[envVar] ?? "") !== "",
      })),
  }));
}

export function createDbConfigSource(
  db: DatabaseSync,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): ConfigSource {
  return {
    async load(): Promise<RuntimeConfig> {
      const settings = readSettings(db, logger);

      const services: ServiceDefinition[] = [];
      for (const row of listServices(db)) {
        const parsed = serviceDefinitionSchema.safeParse(row);
        if (!parsed.success) {
          // One unusable row must not stop the other providers being polled.
          logger.warn("skipping an invalid service row", {
            providerId: row.id,
            issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
          });
          continue;
        }
        if (parsed.data.enabled) services.push(parsed.data);
      }

      const channels: ChannelConfig[] = listChannels(db).map((channel) => {
        const resolved: Record<string, string> = {};
        const missing: string[] = [];
        for (const [key, value] of Object.entries(channel.config)) {
          if (!key.endsWith(ENV_SUFFIX)) {
            resolved[key] = value;
            continue;
          }
          const name = key.slice(0, -ENV_SUFFIX.length);
          const fromEnv = env[value] ?? "";
          if (fromEnv === "") missing.push(value);
          else resolved[name] = fromEnv;
        }

        if (channel.enabled && missing.length > 0) {
          logger.warn("channel disabled for this cycle: its environment variables are not set", {
            channel: channel.id,
            missing,
          });
          return { id: channel.id, enabled: false, settings: resolved };
        }
        return { id: channel.id, enabled: channel.enabled, settings: resolved };
      });

      return {
        polling: pollingSchema.parse({
          intervalMinutes: settings.pollIntervalMinutes,
          requestTimeoutSeconds: settings.requestTimeoutSeconds,
          maxRetries: settings.maxRetries,
          failureThreshold: settings.failureThreshold,
        }),
        locale: settings.notificationLocale,
        services,
        channels,
      };
    },
  };
}

const exists = (db: DatabaseSync, id: string): boolean =>
  db.prepare("SELECT 1 AS one FROM services WHERE id = ?").get(id) !== undefined;
