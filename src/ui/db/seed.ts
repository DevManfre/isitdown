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
  // Pushover (roadmap 3.5). Two credentials, plus a device name that narrows
  // delivery to one phone and is optional (see OPTIONAL_CHANNEL_SETTINGS).
  {
    id: "pushover",
    config: {
      tokenEnv: "PUSHOVER_TOKEN",
      userKeyEnv: "PUSHOVER_USER_KEY",
      deviceEnv: "PUSHOVER_DEVICE",
    },
  },
  // Matrix (roadmap 3.6). The room id is internal (`!abc:example.org`), not an
  // alias: an alias can be repointed at another room by anyone with the power
  // to, which is not a property an alert channel should have.
  {
    id: "matrix",
    config: {
      homeserverUrlEnv: "MATRIX_HOMESERVER_URL",
      roomIdEnv: "MATRIX_ROOM_ID",
      accessTokenEnv: "MATRIX_ACCESS_TOKEN",
    },
  },
  // On-call chains (roadmap 3.7). Both de-duplicate on a key IsItDown derives
  // from the change, so a provider's own "resolved" update closes the alert its
  // "investigating" update opened. `region` is optional (see
  // OPTIONAL_CHANNEL_SETTINGS).
  {
    id: "pagerduty",
    config: { routingKeyEnv: "PAGERDUTY_ROUTING_KEY", regionEnv: "PAGERDUTY_REGION" },
  },
  { id: "opsgenie", config: { apiKeyEnv: "OPSGENIE_API_KEY", regionEnv: "OPSGENIE_REGION" } },
  // Apprise bridge (roadmap 3.9). Either the key of a configuration the server
  // stores or the service URLs themselves; the notifier refuses both empty.
  {
    id: "apprise",
    config: {
      serverUrlEnv: "APPRISE_SERVER_URL",
      configKeyEnv: "APPRISE_CONFIG_KEY",
      urlsEnv: "APPRISE_URLS",
    },
  },
  // Microsoft Teams (roadmap 3.8). One incoming webhook, like Discord and Slack.
  { id: "teams", config: { webhookUrlEnv: "TEAMS_WEBHOOK_URL" } },
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
  // Splunk On-Call (VictorOps) REST endpoint (roadmap 3.9): the integration's
  // API key and the routing key that picks the escalation policy.
  {
    id: "splunk-oncall",
    config: {
      apiKeyEnv: "SPLUNK_ONCALL_API_KEY",
      routingKeyEnv: "SPLUNK_ONCALL_ROUTING_KEY",
    },
  },
  // Squadcast Incident Webhook (roadmap 3.9); the URL carries the integration
  // key.
  { id: "squadcast", config: { webhookUrlEnv: "SQUADCAST_WEBHOOK_URL" } },
  // Zenduty Events API (roadmap 3.9): one integration key.
  { id: "zenduty", config: { integrationKeyEnv: "ZENDUTY_INTEGRATION_KEY" } },
  // incident.io HTTP alert source (roadmap 3.9): its config id and bearer token.
  {
    id: "incident-io",
    config: {
      alertSourceIdEnv: "INCIDENT_IO_ALERT_SOURCE_ID",
      tokenEnv: "INCIDENT_IO_TOKEN",
    },
  },
  // Grafana OnCall formatted webhook (roadmap 3.9); the URL is the credential.
  { id: "grafana-oncall", config: { webhookUrlEnv: "GRAFANA_ONCALL_WEBHOOK_URL" } },
  // Mattermost through the API with a bot token (roadmap 3.9), so a post can be
  // edited in place.
  {
    id: "mattermost",
    config: {
      serverUrlEnv: "MATTERMOST_URL",
      tokenEnv: "MATTERMOST_TOKEN",
      channelIdEnv: "MATTERMOST_CHANNEL_ID",
    },
  },
  // Rocket.Chat through the REST API (roadmap 3.9): the bot user's id and token,
  // and the room's id.
  {
    id: "rocketchat",
    config: {
      serverUrlEnv: "ROCKETCHAT_URL",
      userIdEnv: "ROCKETCHAT_USER_ID",
      tokenEnv: "ROCKETCHAT_TOKEN",
      roomIdEnv: "ROCKETCHAT_ROOM_ID",
    },
  },
  // Zulip (roadmap 3.9): a bot's email and API key, the channel, and an optional
  // fixed topic — empty means one topic per provider.
  {
    id: "zulip",
    config: {
      siteUrlEnv: "ZULIP_SITE_URL",
      botEmailEnv: "ZULIP_BOT_EMAIL",
      apiKeyEnv: "ZULIP_API_KEY",
      streamEnv: "ZULIP_STREAM",
      topicEnv: "ZULIP_TOPIC",
    },
  },
  // Google Chat incoming webhook (roadmap 3.9); the URL carries the key and
  // token.
  { id: "google-chat", config: { webhookUrlEnv: "GOOGLE_CHAT_WEBHOOK_URL" } },
  // SMS through Twilio (roadmap 3.9). Numbers are E.164 (`+39…`).
  {
    id: "twilio-sms",
    config: {
      accountSidEnv: "TWILIO_SMS_ACCOUNT_SID",
      authTokenEnv: "TWILIO_SMS_AUTH_TOKEN",
      fromEnv: "TWILIO_SMS_FROM",
      toEnv: "TWILIO_SMS_TO",
    },
  },
  // A voice call through Twilio (roadmap 3.9) — route only what is worth waking
  // up for to it.
  {
    id: "twilio-call",
    config: {
      accountSidEnv: "TWILIO_CALL_ACCOUNT_SID",
      authTokenEnv: "TWILIO_CALL_AUTH_TOKEN",
      fromEnv: "TWILIO_CALL_FROM",
      toEnv: "TWILIO_CALL_TO",
    },
  },
  // Bark iOS push (roadmap 3.9): the app's device key, and a self-hosted server
  // when there is one.
  { id: "bark", config: { deviceKeyEnv: "BARK_DEVICE_KEY", serverUrlEnv: "BARK_SERVER_URL" } },
  // Signal through a signal-cli-rest-api server (roadmap 3.9): the registered
  // number, and recipients comma-separated.
  {
    id: "signal",
    config: {
      serverUrlEnv: "SIGNAL_API_URL",
      numberEnv: "SIGNAL_NUMBER",
      recipientsEnv: "SIGNAL_RECIPIENTS",
    },
  },
  // Syslog, RFC 5424 (roadmap 3.9): `udp://`, `tcp://` or `tls://host:port`, and
  // a facility from local0 (the default) to local7.
  { id: "syslog", config: { urlEnv: "SYSLOG_URL", facilityEnv: "SYSLOG_FACILITY" } },
  // MQTT (roadmap 3.9): `mqtt://` or `mqtts://` broker, a topic prefix (default
  // `isitdown`), and credentials only for a broker that wants them.
  {
    id: "mqtt",
    config: {
      brokerUrlEnv: "MQTT_BROKER_URL",
      topicEnv: "MQTT_TOPIC",
      usernameEnv: "MQTT_USERNAME",
      passwordEnv: "MQTT_PASSWORD",
    },
  },
  // Mastodon public post (roadmap 3.9): instance, an access token with
  // write:statuses, and a visibility (default public).
  {
    id: "mastodon",
    config: {
      instanceUrlEnv: "MASTODON_INSTANCE_URL",
      accessTokenEnv: "MASTODON_ACCESS_TOKEN",
      visibilityEnv: "MASTODON_VISIBILITY",
    },
  },
  // Bluesky public post (roadmap 3.9): handle and an app password, and a PDS
  // when it is not bsky.social.
  {
    id: "bluesky",
    config: {
      handleEnv: "BLUESKY_HANDLE",
      appPasswordEnv: "BLUESKY_APP_PASSWORD",
      serviceUrlEnv: "BLUESKY_SERVICE_URL",
    },
  },
  // No `*Env` fields: the VAPID pair is generated on first use (src/ui/vapidKeys.ts).
  { id: "webpush", config: {} },
];

export function seedDefaults(db: DatabaseSync): void {
  // One commit for every default row, not one fsync per insert.
  db.exec("BEGIN");
  try {
    insertDefaults(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertDefaults(db: DatabaseSync): void {
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
