import { z } from "zod";
import {
  deliverySchema,
  recipientsSchema,
  localeSchema,
  routingRuleSchema,
  serviceDefinitionSchema,
} from "../../core/config.schema.ts";
import { heartbeatTargetSchema } from "../../core/outboundHeartbeat.ts";
import { TEMPLATE_MAX_LENGTH } from "../../notifiers/template.ts";

/**
 * The shape of `config.yml`. Service definitions and the locale reuse the shared
 * core schemas rather than restating them, so the Light edition's file and the
 * UI edition's settings writes can never validate the same entity differently.
 */

const positiveInt = z.number().int().positive();

/*
 * Every channel setting is a string defaulting to empty. The descriptions are
 * what an editor shows over the key (the published JSON Schema, roadmap 11.5);
 * a credential's also says how to keep the value out of the file.
 */
const channelEnabled = z.boolean().default(false).describe("Turn this channel on. Default false.");
const setting = (description: string) => z.string().default("").describe(description);
const secret = (description: string) =>
  z
    .string()
    .default("")
    .describe(`${description} Reference a secret as \${VAR}.`);

const telegramSchema = z.object({
  enabled: channelEnabled,
  botToken: secret("The bot's token from @BotFather."),
  chatId: setting("The chat, group or channel id the bot posts to."),
});

const webhookSchema = z.object({
  enabled: channelEnabled,
  url: secret("The URL each change is POSTed to as JSON."),
  /**
   * Optional shared secret for the `X-IsItDown-Signature` header. Written as a
   * `${VAR}` reference like every other credential — a secret in the file is a
   * secret in the operator's git history.
   */
  secret: secret("Optional shared secret that signs each request in the X-IsItDown-Signature header."),
});

const discordSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The channel's incoming webhook URL."),
});

const slackSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The channel's incoming webhook URL."),
});

/**
 * The topic URL carries the server, so ntfy.sh and a self-hosted instance are
 * the same setting. The token is only needed on a server with access control.
 */
const ntfySchema = z.object({
  enabled: channelEnabled,
  topicUrl: setting("The topic's full URL, on ntfy.sh or a self-hosted server."),
  token: secret("Access token, only for a server with access control."),
});

/**
 * SMTP submission (roadmap 3.3). `port` and the two flags are strings here like
 * every other channel setting: the file resolves `${VAR}` references into
 * strings, and the notifier's own schema is the one place that reads them as a
 * port and as booleans.
 */
const emailSchema = z.object({
  enabled: channelEnabled,
  host: setting("SMTP server host name."),
  port: setting("SMTP port, as a string. Empty uses the default for the TLS mode."),
  /** "true" for implicit TLS (port 465); otherwise STARTTLS is used when offered. */
  secure: setting("\"true\" for implicit TLS (port 465); otherwise STARTTLS is used when the server offers it."),
  /** Send credentials on an unencrypted connection — for an MTA on this machine. */
  allowInsecureAuth: setting("\"true\" sends credentials over an unencrypted connection, for an MTA on the same machine."),
  /** Accept a certificate no public CA signed — a self-hosted server's own. */
  allowSelfSigned: setting("\"true\" accepts a certificate no public CA signed, such as a self-hosted server's own."),
  username: secret("SMTP user name, when the server wants credentials."),
  password: secret("SMTP password."),
  from: setting("Sender address."),
  /** One address, or several separated by commas. */
  to: setting("Recipient addresses, comma-separated."),
});

/** Two credentials: the application's API token and the user (or group) key. */
const pushoverSchema = z.object({
  enabled: channelEnabled,
  token: secret("The application's API token."),
  userKey: secret("The user or group key."),
  /** One registered device, or empty for every device on the account. */
  device: setting("One registered device; empty sends to every device on the account."),
});

/** One incoming webhook — a Power Automate workflow trigger, or an old connector. */
const teamsSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The Power Automate workflow trigger URL, or an old connector's webhook URL."),
});

const gotifySchema = z.object({
  enabled: channelEnabled,
  serverUrl: setting("The Gotify server's URL."),
  token: secret("The application token."),
});

/** Homeserver, the internal room id, and an access token for the sending user. */
const matrixSchema = z.object({
  enabled: channelEnabled,
  homeserverUrl: setting("The homeserver's URL."),
  roomId: setting("The room's internal id (!…:server)."),
  accessToken: secret("The sending user's access token."),
});

