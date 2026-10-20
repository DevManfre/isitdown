import type { LimitUnit } from "../../../src/notifiers/formatting.ts";
import { jsonResponse, type CapturedRequest } from "../../helpers/fetchStub.ts";

/**
 * What the notifier contract suite (roadmap 3.8) needs to know about one HTTP
 * channel. The suite asserts the same properties of every entry; this table
 * only says where each channel keeps them on the wire.
 */
export interface ContractCase {
  /** Settings that build the channel. */
  settings: Record<string, string>;
  /** Setting values that are credentials: none may appear in an error. */
  secrets: string[];
  /** The remote side's answer to a delivery it accepted. */
  ok(request: CapturedRequest): Response;
  /**
   * Each rendering a person reads, taken from the request that carries the
   * message (the last one sent). One entry for a plain channel; one per format
   * for a channel that sends the same message as plain text and as markup.
   */
  readable(request: CapturedRequest): string[];
  /** The fields a channel caps, with the cap, read off the last request. */
  limits(request: CapturedRequest): { field: string; text: string; max: number; unit?: LimitUnit }[];
  /** The key the remote side de-duplicates on, for an on-call channel. */
  dedupKey?(request: CapturedRequest): string;
}

type Json = Record<string, any>;

const json = (request: CapturedRequest): Json => (request.body ?? {}) as Json;
const form = (request: CapturedRequest): URLSearchParams => new URLSearchParams(request.rawBody ?? "");
const empty = (): Response => new Response(null, { status: 200 });

/** RFC 2047 encoded-word back to text, the way ntfy reads its title header. */
const decodeHeader = (value: string | undefined): string => {
  const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value ?? "");
  return match === null ? (value ?? "") : Buffer.from(match[1] ?? "", "base64").toString("utf8");
};

