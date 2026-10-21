import { z } from "zod";
import {
  deliverySchema,
  recipientsSchema,
  localeSchema,
  routingRuleSchema,
  serviceDefinitionSchema,
} from "../../core/config.schema.ts";
import { TEMPLATE_MAX_LENGTH } from "../../notifiers/template.ts";

/**
 * The shape of `config.yml`. Service definitions and the locale reuse the shared
 * core schemas rather than restating them, so the Light edition's file and the
 * UI edition's settings writes can never validate the same entity differently.
 */

const positiveInt = z.number().int().positive();

const telegramSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(""),
  chatId: z.string().default(""),
});

const webhookSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  /**
   * Optional shared secret for the `X-IsItDown-Signature` header. Written as a
   * `${VAR}` reference like every other credential — a secret in the file is a
   * secret in the operator's git history.
   */
  secret: z.string().default(""),
});

const discordSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

const slackSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

/**
 * The topic URL carries the server, so ntfy.sh and a self-hosted instance are
 * the same setting. The token is only needed on a server with access control.
 */
const ntfySchema = z.object({
  enabled: z.boolean().default(false),
  topicUrl: z.string().default(""),
  token: z.string().default(""),
});

/**
 * SMTP submission (roadmap 3.3). `port` and the two flags are strings here like
 * every other channel setting: the file resolves `${VAR}` references into
 * strings, and the notifier's own schema is the one place that reads them as a
 * port and as booleans.
 */
const emailSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(""),
  port: z.string().default(""),
  /** "true" for implicit TLS (port 465); otherwise STARTTLS is used when offered. */
  secure: z.string().default(""),
  /** Send credentials on an unencrypted connection — for an MTA on this machine. */
  allowInsecureAuth: z.string().default(""),
  /** Accept a certificate no public CA signed — a self-hosted server's own. */
  allowSelfSigned: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  from: z.string().default(""),
  /** One address, or several separated by commas. */
  to: z.string().default(""),
});

/** Two credentials: the application's API token and the user (or group) key. */
const pushoverSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(""),
  userKey: z.string().default(""),
  /** One registered device, or empty for every device on the account. */
  device: z.string().default(""),
});

/** One incoming webhook — a Power Automate workflow trigger, or an old connector. */
const teamsSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

const gotifySchema = z.object({
  enabled: z.boolean().default(false),
  serverUrl: z.string().default(""),
  token: z.string().default(""),
});

/** Homeserver, the internal room id, and an access token for the sending user. */
const matrixSchema = z.object({
  enabled: z.boolean().default(false),
  homeserverUrl: z.string().default(""),
  roomId: z.string().default(""),
  accessToken: z.string().default(""),
});

/**
 * PagerDuty Events API v2 (roadmap 3.7). One integration key; `region` is `eu`
 * for an account in PagerDuty's EU service region and may be left unset.
 */
const pagerdutySchema = z.object({
  enabled: z.boolean().default(false),
  routingKey: z.string().default(""),
  region: z.string().default(""),
});

/** Opsgenie Alerts API (roadmap 3.7). One API key, plus the same region choice. */
const opsgenieSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().default(""),
  region: z.string().default(""),
});

/**
 * An Apprise API server (roadmap 3.9). Either the key of a configuration the
 * server stores — the better arrangement, since the service URLs behind it are
 * credentials — or the URLs themselves, comma-separated, for a stateless server.
 */
const appriseSchema = z.object({
  enabled: z.boolean().default(false),
  serverUrl: z.string().default(""),
  configKey: z.string().default(""),
  urls: z.string().default(""),
});

/**
 * Splunk On-Call (VictorOps) REST endpoint (roadmap 3.9): the integration's
 * API key and the routing key that picks the escalation policy.
 */
const splunkOncallSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().default(""),
  routingKey: z.string().default(""),
});

/**
 * Squadcast Incident Webhook (roadmap 3.9); the URL carries the integration
 * key.
 */
const squadcastSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

/**
 * Zenduty Events API (roadmap 3.9): one integration key.
 */
const zendutySchema = z.object({
  enabled: z.boolean().default(false),
  integrationKey: z.string().default(""),
});

/**
 * incident.io HTTP alert source (roadmap 3.9): its config id and bearer token.
 */