/**
 * PagerDuty Events API v2 (roadmap 3.7). One integration key; `region` is `eu`
 * for an account in PagerDuty's EU service region and may be left unset.
 */
const pagerdutySchema = z.object({
  enabled: channelEnabled,
  routingKey: secret("The Events API v2 integration key."),
  region: setting("\"eu\" for an account in PagerDuty's EU service region; empty otherwise."),
});

/** Opsgenie Alerts API (roadmap 3.7). One API key, plus the same region choice. */
const opsgenieSchema = z.object({
  enabled: channelEnabled,
  apiKey: secret("The Alerts API key."),
  region: setting("\"eu\" for an account in Opsgenie's EU region; empty otherwise."),
});

/**
 * An Apprise API server (roadmap 3.9). Either the key of a configuration the
 * server stores — the better arrangement, since the service URLs behind it are
 * credentials — or the URLs themselves, comma-separated, for a stateless server.
 */
const appriseSchema = z.object({
  enabled: channelEnabled,
  serverUrl: setting("The Apprise API server's URL."),
  configKey: secret("Key of a configuration the server stores. Set this or urls."),
  urls: secret("Apprise service URLs, comma-separated, for a stateless server. Set this or configKey."),
});

/**
 * Splunk On-Call (VictorOps) REST endpoint (roadmap 3.9): the integration's
 * API key and the routing key that picks the escalation policy.
 */
const splunkOncallSchema = z.object({
  enabled: channelEnabled,
  apiKey: secret("The REST integration's API key."),
  routingKey: setting("The routing key that picks the escalation policy."),
});

/**
 * Squadcast Incident Webhook (roadmap 3.9); the URL carries the integration
 * key.
 */
const squadcastSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The Incident Webhook URL, which carries the integration key."),
});

/**
 * Zenduty Events API (roadmap 3.9): one integration key.
 */
const zendutySchema = z.object({
  enabled: channelEnabled,
  integrationKey: secret("The Events API integration key."),
});

/**
 * incident.io HTTP alert source (roadmap 3.9): its config id and bearer token.
 */
const incidentIoSchema = z.object({
  enabled: channelEnabled,
  alertSourceId: setting("The HTTP alert source's config id."),
  token: secret("The alert source's bearer token."),
});

/**
 * Grafana OnCall formatted webhook (roadmap 3.9); the URL is the credential.
 */
const grafanaOncallSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The formatted webhook integration URL."),
});

/**
 * Mattermost through the API with a bot token (roadmap 3.9), so a post can be
 * edited in place.
 */
const mattermostSchema = z.object({
  enabled: channelEnabled,
  serverUrl: setting("The Mattermost server's URL."),
  token: secret("The bot's access token."),
  channelId: setting("The id of the channel to post in."),
});

/**
 * Rocket.Chat through the REST API (roadmap 3.9): the bot user's id and token,
 * and the room's id.
 */
const rocketchatSchema = z.object({
  enabled: channelEnabled,
  serverUrl: setting("The Rocket.Chat server's URL."),
  userId: setting("The bot user's id."),
  token: secret("The bot user's auth token."),
  roomId: setting("The id of the room to post in."),
});

/**
 * Zulip (roadmap 3.9): a bot's email and API key, the channel, and an optional
 * fixed topic — empty means one topic per provider.
 */
const zulipSchema = z.object({
  enabled: channelEnabled,
  siteUrl: setting("The Zulip organization's URL."),
  botEmail: setting("The bot's email address."),
  apiKey: secret("The bot's API key."),
  stream: setting("The channel (stream) to post in."),
  topic: setting("A fixed topic; empty uses one topic per provider."),
});

/**
 * Google Chat incoming webhook (roadmap 3.9); the URL carries the key and
 * token.
 */
const googleChatSchema = z.object({
  enabled: channelEnabled,
  webhookUrl: secret("The space's incoming webhook URL, which carries the key and token."),
});

/**
 * SMS through Twilio (roadmap 3.9). Numbers are E.164 (`+39…`).
 */
const twilioSmsSchema = z.object({
  enabled: channelEnabled,
  accountSid: setting("The Twilio account SID."),
  authToken: secret("The Twilio auth token."),
  from: setting("The Twilio number to send from, E.164 (+39…)."),
  to: setting("The number to text, E.164 (+39…)."),
});

/**
 * A voice call through Twilio (roadmap 3.9) — route only what is worth waking
 * up for to it.
 */
