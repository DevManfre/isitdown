import { query, path, json, ref, ok, notFound, badRequest, media } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Preferences, diagnostics, provider actions, heartbeats, the public page, live streams and this document. */
export const operationsPaths: Json = {
  "/api/preferences": {
    get: {
      tags: ["Preferences"],
      summary: "Theme, accent, instance name and logo, locales, map view and time zone.",
      responses: { "200": ok({ type: "object" }) },
    },
    patch: {
      tags: ["Preferences"],
      summary: "Change any of them.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/debug/adapters": {
    get: {
      tags: ["Diagnostics"],
      summary:
        "Per provider: its adapter, base URL, options and last twenty read outcomes.",
      description: "In memory, so a restart empties it.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/notifications/{id}/replay": {
    get: {
      tags: ["Notifications"],
      summary: "Why did I get this alert? Replays the saved readings through the live diff, damping, routing and quiet hours.",
      description:
        "Roadmap 5.12. Replays with the settings in force now (`replayedWith`), and says `reproduced: false` when they would not produce the alert. `available: false` once the readings behind it have been trimmed.",
      parameters: [path("id", "Delivery log row id.")],
      responses: { "200": ok({ type: "object" }), "400": badRequest, "404": notFound },
    },
  },
  "/debug/adapters/{id}/explain": {
    get: {
      tags: ["Diagnostics"],
      summary:
        "Why that provider shows the status it shows: last reading, components, rule, what you were last told, flap damping.",
      description:
        "Read off the state the poller already keeps (roadmap 5.11). It never polls.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/debug/adapters/{id}/probe": {
    post: {
      tags: ["Diagnostics"],
      summary: "One read of that provider's page, right now, reported in full.",
      parameters: [path("id", "Service id.")],
      responses: {
        "200": ok({ type: "object" }, "A failed read is 200 with ok: false."),
        "404": notFound,
      },
    },
  },
  "/config/provider-push": {
    get: {
      tags: ["Diagnostics"],
      summary: "What subscribing each provider's webhook takes, and whether one has arrived.",
      description:
        "Roadmap 1.2. `{ enabled, tokenRevealed, providers: [{ providerId, eligible, url, lastReceivedAt, received }] }`. `enabled` is whether `PUSH_TOKEN` is set; `eligible` whether the provider is enabled and the dashboard has a subscription guide for its adapter (Atlassian Statuspage today); `url` the address to paste on the provider's page, `null` when either is false. The URL carries the push token only for a request that could also write — a read-only `API_TOKEN` holder gets `<PUSH_TOKEN>` in its place, and `tokenRevealed` says which. `lastReceivedAt` and `received` count every accepted post, coalesced ones included: Statuspage sends no test event, so a real post arriving is the only proof the subscription works.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/push/{providerId}": {
    post: {
      tags: ["Diagnostics"],
      summary: "A provider's own webhook: read this provider now.",
      description:
        "Roadmap 2.10. Registered as the subscriber URL on a provider's status page, so a change is read in seconds instead of on the next cadence. The body is a trigger, not a reading — the provider is then read through its adapter, so a pushed change and a polled one go through the same diff engine. Requires `?token=` matching `PUSH_TOKEN`; without that variable set the route answers 404. Several posts within ten seconds are coalesced into one read (202).",
      parameters: [
        path("providerId", "Provider id."),
        query("token", "Must equal PUSH_TOKEN.", { type: "string" }),
      ],
      requestBody: { required: false, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }, "The provider was read."),
        "202": ok({ type: "object" }, "Coalesced into a read already made."),
        "400": badRequest,
        "401": {
          description: "Wrong or missing token.",
          ...json(ref("Error")),
        },
        "404": notFound,
      },
    },
  },
  "/providers/{id}/ack": {
    post: {
      tags: ["Providers"],
      summary: "Say you are on a provider's trouble.",
      description:
        "Roadmap 3.1. What a web push toast's *I'm on it* button calls. Records that somebody has taken this provider's current trouble in charge — `{ newly, by, at }`. The first press wins: a second one changes nothing and answers `newly: false` with who got there first. Cleared by itself once the provider is operational with no open incident. The acknowledgement is what a later escalation reads before nagging a second channel. Read-only `API_TOKEN` holders cannot call it.",
      parameters: [path("id", "Provider id.")],
      responses: {
        "200": ok({ type: "object" }, "Recorded, or already recorded by somebody else."),
        "404": notFound,
      },
    },
  },
  "/providers/{id}/mute": {
    post: {
      tags: ["Providers"],
      summary: "Mute a provider for a while.",
      description:
        "Roadmap 3.1. What a web push toast's *Mute 2h* button calls. Writes the same `mutedUntil` the dashboard's own mute button does — `{ mutedUntil }`, an ISO 8601 UTC instant — so the diff engine reads it back like any other mute. The optional body `{ minutes }` (1 to 43200, default 120) sets how long; no body is two hours. Read-only `API_TOKEN` holders cannot call it.",
      parameters: [path("id", "Provider id.")],
      requestBody: { required: false, ...json({ type: "object", properties: { minutes: { type: "integer", minimum: 1, maximum: 43200 } } }) },
      responses: {
        "200": ok({ type: "object" }, "The provider is muted until `mutedUntil`."),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/heartbeats": {
    get: {
      tags: ["Diagnostics"],
      summary: "Every heartbeat provider's ping URL, and when its job last called.",
      description:
        "Roadmap 2.5. `{ enabled, tokenRevealed, heartbeats: [{ providerId, url, lastPingAt, pings }] }`. `enabled` is whether `HEARTBEAT_TOKEN` is set; `url` is null while it is not, or while the provider is disabled. The token is revealed only to a request that could also write — a read-only `API_TOKEN` holder gets `<HEARTBEAT_TOKEN>` in its place, and `tokenRevealed` says which.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/heartbeat/{providerId}": {
    get: {
      tags: ["Diagnostics"],
      summary: "A job's dead-man's-switch ping: it ran.",
      description:
        "Roadmap 2.5. Called by the job itself — the last line of a crontab — so GET works as well as POST. Records the time and reads that one provider now, so a job that was late and has called resolves in seconds; the verdict is the `heartbeat` adapter's, through the diff engine like any outage. Requires `?token=` matching `HEARTBEAT_TOKEN`; without the variable set the route answers 404. Calls within ten seconds of a read are recorded without another one (202). Never gated by `API_TOKEN`: the caller is a script, and the URL is its credential.",
      parameters: [path("providerId", "Heartbeat provider id."), query("token", "Must equal HEARTBEAT_TOKEN.", { type: "string" })],
      responses: {
        "200": ok({ type: "object" }, "Recorded, and the provider read."),
        "202": ok({ type: "object" }, "Recorded inside the cooldown; no extra read."),
        "401": { description: "Wrong or missing token.", ...json(ref("Error")) },
        "404": notFound,
      },
    },
    post: {
      tags: ["Diagnostics"],
      summary: "The same ping, for a caller that prefers POST.",
      parameters: [path("providerId", "Heartbeat provider id."), query("token", "Must equal HEARTBEAT_TOKEN.", { type: "string" })],
      responses: {
        "200": ok({ type: "object" }, "Recorded, and the provider read."),
        "202": ok({ type: "object" }, "Recorded inside the cooldown; no extra read."),
        "401": { description: "Wrong or missing token.", ...json(ref("Error")) },
        "404": notFound,
      },
    },
  },
  "/public": {
    get: {
      tags: ["Public"],
      summary: "The public read-only status page, as HTML.",
      description:
        "Roadmap 5.1. One self-contained document with no script in it, built from a projection that carries no adapter, channel, routing, mute or credential field. Answers 404 unless `PUBLIC_PAGE=true`. `PUBLIC_PAGE_PROVIDERS` chooses what appears; the request itself carries no input, so a visitor cannot widen it. Never gated by `API_TOKEN` — its readers are exactly the people who hold none.",
      responses: {
        "200": media("text/html", "The page."),
        "404": notFound,
      },
    },
  },
  "/public/summary.json": {
    get: {
      tags: ["Public"],
      summary: "The same published projection as JSON.",
      description:
        "The very object `/public` is rendered from, CORS-open for anyone building their own view. Two projections would eventually disagree, so there is only one. Answers 404 unless `PUBLIC_PAGE=true`.",
      responses: {
        "200": ok({ type: "object" }, "The published fleet."),
        "404": notFound,
      },
    },
  },
  "/poll": {
    post: {
      tags: ["Diagnostics"],
      summary: "Run a cycle now, through the scheduler.",
      responses: { "200": ok({ type: "object" }, "The cycle summary.") },
    },
  },
  "/events": {
    get: {
      tags: ["Live"],
      summary:
        "Server-sent events: hello on connect, then one cycle event per cycle.",
      description:
        "The stream is a courier, not a source of truth: it says what changed and the client re-reads it.",
      responses: {
        "200": media("text/event-stream", "A long-lived response."),
      },
    },
  },
  "/metrics": {
    get: {
      tags: ["Live"],
      summary: "Prometheus exposition.",
      responses: {
        "200": media("text/plain", "Prometheus text format 0.0.4."),
      },
    },
  },
  "/widget": {
    get: {
      tags: ["Live"],
      summary: "A one-line fleet summary for a status widget.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/badge.svg": {
    get: {
      tags: ["Live"],
      summary:
        "An SVG badge for the whole fleet: the worst reading anything is showing.",
      responses: { "200": media("image/svg+xml", "The badge.") },
    },
  },
  "/badge/{providerId}.svg": {
    get: {
      tags: ["Live"],
      summary: "The same badge for one provider.",
      parameters: [path("providerId", "Provider id.")],
      responses: {
        "200": media("image/svg+xml", "The badge."),
        "404": media(
          "image/svg+xml",
          "Still a badge, saying the id is unknown.",
        ),
      },
    },
  },
  "/render/fleet.png": {
    get: {
      tags: ["Live"],
      summary: "The fleet as a 1-bit black-and-white PNG, for e-ink frames and chats.",
      description:
        "Worst readings first, a provider that is not operational drawn inverted. `w` and `h` are clamped to 200–2000 (default 800×480).",
      parameters: [query("w", "Width in pixels."), query("h", "Height in pixels.")],
      responses: { "200": media("image/png", "The picture.") },
    },
  },
  "/render/fleet.svg": {
    get: {
      tags: ["Live"],
      summary: "The same picture as SVG.",
      parameters: [query("w", "Width in pixels."), query("h", "Height in pixels.")],
      responses: { "200": media("image/svg+xml", "The picture.") },
    },
  },
  "/homeassistant": {
    get: {
      tags: ["Live"],
      summary:
        "One flat object per provider, for Home Assistant's REST integration.",
      description:
        "`state` is ON when the provider is anything but operational, which is what `device_class: problem` expects. A pure read of stored state.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/homeassistant/configuration.yaml": {
    get: {
      tags: ["Live"],
      summary:
        "The Home Assistant configuration for the fleet as it stands, ready to paste.",
      responses: {
        "200": media(
          "text/yaml",
          "One rest resource, one binary sensor per provider.",
        ),
      },
    },
  },
  "/openapi.json": {
    get: {
      tags: ["Meta"],
      summary: "This document.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/openapi.yaml": {
    get: {
      tags: ["Meta"],
      summary: "This document, as YAML.",
      responses: { "200": media("text/yaml", "The same document.") },
    },
  },
};