const incidentIoSchema = z.object({
  enabled: z.boolean().default(false),
  alertSourceId: z.string().default(""),
  token: z.string().default(""),
});

/**
 * Grafana OnCall formatted webhook (roadmap 3.9); the URL is the credential.
 */
const grafanaOncallSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

/**
 * Mattermost through the API with a bot token (roadmap 3.9), so a post can be
 * edited in place.
 */
const mattermostSchema = z.object({
  enabled: z.boolean().default(false),
  serverUrl: z.string().default(""),
  token: z.string().default(""),
  channelId: z.string().default(""),
});

/**
 * Rocket.Chat through the REST API (roadmap 3.9): the bot user's id and token,
 * and the room's id.
 */
const rocketchatSchema = z.object({
  enabled: z.boolean().default(false),
  serverUrl: z.string().default(""),
  userId: z.string().default(""),
  token: z.string().default(""),
  roomId: z.string().default(""),
});

/**
 * Zulip (roadmap 3.9): a bot's email and API key, the channel, and an optional
 * fixed topic — empty means one topic per provider.
 */
const zulipSchema = z.object({
  enabled: z.boolean().default(false),
  siteUrl: z.string().default(""),
  botEmail: z.string().default(""),
  apiKey: z.string().default(""),
  stream: z.string().default(""),
  topic: z.string().default(""),
});

/**
 * Google Chat incoming webhook (roadmap 3.9); the URL carries the key and
 * token.
 */
const googleChatSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

/**
 * SMS through Twilio (roadmap 3.9). Numbers are E.164 (`+39…`).
 */
const twilioSmsSchema = z.object({
  enabled: z.boolean().default(false),
  accountSid: z.string().default(""),
  authToken: z.string().default(""),
  from: z.string().default(""),
  to: z.string().default(""),
});

/**
 * A voice call through Twilio (roadmap 3.9) — route only what is worth waking
 * up for to it.
 */
const twilioCallSchema = z.object({
  enabled: z.boolean().default(false),
  accountSid: z.string().default(""),
  authToken: z.string().default(""),
  from: z.string().default(""),
  to: z.string().default(""),
});

/**
 * Bark iOS push (roadmap 3.9): the app's device key, and a self-hosted server
 * when there is one.
 */
const barkSchema = z.object({
  enabled: z.boolean().default(false),
  deviceKey: z.string().default(""),
  serverUrl: z.string().default(""),
});

/**
 * Signal through a signal-cli-rest-api server (roadmap 3.9): the registered
 * number, and recipients comma-separated.
 */
const signalSchema = z.object({
  enabled: z.boolean().default(false),
  serverUrl: z.string().default(""),
  number: z.string().default(""),
  recipients: z.string().default(""),
});

/**
 * Syslog, RFC 5424 (roadmap 3.9): `udp://`, `tcp://` or `tls://host:port`, and
 * a facility from local0 (the default) to local7.
 */
const syslogSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  facility: z.string().default(""),
});

/**
 * MQTT (roadmap 3.9): `mqtt://` or `mqtts://` broker, a topic prefix (default
 * `isitdown`), and credentials only for a broker that wants them.
 */
const mqttSchema = z.object({
  enabled: z.boolean().default(false),
  brokerUrl: z.string().default(""),
  topic: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
});

/**
 * Mastodon public post (roadmap 3.9): instance, an access token with
 * write:statuses, and a visibility (default public).
 */
const mastodonSchema = z.object({
  enabled: z.boolean().default(false),
  instanceUrl: z.string().default(""),
  accessToken: z.string().default(""),
  visibility: z.string().default(""),
});

/**
 * Bluesky public post (roadmap 3.9): handle and an app password, and a PDS
 * when it is not bsky.social.
 */