const twilioCallSchema = z.object({
  enabled: channelEnabled,
  accountSid: setting("The Twilio account SID."),
  authToken: secret("The Twilio auth token."),
  from: setting("The Twilio number to call from, E.164 (+39…)."),
  to: setting("The number to call, E.164 (+39…)."),
});

/**
 * Bark iOS push (roadmap 3.9): the app's device key, and a self-hosted server
 * when there is one.
 */
const barkSchema = z.object({
  enabled: channelEnabled,
  deviceKey: secret("The Bark app's device key."),
  serverUrl: setting("A self-hosted Bark server's URL; empty uses the public one."),
});

/**
 * Signal through a signal-cli-rest-api server (roadmap 3.9): the registered
 * number, and recipients comma-separated.
 */
const signalSchema = z.object({
  enabled: channelEnabled,
  serverUrl: setting("The signal-cli-rest-api server's URL."),
  number: setting("The registered number that sends."),
  recipients: setting("Numbers or group ids to send to, comma-separated."),
});

/**
 * Syslog, RFC 5424 (roadmap 3.9): `udp://`, `tcp://` or `tls://host:port`, and
 * a facility from local0 (the default) to local7.
 */
const syslogSchema = z.object({
  enabled: channelEnabled,
  url: setting("udp://, tcp:// or tls://host:port of the syslog receiver."),
  facility: setting("local0 to local7; empty means local0."),
});

/**
 * MQTT (roadmap 3.9): `mqtt://` or `mqtts://` broker, a topic prefix (default
 * `isitdown`), and credentials only for a broker that wants them.
 */
const mqttSchema = z.object({
  enabled: channelEnabled,
  brokerUrl: setting("mqtt:// or mqtts:// broker URL."),
  topic: setting("Topic prefix; empty means isitdown."),
  username: secret("Broker user name, if the broker wants one."),
  password: secret("Broker password."),
});

/**
 * Mastodon public post (roadmap 3.9): instance, an access token with
 * write:statuses, and a visibility (default public).
 */
const mastodonSchema = z.object({
  enabled: channelEnabled,
  instanceUrl: setting("The Mastodon instance's URL."),
  accessToken: secret("An access token with the write:statuses scope."),
  visibility: setting("Post visibility; empty means public."),
});

/**
 * Bluesky public post (roadmap 3.9): handle and an app password, and a PDS
 * when it is not bsky.social.
 */
const blueskySchema = z.object({
  enabled: channelEnabled,
  handle: setting("The account's handle."),
  appPassword: secret("An app password for the account."),
  serviceUrl: setting("The PDS URL, when it is not bsky.social."),
});

/** Required non-empty settings per channel, used to produce an actionable error. */
export const REQUIRED_CHANNEL_SETTINGS: Record<string, readonly string[]> = {
  telegram: ["botToken", "chatId"],
  webhook: ["url"],
  discord: ["webhookUrl"],
  slack: ["webhookUrl"],
  ntfy: ["topicUrl"],
  gotify: ["serverUrl", "token"],
  matrix: ["homeserverUrl", "roomId", "accessToken"],
  pagerduty: ["routingKey"],
  opsgenie: ["apiKey"],
  // Not `configKey` or `urls`: the channel needs one of the two, which a list
  // of individually required fields cannot say. The notifier's own schema
  // refuses the pair when both are empty.
  apprise: ["serverUrl"],
  pushover: ["token", "userKey"],
  teams: ["webhookUrl"],
  // Not the credentials: a relay on this machine, or one that trusts this
  // network, needs none — and requiring them would disable the channel for
  // exactly the setup this audience runs.
  email: ["host", "from", "to"],
  "splunk-oncall": ["apiKey", "routingKey"],
  squadcast: ["webhookUrl"],
  zenduty: ["integrationKey"],
  "incident-io": ["alertSourceId", "token"],
  "grafana-oncall": ["webhookUrl"],
  mattermost: ["serverUrl", "token", "channelId"],
  rocketchat: ["serverUrl", "userId", "token", "roomId"],
  zulip: ["siteUrl", "botEmail", "apiKey", "stream"],
  "google-chat": ["webhookUrl"],
  "twilio-sms": ["accountSid", "authToken", "from", "to"],
  "twilio-call": ["accountSid", "authToken", "from", "to"],
  bark: ["deviceKey"],
  signal: ["serverUrl", "number", "recipients"],
  syslog: ["url"],
  mqtt: ["brokerUrl"],
  mastodon: ["instanceUrl", "accessToken"],
  bluesky: ["handle", "appPassword"],
};

