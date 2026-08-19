import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { pollingSchema } from "../../core/config.schema.ts";
import type { ChannelConfig, ConfigSource, RuntimeConfig } from "../../core/configSource.interface.ts";
import { fileConfigSchema, REQUIRED_CHANNEL_SETTINGS } from "./schema.ts";

const ENV_REFERENCE = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Reads `config.yml` into a RuntimeConfig.
 *
 * Every failure here is fatal by design: a container that starts with a
 * half-understood configuration is worse than one that refuses to start and says
 * why, because silent misconfiguration shows up as missing alerts.
 *
 * Secrets are never written in the file. `${VAR}` references are resolved from
 * the environment, and an unresolved reference is reported by variable name.
 */
export async function loadConfig(path: string, env: NodeJS.ProcessEnv): Promise<RuntimeConfig> {
  const raw = await readConfigFile(path);

  let document: unknown;
  try {
    document = parse(raw);
  } catch (error) {
    throw new Error(
      `config file ${path} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const unresolved = new Map<string, string[]>();
  const substituted = substitute(document, env, [], unresolved);

  // Checked before validation: an unresolved reference leaves an empty string
  // behind, and the schema would then complain about the blank value rather than
  // about the variable that was never set. Channels are deferred until their
  // `enabled` flag is known, since a disabled channel needs no secret.
  for (const [dotted, names] of unresolved) {
    if (dotted.startsWith("notifications.")) continue;
    throw new Error(
      `config file ${path}: ${dotted} references ${names.join(", ")}, which is not set in the environment`,
    );
  }

  const result = fileConfigSchema.safeParse(substituted);
  if (!result.success) {
    throw new Error(
      `config file ${path} is invalid: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const file = result.data;

  const seen = new Set<string>();
  for (const service of file.services) {
    if (seen.has(service.id)) {
      throw new Error(`config file ${path} defines the service id "${service.id}" more than once`);
    }
    seen.add(service.id);
  }

  const channels = buildChannels(file.notifications, unresolved, path);

  return {
    polling: pollingSchema.parse({
      ...(file.pollIntervalMinutes === undefined ? {} : { intervalMinutes: file.pollIntervalMinutes }),
      ...(file.requestTimeoutSeconds === undefined ? {} : { requestTimeoutSeconds: file.requestTimeoutSeconds }),
      ...(file.maxRetries === undefined ? {} : { maxRetries: file.maxRetries }),
      ...(file.failureThreshold === undefined ? {} : { failureThreshold: file.failureThreshold }),
    }),
    locale: file.locale ?? "en",
    services: file.services,
    channels,
  };
}

/** Re-reads the file on every load, so editing it applies on the next cycle. */
export function createFileConfigSource(path: string, env: NodeJS.ProcessEnv): ConfigSource {
  return { load: () => loadConfig(path, env) };
}

async function readConfigFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`config file ${path} was not found — mount it or set CONFIG_PATH`);
    }
    throw error;
  }
}

type RawChannel = { enabled: boolean } & Record<string, unknown>;

function buildChannels(
  notifications: Record<string, RawChannel | undefined>,
  unresolved: Map<string, string[]>,
  path: string,
): ChannelConfig[] {
  const channels: ChannelConfig[] = [];

  for (const [id, raw] of Object.entries(notifications)) {
    if (raw === undefined) continue;
    const settings: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key !== "enabled" && typeof value === "string") settings[key] = value;
    }

    if (raw.enabled) {
      for (const required of REQUIRED_CHANNEL_SETTINGS[id] ?? []) {
        if ((settings[required] ?? "") !== "") continue;
        const names = unresolved.get(`notifications.${id}.${required}`);
        throw new Error(
          names === undefined
            ? `config file ${path}: the ${id} channel is enabled but ${required} is empty`
            : `config file ${path}: the ${id} channel is enabled but ${names.join(", ")} is not set in the environment`,
        );
      }
    }

    channels.push({ id, enabled: raw.enabled, settings });
  }

  return channels;
}

/**
 * Replaces `${VAR}` in every string of the document, recording where a reference
 * could not be resolved so the caller can name the variable rather than the
 * value it never saw.
 */
function substitute(
  value: unknown,
  env: NodeJS.ProcessEnv,
  path: string[],
  unresolved: Map<string, string[]>,
): unknown {
  if (typeof value === "string") {
    const missing: string[] = [];
    const replaced = value.replace(ENV_REFERENCE, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined || resolved === "") {
        missing.push(name);
        return "";
      }
      return resolved;
    });
    if (missing.length > 0) unresolved.set(path.join("."), missing);
    return replaced;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => substitute(entry, env, [...path, String(index)], unresolved));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, substitute(entry, env, [...path, key], unresolved)]),
    );
  }

  return value;
}
