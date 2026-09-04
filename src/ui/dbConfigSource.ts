import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  componentSelectionSchema,
  localeSchema,
  pollingSchema,
  routingRuleSchema,
  routingRulesSchema,
  serviceDefinitionSchema,
} from "../core/config.schema.ts";
import type {
  ChannelConfig,
  ConfigSource,
  RuntimeConfig,
  ServiceDefinition,
} from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";
import { CATCH_ALL_RULE } from "../core/routing.ts";
import type { RoutingRule } from "../core/routing.ts";

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
  /**
   * Which geographic view the Overview draws, if any. `off` is the default
   * because a fleet of functional-component providers has nothing to place, and
   * an empty world map is worse than no card.
   */
  mapView: z.enum(["off", "map", "globe"]).catch("off"),
});

export type Settings = z.infer<typeof settingsSchema>;

export type MapView = Settings["mapView"];

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
  components: z.string().nullable(),
  scope_to_components: z.number(),
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
    .prepare(
      "SELECT id, name, adapter, base_url, options, enabled, components, scope_to_components FROM services ORDER BY id",
    )
    .all()
    .map((row) => serviceRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      components:
        row.components === null ? [] : componentSelectionSchema.catch([]).parse(JSON.parse(row.components)),
      scopeToComponents: row.scope_to_components === 1,
      ...(row.options === null ? {} : { options: JSON.parse(row.options) as Record<string, string> }),
    }));
}

export function insertService(db: DatabaseSync, definition: ServiceDefinition): void {
  const parsed = serviceDefinitionSchema.parse(definition);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    parsed.id,
    parsed.name,
    parsed.adapter,
    parsed.baseUrl,
    parsed.options === undefined ? null : JSON.stringify(parsed.options),
    parsed.enabled ? 1 : 0,
    parsed.components.length === 0 ? null : JSON.stringify(parsed.components),
    parsed.scopeToComponents ? 1 : 0,
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
  if (parsed.components !== undefined) {
    columns["components"] = parsed.components.length === 0 ? null : JSON.stringify(parsed.components);
  }
  if (parsed.scopeToComponents !== undefined) {
    columns["scope_to_components"] = parsed.scopeToComponents ? 1 : 0;
  }
  if (Object.keys(columns).length === 0) return exists(db, id);

  const assignments = Object.keys(columns)
    .map((column) => `${column} = ?`)
    .join(", ");
  const result = db
    .prepare(`UPDATE services SET ${assignments} WHERE id = ?`)
    .run(...Object.values(columns), id);
  return result.changes > 0;
}

export interface ServiceImpact {
  samples: number;
  componentSamples: number;
  incidents: number;
  maintenances: number;
  routingRules: number;
  historyDays: number;
}

/**
 * What `deleteService` would take with it. Read-only, and deliberately next to
 * the delete it describes: the cascade lives in the schema, so the only way the
 * two stay in step is for a new `ON DELETE CASCADE` table to be visible from
 * here when it is added.
 *
 * Returns null for an unknown id, like `updateService` returns false, so the
 * route can answer 404 rather than a confident row of zeros.
 *
 * Rules naming "*" are not counted: they survive the removal (see
 * `deleteService`), and a confirmation that claims otherwise is worse than one
 * that says nothing.
 */
export function describeServiceImpact(db: DatabaseSync, id: string): ServiceImpact | null {
  if (!exists(db, id)) return null;
  const count = (sql: string): number =>
    z.object({ n: z.number() }).parse(db.prepare(sql).get(id)).n;
  const oldest = z
    .object({ oldest: z.string().nullable() })
    .parse(db.prepare("SELECT MIN(observed_at) AS oldest FROM status_samples WHERE provider_id = ?").get(id))
    .oldest;
  const oldestMs = oldest === null ? null : Date.parse(oldest);
  return {
    samples: count("SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = ?"),
    componentSamples: count("SELECT COUNT(*) AS n FROM component_samples WHERE provider_id = ?"),
    incidents: count("SELECT COUNT(*) AS n FROM incidents WHERE provider_id = ?"),
    maintenances: count("SELECT COUNT(*) AS n FROM maintenances WHERE provider_id = ?"),
    routingRules: count("SELECT COUNT(*) AS n FROM routing_rules WHERE provider = ?"),
    // Rounded up: a provider polled for an hour has lost "a day of history",
    // not zero. An unparseable timestamp counts as no history rather than NaN.
    historyDays:
      oldestMs === null || Number.isNaN(oldestMs)
        ? 0
        : Math.ceil((Date.now() - oldestMs) / 86_400_000),
  };
}

export function deleteService(db: DatabaseSync, id: string): boolean {
  const deleted = db.prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
  if (deleted) {
    // No FK could do this: "*" is not a service id. A rule left naming a deleted
    // provider would match nothing and quietly sit in the list forever. Only
    // when a row actually went away — a 404 on an unknown id must not mutate.
    db.prepare("DELETE FROM routing_rules WHERE provider = ?").run(id);
  }
  return deleted;
}

const routingRowSchema = z.object({
  provider: z.string(),
  classes: z.string(),
  min_severity: z.string(),
  channels: z.string(),
});

/**
 * Rules in evaluation order. A row that cannot be read is dropped and counted
 * rather than served: routing is the one setting where a silent drop changes
 * behaviour in both directions — losing a muting rule resumes notifications,
 * losing a broad rule stops them — so the count reaches the dashboard and the
 * error reaches the log.
 */