const blueskySchema = z.object({
  enabled: z.boolean().default(false),
  handle: z.string().default(""),
  appPassword: z.string().default(""),
  serviceUrl: z.string().default(""),
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
const withMessageOptions = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.extend({
    locale: localeSchema.optional(),
    template: z.string().max(TEMPLATE_MAX_LENGTH).optional(),
  });

/**
 * The channels this file format has a place for. Webpush is deliberately absent:
 * a browser subscription belongs to a browser that visited the dashboard, and
 * the Light edition has no dashboard to have visited. `FILE_CHANNEL_IDS` is what
 * the UI edition's export filters on (roadmap 4.3), so the two cannot drift.
 */
const notificationsObject = z
  .object({
    telegram: withMessageOptions(telegramSchema).optional(),
    webhook: withMessageOptions(webhookSchema).optional(),
    discord: withMessageOptions(discordSchema).optional(),
    slack: withMessageOptions(slackSchema).optional(),
    ntfy: withMessageOptions(ntfySchema).optional(),
    gotify: withMessageOptions(gotifySchema).optional(),
    matrix: withMessageOptions(matrixSchema).optional(),
    pagerduty: withMessageOptions(pagerdutySchema).optional(),
    opsgenie: withMessageOptions(opsgenieSchema).optional(),
    apprise: withMessageOptions(appriseSchema).optional(),
    "splunk-oncall": withMessageOptions(splunkOncallSchema).optional(),
    squadcast: withMessageOptions(squadcastSchema).optional(),
    zenduty: withMessageOptions(zendutySchema).optional(),
    "incident-io": withMessageOptions(incidentIoSchema).optional(),
    "grafana-oncall": withMessageOptions(grafanaOncallSchema).optional(),
    mattermost: withMessageOptions(mattermostSchema).optional(),
    rocketchat: withMessageOptions(rocketchatSchema).optional(),
    zulip: withMessageOptions(zulipSchema).optional(),
    "google-chat": withMessageOptions(googleChatSchema).optional(),
    "twilio-sms": withMessageOptions(twilioSmsSchema).optional(),
    "twilio-call": withMessageOptions(twilioCallSchema).optional(),
    bark: withMessageOptions(barkSchema).optional(),
    signal: withMessageOptions(signalSchema).optional(),
    syslog: withMessageOptions(syslogSchema).optional(),
    mqtt: withMessageOptions(mqttSchema).optional(),
    mastodon: withMessageOptions(mastodonSchema).optional(),
    bluesky: withMessageOptions(blueskySchema).optional(),
    pushover: withMessageOptions(pushoverSchema).optional(),
    teams: withMessageOptions(teamsSchema).optional(),
    email: withMessageOptions(emailSchema).optional(),
  })
  .strict();

export const FILE_CHANNEL_IDS: readonly string[] = Object.keys(notificationsObject.shape);

export const fileConfigSchema = z.object({
  pollIntervalMinutes: positiveInt.max(1440).optional(),
  requestTimeoutSeconds: positiveInt.max(120).optional(),
  maxRetries: positiveInt.max(10).optional(),
  failureThreshold: positiveInt.max(100).optional(),
  /**
   * Poll a provider with an open incident on `adaptiveIntervalMinutes` instead
   * of its own cadence. Omitted, not defaulted: the shared polling schema owns
   * the default, and restating it here is how the two editions drift.
   */
  adaptivePolling: z.boolean().optional(),
  adaptiveIntervalMinutes: positiveInt.max(1440).optional(),
  /** Consecutive agreeing polls before a transition notifies. 1 is off. */
  confirmSamples: positiveInt.max(10).optional(),
  /**
   * How many providers have to go bad inside `correlationWindowMinutes` before
   * the cycle reports one shared failure instead of one alert each (roadmap
   * 2.7). 0 and 1 are off, which is the default.
   */
  correlationThreshold: z.number().int().min(0).max(100).optional(),
  correlationWindowMinutes: positiveInt.max(1440).optional(),
  locale: localeSchema.optional(),
  services: z.array(serviceDefinitionSchema).min(1, "at least one service is required"),
  notifications: notificationsObject.default({}),
  /**
   * Evaluation order is the file's order — first matching rule decides.
   * Absent means "everything to every enabled channel", the edition's
   * behaviour before routing existed, and still the default with the key
   * left out.
   */
  routing: z.array(routingRuleSchema).optional(),
  /**
   * Quiet hours, the digest window, the per-provider cap and message editing.
   * Absent means every one of them off, which is what this edition did before
   * they existed — the shared schema owns the defaults, so nothing is restated
   * here.
   */
  delivery: deliverySchema.optional(),
  /**
   * People reached through several channels, preferred first (roadmap 3.5).
   * Absent means none: every channel a rule names is sent to on its own.
   */
  recipients: recipientsSchema.optional(),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;
