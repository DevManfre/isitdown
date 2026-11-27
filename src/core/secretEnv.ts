import { readFileSync } from "node:fs";

/**
 * Secrets from files — roadmap 9.4.
 *
 * Docker Swarm, Compose and Kubernetes hand a secret over as a mounted file
 * (`/run/secrets/…`), not as a variable. Every neighbouring tool accepts
 * `NAME_FILE` beside `NAME`; this is that convention, in one place.
 *
 * Two ways in, both through `readSecretEnv`:
 *
 * - `applySecretFiles` runs once at each entrypoint, before anything reads the
 *   environment, and turns every `NAME_FILE` of a variable in `SECRET_ENV_VARS`
 *   into `NAME`. Code that reads `TELEGRAM_BOT_TOKEN` straight from the env — and
 *   there is a lot of it — needs no change.
 * - A name the operator chose (`${GITHUB_TOKEN}` in `config.yml`, a channel's
 *   `…Env` setting, a probe's credentials) cannot be listed in advance, so the
 *   places that resolve such a reference call `readSecretEnv` themselves.
 */

/**
 * Every variable this project documents as a secret: a token, a password, a key,
 * or a URL whose path *is* the credential (a webhook, a heartbeat ping). A
 * server's plain base URL is not here — it is not secret, and accepting a file
 * for it would only blur which variables are.
 */
export const SECRET_ENV_VARS = [
  // Notification channels
  "TELEGRAM_BOT_TOKEN",
  "WEBHOOK_URL",
  "WEBHOOK_SECRET",
  "DISCORD_WEBHOOK_URL",
  "SLACK_WEBHOOK_URL",
  "NTFY_TOPIC_URL",
  "NTFY_TOKEN",
  "GOTIFY_TOKEN",
  "PUSHOVER_TOKEN",
  "PUSHOVER_USER_KEY",
  "TEAMS_WEBHOOK_URL",
  "MATRIX_ACCESS_TOKEN",
  "PAGERDUTY_ROUTING_KEY",
  "OPSGENIE_API_KEY",
  "APPRISE_CONFIG_KEY",
  "APPRISE_URLS",
  "SPLUNK_ONCALL_API_KEY",
  "SPLUNK_ONCALL_ROUTING_KEY",
  "SQUADCAST_WEBHOOK_URL",
  "ZENDUTY_INTEGRATION_KEY",
  "INCIDENT_IO_TOKEN",
  "GRAFANA_ONCALL_WEBHOOK_URL",
  "MATTERMOST_TOKEN",
  "ROCKETCHAT_TOKEN",
  "ZULIP_API_KEY",
  "GOOGLE_CHAT_WEBHOOK_URL",
  "TWILIO_SMS_AUTH_TOKEN",
  "TWILIO_CALL_AUTH_TOKEN",
  "BARK_DEVICE_KEY",
  "MQTT_PASSWORD",
  "MASTODON_ACCESS_TOKEN",
  "BLUESKY_APP_PASSWORD",
  "SMTP_PASSWORD",
  // Instance access
  "API_TOKEN",
  "PUSH_TOKEN",
  "HEARTBEAT_TOKEN",
  "OUTPOST_TOKEN",
  "ISITDOWN_TOKEN",
  // Outbound services
  "HEARTBEAT_URL",
  "HEARTBEAT_FAIL_URL",
  "BACKUP_S3_URL",
  "BACKUP_WEBDAV_URL",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "AI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "PROMETHEUS_TOKEN",
] as const;

/**
 * `*_FILE` variables that already mean something else. `LOG_FILE` is where the
 * log goes, not where a secret called `LOG` lives — a `${LOG}` reference must
 * never read the log back as a credential.
 */
const NOT_A_SECRET_FILE = new Set(["LOG_FILE"]);

const FILE_SUFFIX = "_FILE";

export class SecretEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretEnvError";
  }
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const readUtf8: ReadFile = (path) => readFileSync(path, "utf8");

/**
 * The value of `name`, from the variable itself or from the file `NAME_FILE`
 * points at, with one trailing newline removed (what `echo … > file` and every
 * editor leave behind). Unset either way is `undefined`, as for any variable.
 *
 * Both set is an error rather than a precedence rule: two sources for one
 * secret means one of them is stale, and guessing which is how a rotated token
 * keeps the old value.
 */
export function readSecretEnv(name: string, env: Env, readFile: ReadFile = readUtf8): string | undefined {
  const fileVariable = `${name}${FILE_SUFFIX}`;
  const path = NOT_A_SECRET_FILE.has(fileVariable) ? undefined : env[fileVariable];
  const direct = env[name];
  if (path === undefined || path === "") return direct;
  if (direct !== undefined && direct !== "") {
    throw new SecretEnvError(`both ${name} and ${fileVariable} are set: keep one of them`);
  }
  let content: string;
  try {
    content = readFile(path);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
    throw new SecretEnvError(`${fileVariable} points at ${path}, which cannot be read (${reason})`);
  }
  return content.replace(/\r?\n$/, "");
}

/**
 * Resolves every `NAME_FILE` of a known secret into `NAME`, in place, and
 * removes the `_FILE` variable so nothing later sees two sources. All problems
 * are collected before throwing: an operator fixing a compose file wants every
 * wrong line at once, not one per restart.
 */
export function applySecretFiles(
  env: Env,
  names: readonly string[] = SECRET_ENV_VARS,
  readFile: ReadFile = readUtf8,
): void {
  const problems: string[] = [];
  for (const name of names) {
    const fileVariable = `${name}${FILE_SUFFIX}`;
    if (env[fileVariable] === undefined || env[fileVariable] === "") continue;
    try {
      const value = readSecretEnv(name, env, readFile);
      if (value !== undefined) env[name] = value;
      delete env[fileVariable];
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length > 0) throw new SecretEnvError(problems.join("; "));
}
