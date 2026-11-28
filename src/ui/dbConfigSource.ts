import type { DatabaseSync } from "node:sqlite";
import {
  deliverySchema,
  pollingSchema,
  serviceDefinitionSchema,
} from "../core/config.schema.ts";
import {
  CHANNEL_MESSAGE_KEYS,
  type ChannelConfig,
  type ConfigSource,
  type RuntimeConfig,
  type ServiceDefinition,
} from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";
import { readSecretEnv } from "../core/secretEnv.ts";
import { CATCH_ALL_RULE } from "../core/routing.ts";
import { isOptionalSetting } from "../notifiers/settings.ts";
import { ENV_SUFFIX, readSettings, deliveryOf } from "./dbSettings.ts";
import { listServices } from "./dbServices.ts";
import { listRoutingRules, listRecipients } from "./dbRouting.ts";
import { listChannels } from "./dbChannels.ts";

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
            issues: parsed.error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            ),
          });
          continue;
        }
        if (parsed.data.enabled) services.push(parsed.data);
      }

      const channels: ChannelConfig[] = listChannels(db).map((channel) => {
        const resolved: Record<string, string> = {};
        const missing: string[] = [];
        for (const [key, value] of Object.entries(channel.config)) {
          // Not transport: how the message reads, not where it goes. Read off
          // below rather than resolved into `settings`, so a notifier factory
          // is never handed a setting it has no schema for.
          if ((CHANNEL_MESSAGE_KEYS as readonly string[]).includes(key))
            continue;
          if (!key.endsWith(ENV_SUFFIX)) {
            resolved[key] = value;
            continue;
          }
          const name = key.slice(0, -ENV_SUFFIX.length);
          // Roadmap 9.4: the name the operator chose accepts NAME_FILE too.
          // A broken file is logged, then treated like an unset variable.
          let fromEnv = "";
          try {
            fromEnv = readSecretEnv(value, env) ?? "";
          } catch (error) {
            logger.warn("channel variable cannot be read", {
              channel: channel.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          // An unset optional credential is not a broken channel: the webhook's
          // signing secret is offered as a field to every installation, and
          // most of them will never set it.
          if (fromEnv === "") {
            if (!isOptionalSetting(channel.id, name)) missing.push(value);
          } else resolved[name] = fromEnv;
        }

        const message = {
          ...(channel.config["locale"] === undefined
            ? {}
            : { locale: channel.config["locale"] }),
          ...(channel.config["template"] === undefined
            ? {}
            : { template: channel.config["template"] }),
        };

        if (channel.enabled && missing.length > 0) {
          logger.warn(
            "channel disabled for this cycle: its environment variables are not set",
            {
              channel: channel.id,
              missing,
            },
          );
          return {
            id: channel.id,
            enabled: false,
            ...message,
            settings: resolved,
          };
        }
        return {
          id: channel.id,
          enabled: channel.enabled,
          ...message,
          settings: resolved,
        };
      });

      const routing = listRoutingRules(db, logger);

      return {
        polling: pollingSchema.parse({
          intervalMinutes: settings.pollIntervalMinutes,
          requestTimeoutSeconds: settings.requestTimeoutSeconds,
          maxRetries: settings.maxRetries,
          failureThreshold: settings.failureThreshold,
          adaptivePolling: settings.adaptivePolling,
          adaptiveIntervalMinutes: settings.adaptiveIntervalMinutes,
          confirmSamples: settings.confirmSamples,
          correlationThreshold: settings.correlationThreshold,
          correlationWindowMinutes: settings.correlationWindowMinutes,
        }),
        locale: settings.notificationLocale,
        services,
        channels,
        // An empty table can only happen if an operator deleted every rule.
        // Falling back keeps "no rules" from meaning "no notifications", which
        // is a state nobody chooses on purpose.
        rules: routing.rules.length === 0 ? [CATCH_ALL_RULE] : routing.rules,
        // Through the shared schema, like the polling block above: the flat
        // rows are this edition's storage, and the policy's shape and defaults
        // stay the Light edition's too.
        delivery: deliverySchema.parse(deliveryOf(settings)),
        recipients: listRecipients(db, logger),
      };
    },
  };
}