export const CASES: Record<string, ContractCase> = {
  telegram: {
    settings: { botToken: "123:SECRET-BOT-TOKEN", chatId: "-100" },
    secrets: ["123:SECRET-BOT-TOKEN"],
    ok: () => jsonResponse({ ok: true, result: { message_id: 7 } }),
    readable: (request) => [json(request).text],
    limits: (request) => [{ field: "text", text: json(request).text, max: 4096 }],
  },
  webhook: {
    settings: { url: "https://hooks.example/SECRET-PATH", secret: "SECRET-SIGNING" },
    secrets: ["SECRET-PATH", "SECRET-SIGNING"],
    ok: empty,
    readable: (request) => [json(request).message],
    limits: () => [],
  },
  discord: {
    settings: { webhookUrl: "https://discord.com/api/webhooks/1/SECRET-WEBHOOK" },
    secrets: ["SECRET-WEBHOOK"],
    ok: () => jsonResponse({ id: "42" }),
    readable: (request) => [`${json(request).embeds[0].title}\n${json(request).embeds[0].description}`],
    limits: (request) => [
      { field: "embed title", text: json(request).embeds[0].title, max: 256 },
      { field: "embed description", text: json(request).embeds[0].description, max: 4096 },
    ],
  },
  slack: {
    settings: { webhookUrl: "https://hooks.slack.com/services/T0/B0/SECRET-WEBHOOK" },
    secrets: ["SECRET-WEBHOOK"],
    ok: empty,
    readable: (request) => [json(request).blocks[0].text.text],
    limits: (request) => [
      { field: "section", text: json(request).blocks[0].text.text, max: 3000 },
      { field: "text", text: json(request).text, max: 3000 },
    ],
  },
  ntfy: {
    settings: { topicUrl: "https://ntfy.sh/isitdown", token: "SECRET-TOKEN" },
    secrets: ["SECRET-TOKEN"],
    ok: empty,
    readable: (request) => [`${decodeHeader(request.headers.title)}\n${request.rawBody ?? ""}`],
    limits: (request) => [{ field: "body", text: request.rawBody ?? "", max: 4096, unit: "bytes" }],
  },
  gotify: {
    settings: { serverUrl: "https://gotify.example.com", token: "SECRET-TOKEN" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ id: 1 }),
    readable: (request) => [`${json(request).title}\n${json(request).message}`],
    limits: () => [],
  },
  pushover: {
    settings: { token: "SECRET-APP", userKey: "SECRET-USER" },
    secrets: ["SECRET-APP", "SECRET-USER"],
    ok: () => jsonResponse({ status: 1 }),
    readable: (request) => [`${form(request).get("title")}\n${form(request).get("message")}`],
    limits: (request) => [
      { field: "title", text: form(request).get("title") ?? "", max: 250 },
      { field: "message", text: form(request).get("message") ?? "", max: 1024 },
    ],
  },
  teams: {
    settings: { webhookUrl: "https://example.webhook.office.com/SECRET-WEBHOOK" },
    secrets: ["SECRET-WEBHOOK"],
    ok: empty,
    readable: (request) => [
      json(request)
        .attachments[0].content.body.map((block: Json) => block.text)
        .join("\n"),
    ],
    limits: (request) => [{ field: "card", text: request.rawBody ?? "", max: 28_000, unit: "bytes" }],
  },
  matrix: {
    settings: {
      homeserverUrl: "https://matrix.example.org",
      roomId: "!room:example.org",
      accessToken: "SECRET-TOKEN",
    },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ event_id: "$event" }),
    readable: (request) => [json(request).body, json(request).formatted_body],
    limits: (request) => [{ field: "event", text: request.rawBody ?? "", max: 65_536, unit: "bytes" }],
  },
  pagerduty: {
    settings: { routingKey: "SECRET-ROUTING" },
    secrets: ["SECRET-ROUTING"],
    ok: () => jsonResponse({ status: "success" }, 202),
    readable: (request) => [`${json(request).payload.summary}\n${json(request).payload.custom_details.detail}`],
    limits: (request) => [{ field: "summary", text: json(request).payload.summary, max: 1024 }],
    dedupKey: (request) => json(request).dedup_key,
  },
  opsgenie: {
    settings: { apiKey: "SECRET-KEY" },
    secrets: ["SECRET-KEY"],
    ok: () => jsonResponse({ result: "Request will be processed" }, 202),
    readable: (request) => [`${json(request).message}\n${json(request).description}`],
    limits: (request) => [
      { field: "message", text: json(request).message, max: 130 },
      { field: "description", text: json(request).description, max: 15_000 },
    ],
    // A trigger names its alias in the body; a close names it in the path.
    dedupKey: (request) =>
      json(request).alias ?? decodeURIComponent(/alerts\/([^/]+)\/close/.exec(request.url)?.[1] ?? ""),
  },
  apprise: {
    settings: { serverUrl: "http://apprise:8000", urls: "tgram://SECRET-BOT/123" },
    secrets: ["SECRET-BOT"],
    ok: () => jsonResponse({}),
    readable: (request) => [`${json(request).title}\n${json(request).body}`],
    limits: () => [],
  },
  "splunk-oncall": {
    settings: { apiKey: "SECRET-KEY", routingKey: "ops" },
    secrets: ["SECRET-KEY"],
    ok: () => jsonResponse({ result: "success", entity_id: "x" }),
    readable: (request) => [`${json(request).entity_display_name}\n${json(request).state_message}`],
    limits: (request) => [
      { field: "entity_display_name", text: json(request).entity_display_name, max: 1024 },
      { field: "state_message", text: json(request).state_message, max: 15_000 },
    ],
    dedupKey: (request) => json(request).entity_id,
  },
  squadcast: {
    settings: { webhookUrl: "https://api.squadcast.com/v2/incidents/api/SECRET-KEY" },
    secrets: ["SECRET-KEY"],
    ok: () => jsonResponse({}, 202),
    readable: (request) => [`${json(request).message}\n${json(request).description}`],
    limits: (request) => [
      { field: "message", text: json(request).message, max: 1024 },
      { field: "description", text: json(request).description, max: 15_000 },
    ],
    dedupKey: (request) => json(request).event_id,
  },
  zenduty: {
    settings: { integrationKey: "SECRET-KEY" },
    secrets: ["SECRET-KEY"],
    ok: () => jsonResponse({}, 201),
    readable: (request) => [`${json(request).message}\n${json(request).summary}`],
    limits: (request) => [
      { field: "message", text: json(request).message, max: 512 },
      { field: "summary", text: json(request).summary, max: 15_000 },
    ],
    dedupKey: (request) => json(request).entity_id,
  },
  "incident-io": {
    settings: { alertSourceId: "01SOURCE", token: "SECRET-TOKEN" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ status: "success" }, 202),
    readable: (request) => [`${json(request).title}\n${json(request).description}`],
    limits: (request) => [
      { field: "title", text: json(request).title, max: 1024 },
      { field: "description", text: json(request).description, max: 15_000 },
    ],
    dedupKey: (request) => json(request).deduplication_key,
  },
  "grafana-oncall": {
    settings: { webhookUrl: "https://oncall.example.com/integrations/v1/formatted_webhook/SECRET-TOKEN/" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({}),
    readable: (request) => [`${json(request).title}\n${json(request).message}`],
    limits: (request) => [
      { field: "title", text: json(request).title, max: 1024 },
      { field: "message", text: json(request).message, max: 15_000 },
    ],
    dedupKey: (request) => json(request).alert_uid,
  },
  mattermost: {
    settings: { serverUrl: "https://chat.example.com", token: "SECRET-TOKEN", channelId: "chan" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ id: "post1" }, 201),
    readable: (request) => [json(request).message],
    limits: (request) => [{ field: "message", text: json(request).message, max: 16_383 }],
  },
  rocketchat: {
    settings: { serverUrl: "https://chat.example.com", userId: "bot", token: "SECRET-TOKEN", roomId: "room" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ success: true, message: { _id: "msg1" } }),
    readable: (request) => [json(request).text],
    limits: (request) => [{ field: "text", text: json(request).text, max: 5000 }],
  },
  zulip: {
    settings: {
      siteUrl: "https://example.zulipchat.com",
      botEmail: "bot@example.zulipchat.com",
      apiKey: "SECRET-KEY",
      stream: "status",
    },
    secrets: ["SECRET-KEY"],
    ok: () => jsonResponse({ result: "success", id: 42 }),
    readable: (request) => [form(request).get("content") ?? ""],
    limits: (request) => [
      { field: "content", text: form(request).get("content") ?? "", max: 10_000 },
      { field: "topic", text: form(request).get("topic") ?? "", max: 60 },
    ],
  },
  "google-chat": {
    settings: { webhookUrl: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=SECRET-KEY&token=SECRET-TOKEN" },
    secrets: ["SECRET-KEY", "SECRET-TOKEN"],
    ok: () => jsonResponse({ name: "spaces/AAA/messages/1" }),
    readable: (request) => [json(request).text],
    limits: (request) => [{ field: "text", text: json(request).text, max: 4096 }],
    // The thread key, which is what gathers an incident's messages.
    dedupKey: (request) => json(request).thread?.threadKey ?? "",
  },
  "twilio-sms": {
    settings: { accountSid: "AC123", authToken: "SECRET-TOKEN", from: "+15005550006", to: "+393331234567" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ sid: "SM1" }, 201),
    readable: (request) => [form(request).get("Body") ?? ""],
    limits: (request) => [{ field: "Body", text: form(request).get("Body") ?? "", max: 1600 }],
  },
  "twilio-call": {
    settings: { accountSid: "AC123", authToken: "SECRET-TOKEN", from: "+15005550006", to: "+393331234567" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ sid: "CA1" }, 201),
    readable: (request) => [form(request).get("Twiml") ?? ""],
    limits: (request) => [{ field: "Twiml", text: form(request).get("Twiml") ?? "", max: 4000 }],
  },
  bark: {
    settings: { deviceKey: "SECRET-DEVICE" },
    secrets: ["SECRET-DEVICE"],
    ok: () => jsonResponse({ code: 200, message: "success" }),
    readable: (request) => [`${json(request).title}\n${json(request).body}`],
    limits: (request) => [{ field: "notification", text: request.rawBody ?? "", max: 4096, unit: "bytes" }],
  },
  signal: {
    settings: { serverUrl: "http://signal-api:8080", number: "+393330000000", recipients: "+393331111111" },
    secrets: [],
    ok: () => jsonResponse({ timestamp: "1" }, 201),
    readable: (request) => [json(request).message],
    limits: (request) => [{ field: "message", text: json(request).message, max: 2000 }],
  },
  mastodon: {
    settings: { instanceUrl: "https://mastodon.example", accessToken: "SECRET-TOKEN" },
    secrets: ["SECRET-TOKEN"],
    ok: () => jsonResponse({ id: "1" }),
    readable: (request) => [json(request).status],
    // Mastodon counts any link as 23 characters, whatever its length.
    limits: (request) => [
      {
        field: "status",
        text: json(request).status.replace(/https?:\/\/\S+/g, "x".repeat(23)),
        max: 500,
      },
    ],
  },
  bluesky: {
    settings: { handle: "status.example.com", appPassword: "SECRET-APP-PASSWORD" },
    secrets: ["SECRET-APP-PASSWORD", "SECRET-JWT"],
    ok: (request) =>
      request.url.endsWith("createSession")
        ? jsonResponse({ did: "did:plc:abc", accessJwt: "SECRET-JWT" })
        : jsonResponse({ uri: "at://did:plc:abc/app.bsky.feed.post/1", cid: "c" }),
    readable: (request) => [json(request).record.text],
    limits: (request) => [{ field: "text", text: json(request).record.text, max: 300, unit: "graphemes" }],
  },
};

/**
 * Channels the HTTP contract cannot drive, each with the suite that holds it
 * to the same properties instead. Listed rather than skipped silently, so a new
 * channel has to say which it is.
 */
export const EXEMPT: Record<string, string> = {
  email: "SMTP over a socket — test/notifiers/email.test.ts runs it against a fake server",
  syslog: "UDP, TCP or TLS — test/notifiers/syslog.test.ts runs it against local collectors",
  mqtt: "MQTT over a socket — test/notifiers/mqtt.test.ts runs it against a fake broker",
};