/**
 * The two fields every channel has that are not transport: the locale its
 * messages are written in (roadmap 3.20) and the template they are rendered
 * with (roadmap 3.15).
 *
 * Added to each channel's own schema rather than listed once as a sibling
 * block, because they are settings *of the channel* — `notifications.telegram.
 * locale` is where an operator looks for them, and a parallel
 * `messageOptions.telegram.locale` would be a second place a channel is
 * configured. Applied through one helper so thirty channels cannot end up
 * accepting thirty slightly different spellings of the same two fields.
 *
 * The template is only checked for length here; which tokens exist is
 * `notifiers/template.ts`'s business, and the loader reports its verdict with
 * the rest of the file's problems so an operator sees them all at once.
 */
const withMessageOptions = <T extends z.ZodRawShape>(schema: z.ZodObject<T>, description: string) =>
  schema
    .extend({
      locale: localeSchema
        .optional()
        
        .describe("Language of this channel's messages, overriding the top-level locale (en, it, de, es, fr, pt)."),
      template: z
        .string()
        .max(TEMPLATE_MAX_LENGTH)
        .optional()
        .describe("Custom message text with {{tokens}}, replacing the built-in wording on this channel."),
    })
    .describe(description);

/**
 * The channels this file format has a place for. Webpush is deliberately absent:
 * a browser subscription belongs to a browser that visited the dashboard, and
 * the Light edition has no dashboard to have visited. `FILE_CHANNEL_IDS` is what
 * the UI edition's export filters on (roadmap 4.3), so the two cannot drift.
 */
const notificationsObject = z
  .object({
    telegram: withMessageOptions(telegramSchema, "Telegram, through a bot.").optional(),
    webhook: withMessageOptions(webhookSchema, "A generic JSON webhook, optionally HMAC-signed.").optional(),
    discord: withMessageOptions(discordSchema, "Discord, through a channel webhook.").optional(),
    slack: withMessageOptions(slackSchema, "Slack, through an incoming webhook.").optional(),
    ntfy: withMessageOptions(ntfySchema, "ntfy push notifications.").optional(),
    gotify: withMessageOptions(gotifySchema, "Gotify push notifications.").optional(),
    matrix: withMessageOptions(matrixSchema, "A Matrix room.").optional(),
    pagerduty: withMessageOptions(pagerdutySchema, "PagerDuty Events API v2.").optional(),
    opsgenie: withMessageOptions(opsgenieSchema, "Opsgenie Alerts API.").optional(),
    apprise: withMessageOptions(appriseSchema, "An Apprise API server, fanning out to its services.").optional(),
    "splunk-oncall": withMessageOptions(splunkOncallSchema, "Splunk On-Call (VictorOps).").optional(),
    squadcast: withMessageOptions(squadcastSchema, "Squadcast Incident Webhook.").optional(),
    zenduty: withMessageOptions(zendutySchema, "Zenduty Events API.").optional(),
    "incident-io": withMessageOptions(incidentIoSchema, "An incident.io HTTP alert source.").optional(),
    "grafana-oncall": withMessageOptions(grafanaOncallSchema, "Grafana OnCall formatted webhook.").optional(),
    mattermost: withMessageOptions(mattermostSchema, "Mattermost, through a bot.").optional(),
    rocketchat: withMessageOptions(rocketchatSchema, "Rocket.Chat, through its REST API.").optional(),
    zulip: withMessageOptions(zulipSchema, "Zulip, through a bot.").optional(),
    "google-chat": withMessageOptions(googleChatSchema, "A Google Chat space webhook.").optional(),
    "twilio-sms": withMessageOptions(twilioSmsSchema, "SMS through Twilio.").optional(),
    "twilio-call": withMessageOptions(twilioCallSchema, "A phone call through Twilio.").optional(),
    bark: withMessageOptions(barkSchema, "Bark push notifications on iOS.").optional(),
    signal: withMessageOptions(signalSchema, "Signal, through a signal-cli-rest-api server.").optional(),
    syslog: withMessageOptions(syslogSchema, "Syslog (RFC 5424).").optional(),
    mqtt: withMessageOptions(mqttSchema, "An MQTT broker.").optional(),
    mastodon: withMessageOptions(mastodonSchema, "A public Mastodon post.").optional(),
    bluesky: withMessageOptions(blueskySchema, "A public Bluesky post.").optional(),
    pushover: withMessageOptions(pushoverSchema, "Pushover push notifications.").optional(),
    teams: withMessageOptions(teamsSchema, "Microsoft Teams, through a workflow or connector webhook.").optional(),
    email: withMessageOptions(emailSchema, "Email over SMTP.").optional(),
  })
  .strict();

