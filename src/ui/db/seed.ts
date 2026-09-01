import type { DatabaseSync } from "node:sqlite";

/**
 * First-boot defaults, so a fresh container shows a working dashboard instead of
 * an empty grid. Providers are seeded only when the table is empty: an operator's
 * own list is never overwritten.
 *
 * Channels are seeded disabled and carry the *name* of the environment variable
 * holding each credential — never a value. That is the whole secret model of the
 * UI edition: the database stores references, the environment holds secrets.
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
  theme: "system",
  uiLocale: "en",
  notificationLocale: "en",
};

const DEFAULT_CHANNELS = [
  { id: "telegram", config: { botTokenEnv: "TELEGRAM_BOT_TOKEN", chatIdEnv: "TELEGRAM_CHAT_ID" } },
  { id: "webhook", config: { urlEnv: "WEBHOOK_URL" } },
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
