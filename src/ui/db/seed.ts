import type { DatabaseSync } from "node:sqlite";

/**
 * First-boot defaults, so a fresh container shows a working dashboard instead of
 * an empty grid. Providers are seeded only when the table is empty: an operator's
 * own list is never overwritten.
 *
 * Channels are seeded disabled and carry the *name* of the environment variable
 * holding each credential — never a value. That is the whole secret model of the
 * UI edition: the database stores references, the environment holds secrets.
 *
 * Unlike the provider list, channels are seeded on every boot rather than only
 * into an empty table (`INSERT OR IGNORE`), so a channel added in a later
 * version shows up in an existing installation's dashboard, disabled, with no
 * migration of its own.
 */

const DEFAULT_SERVICES = [
  { id: "github", name: "GitHub", baseUrl: "https://www.githubstatus.com" },
  { id: "cloudflare", name: "Cloudflare", baseUrl: "https://www.cloudflarestatus.com" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://status.claude.com" },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  pollIntervalMinutes: "3",
  requestTimeoutSeconds: "8",
  maxRetries: "3",
  failureThreshold: "5",
  retentionDays: "120",
  theme: "system",
  timeZone: "auto",
  uiLocale: "en",
  notificationLocale: "en",
};

const DEFAULT_CHANNELS = [
  { id: "telegram", config: { botTokenEnv: "TELEGRAM_BOT_TOKEN", chatIdEnv: "TELEGRAM_CHAT_ID" } },
  // The signing secret is offered as a field even though signing is optional:
  // an operator who never sets the variable gets unsigned requests, which is
  // what a webhook receiver written before roadmap 3.16 expects.
  { id: "webhook", config: { urlEnv: "WEBHOOK_URL", secretEnv: "WEBHOOK_SECRET" } },
  { id: "discord", config: { webhookUrlEnv: "DISCORD_WEBHOOK_URL" } },
  { id: "slack", config: { webhookUrlEnv: "SLACK_WEBHOOK_URL" } },
  // Self-hosted push (roadmap 3.4). ntfy's topic URL carries its server, so
  // ntfy.sh and an instance of your own are the same field; its token is
  // optional (see OPTIONAL_CHANNEL_SETTINGS), Gotify's is not.
  { id: "ntfy", config: { topicUrlEnv: "NTFY_TOPIC_URL", tokenEnv: "NTFY_TOKEN" } },
  { id: "gotify", config: { serverUrlEnv: "GOTIFY_URL", tokenEnv: "GOTIFY_TOKEN" } },
  // SMTP submission (roadmap 3.3). Every setting is a `*Env` name like every
  // other channel's — the dashboard only ever offers those, and 5.17 is what
  // lets a value be typed into it rather than put in the environment by hand.
  // Only the host and the two addresses are load-bearing; see
  // OPTIONAL_CHANNEL_SETTINGS for why the rest are not.
  {
    id: "email",
    config: {
      hostEnv: "SMTP_HOST",
      portEnv: "SMTP_PORT",
      secureEnv: "SMTP_SECURE",
      allowInsecureAuthEnv: "SMTP_ALLOW_INSECURE_AUTH",
      allowSelfSignedEnv: "SMTP_ALLOW_SELF_SIGNED",
      usernameEnv: "SMTP_USERNAME",
      passwordEnv: "SMTP_PASSWORD",
      fromEnv: "SMTP_FROM",
      toEnv: "SMTP_TO",
    },
  },
  // No `*Env` fields: the VAPID pair is generated on first use (src/ui/vapidKeys.ts).
  { id: "webpush", config: {} },
];

export function seedDefaults(db: DatabaseSync): void {
  const [existing] = db.prepare("SELECT COUNT(*) AS n FROM services").all() as { n: number }[];
  if ((existing?.n ?? 0) === 0) {
    const insert = db.prepare(
      "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)",
    );
    const now = new Date().toISOString();
    for (const service of DEFAULT_SERVICES) {
      insert.run(service.id, service.name, "statuspage", service.baseUrl, now);
    }
  }

  const setting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) setting.run(key, value);

  const channel = db.prepare("INSERT OR IGNORE INTO channels (id, enabled, config) VALUES (?, 0, ?)");
  for (const entry of DEFAULT_CHANNELS) channel.run(entry.id, JSON.stringify(entry.config));
}