export const FILE_CHANNEL_IDS: readonly string[] = Object.keys(notificationsObject.shape);

export const fileConfigSchema = z.object({
  pollIntervalMinutes: positiveInt.max(1440).optional()
    .describe("Minutes between polls of every provider, 1–1440. Default 3."),
  requestTimeoutSeconds: positiveInt.max(120).optional()
    .describe("Timeout of each HTTP request in seconds, 1–120. Default 8."),
  maxRetries: positiveInt.max(10).optional()
    .describe("Attempts per provider per cycle, with backoff, 1–10. Default 3."),
  failureThreshold: positiveInt.max(100).optional()
    .describe('Consecutive failed cycles before one "monitoring degraded" warning, 1–100. Default 5.'),
  /**
   * Poll a provider with an open incident on `adaptiveIntervalMinutes` instead
   * of its own cadence. Omitted, not defaulted: the shared polling schema owns
   * the default, and restating it here is how the two editions drift.
   */
  adaptivePolling: z.boolean().optional()
    .describe("Poll a provider with an open incident on adaptiveIntervalMinutes instead of its own cadence. Default true."),
  adaptiveIntervalMinutes: positiveInt.max(1440).optional()
    .describe("Cadence for a provider in trouble, 1–1440; never slower than its own. Default 1."),
  /** Consecutive agreeing polls before a transition notifies. 1 is off. */
  confirmSamples: positiveInt.max(10).optional()
    .describe("Consecutive polls that must agree before a change notifies, 1–10. Default 1 (off)."),
  /**
   * How many providers have to go bad inside `correlationWindowMinutes` before
   * the cycle reports one shared failure instead of one alert each (roadmap
   * 2.7). 0 and 1 are off, which is the default.
   */
  correlationThreshold: z.number().int().min(0).max(100).optional()
    .describe("Providers going bad inside correlationWindowMinutes before one shared-failure alert replaces their own. 0 or 1 is off (default)."),
  correlationWindowMinutes: positiveInt.max(1440).optional()
    .describe("How wide the shared-failure window is, in minutes, 1–1440. Default 10."),
  locale: localeSchema.optional()
    .describe("Language of notification messages: en, it, de, es, fr or pt. Default en."),
  services: z.array(serviceDefinitionSchema).min(1, "at least one service is required")
    .describe("The providers to watch: at least one."),
  notifications: notificationsObject.default({})
    .describe("The channels changes are sent to, keyed by channel id."),
  /**
   * Evaluation order is the file's order — first matching rule decides.
   * Absent means "everything to every enabled channel", the edition's
   * behaviour before routing existed, and still the default with the key
   * left out.
   */
  routing: z.array(routingRuleSchema).optional()
    .describe("Ordered rules choosing which channels hear about a change; the first match wins. Absent sends everything everywhere."),
  /**
   * Quiet hours, the digest window, the per-provider cap and message editing.
   * Absent means every one of them off, which is what this edition did before
   * they existed — the shared schema owns the defaults, so nothing is restated
   * here.
   */
  delivery: deliverySchema.optional()
    .describe("Quiet hours, digests, caps and the other delivery controls. All off by default."),
  /**
   * People reached through several channels, preferred first (roadmap 3.5).
   * Absent means none: every channel a rule names is sent to on its own.
   */
  recipients: recipientsSchema.optional()
    .describe("People reached through several channels, preferred channel first."),
  /**
   * Targets let past the egress policy (roadmap 9.1): addresses, CIDR ranges
   * and host names, added to `EGRESS_ALLOW`. This edition reads private and
   * loopback targets anyway, with a warning; listing one here silences it.
   */
  egress: z
    .object({ allow: z.array(z.string().trim().min(1)).max(200).default([])
    .describe("Private addresses, CIDR ranges or host names a probe may reach, on top of EGRESS_ALLOW.") })
    .strict()
    .optional()
    .describe("Egress policy: which private or loopback targets a probe may reach."),
  /**
   * IsItDown's own dead-man's switch (roadmap 10.5): a URL pinged after every
   * cycle, another after a failed one. `HEARTBEAT_URL` and friends when absent.
   */
  heartbeat: heartbeatTargetSchema.optional()
    .describe("IsItDown's own dead-man's switch: a URL pinged after every cycle."),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;