export function listRoutingRules(
  db: DatabaseSync,
  logger: Logger,
): { rules: RoutingRule[]; invalid: number } {
  const rules: RoutingRule[] = [];
  let invalid = 0;

  for (const raw of db
    .prepare("SELECT provider, classes, min_severity, channels FROM routing_rules ORDER BY position, id")
    .all()) {
    const row = routingRowSchema.safeParse(raw);
    if (!row.success) {
      invalid += 1;
      logger.error("skipping an unreadable routing rule row", {
        issues: row.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      continue;
    }

    let parsed;
    try {
      parsed = routingRuleSchema.safeParse({
        provider: row.data.provider,
        classes: JSON.parse(row.data.classes),
        minSeverity: row.data.min_severity,
        channels: JSON.parse(row.data.channels),
      });
    } catch (error) {
      invalid += 1;
      logger.error("skipping a routing rule row with unparseable JSON", {
        provider: row.data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!parsed.success) {
      invalid += 1;
      logger.error("skipping an invalid routing rule row", {
        provider: row.data.provider,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
      continue;
    }
    rules.push(parsed.data);
  }

  return { rules, invalid };
}

/**
 * Rewrites the whole list in one transaction. Whole-list rather than per-row so
 * that reordering cannot interleave: two concurrent per-row position updates
 * settle in an order neither writer asked for, and the dashboard holds the full
 * list anyway.
 */
export function replaceRoutingRules(db: DatabaseSync, rules: RoutingRule[]): void {
  // Validated before anything is deleted: a rejected write must leave the
  // previous rules in place, not an empty table.
  const validated = routingRulesSchema.parse(rules);

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM routing_rules");
    const insert = db.prepare(
      "INSERT INTO routing_rules (position, provider, classes, min_severity, channels) VALUES (?, ?, ?, ?, ?)",
    );
    validated.forEach((rule, index) => {
      insert.run(index, rule.provider, JSON.stringify(rule.classes), rule.minSeverity, JSON.stringify(rule.channels));
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The API shape, mirroring `describeChannels`. */
export function describeRouting(
  db: DatabaseSync,
  logger: Logger,
): { rules: RoutingRule[]; invalidRules: number } {
  const { rules, invalid } = listRoutingRules(db, logger);
  return { rules, invalidRules: invalid };
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
    for (const [key, value] of Object.entries(patch.fields)) {
      if (!key.endsWith(ENV_SUFFIX)) {
        throw new Error(
          `channel ${id}: only environment variable references may be stored, so "${key}" must be named "${key}${ENV_SUFFIX}" and hold a variable name`,
        );
      }
      // A blank reference is not "unconfigured", it is a hole: emptying one
      // *Env field first and then pointing a second field at the variable the
      // first used to name is how a same-value alias sneaks past the
      // collision check below in two separate, individually-legal-looking
      // requests. There is no legitimate reason to store an empty variable
      // name, so refuse it outright.
      if (value === "") {
        throw new Error(`channel ${id}: "${key}" must name an environment variable, so it cannot be blank`);
      }
    }
    config = { ...config, ...patch.fields };

    // Two different *Env fields must never end up naming the same variable, and
    // this has to hold across every channel, not only the one being patched —
    // otherwise a field on one channel (say webpush's "public" key) can be
    // aliased onto a variable another channel already uses for a real secret
    // (say Telegram's bot token). A name stored here decides which environment
    // variable's *value* a route later hands back (see GET /config/push), and
    // this dashboard has no authentication in front of this PATCH, so that
    // alias is a live credential-disclosure path, not just a config mistake.
    // Check every channel's merged config (existing fields plus this patch),
    // not just the patch, so a one-field patch that collides with an
    // already-stored field — in this channel or another — is caught too.
    //
    // Scoped to patch.fields !== undefined: an enabled-only toggle touches no
    // *Env field at all, so it cannot introduce a collision, and running this
    // scan unconditionally meant a database that already had two *Env fields
    // sharing a variable name (from before this guard existed, or a direct
    // edit) locked the operator out of toggling *any* channel with a 400 about
    // a field they never touched.
    const merged = listChannels(db).map((channel) => (channel.id === id ? { ...channel, config } : channel));
    const byVariable = new Map<string, string>();
    for (const channel of merged) {
      for (const [key, value] of Object.entries(channel.config)) {
        if (!key.endsWith(ENV_SUFFIX) || value === "") continue;
        const identity = `${channel.id}.${key}`;
        const collidingIdentity = byVariable.get(value);
        if (collidingIdentity !== undefined) {
          throw new Error(
            `channel ${id}: patching would leave "${identity}" and "${collidingIdentity}" both referencing "${value}" — two different secrets cannot share one environment variable`,
          );
        }
        byVariable.set(value, identity);
      }
    }
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

      const routing = listRoutingRules(db, logger);

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
        // An empty table can only happen if an operator deleted every rule.
        // Falling back keeps "no rules" from meaning "no notifications", which
        // is a state nobody chooses on purpose.
        rules: routing.rules.length === 0 ? [CATCH_ALL_RULE] : routing.rules,
      };
    },
  };
}

const exists = (db: DatabaseSync, id: string): boolean =>
  db.prepare("SELECT 1 AS one FROM services WHERE id = ?").get(id) !== undefined;
