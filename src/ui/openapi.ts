/**
 * The UI edition's HTTP API, machine-readable — roadmap 4.10.
 *
 * Written here rather than generated from the route handlers, and deliberately
 * so: Express routes carry no type information about what they answer with, and
 * a spec inferred from them would describe the shapes as `object` and be worth
 * nothing to a generated client. What keeps it honest instead is
 * `test/ui/openapi.test.ts`, which walks the running app's own route table and
 * fails when a path is registered without being described here, or described
 * here without existing.
 *
 * `info.version` is the *API contract's* version, not the product's: the
 * package version moves with every release, and a client generated against
 * this document has no reason to be regenerated because the dashboard's CSS
 * changed.
 */

export const API_VERSION = "1.0.0";

type Json = Record<string, unknown>;

/** A query parameter, in the one shape every path below spells it. */
import { ANNOTATION_COLOURS } from "./historyStore.interface.ts";
import { AUTHORITIES } from "../core/authority.ts";
import { PREVIEW_KINDS } from "./notificationPreview.ts";
const query = (
  name: string,
  description: string,
  schema: Json = { type: "string" },
): Json => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

const path = (name: string, description: string): Json => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const json = (schema: Json): Json => ({
  content: { "application/json": { schema } },
});

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const ok = (schema: Json, description = "Success."): Json => ({
  description,
  ...json(schema),
});

const notFound: Json = {
  description: "No such id.",
  ...json(ref("Error")),
};

const badRequest: Json = {
  description: "The request names an invalid field or value.",
  ...json(ref("Error")),
};

/** A response that is not JSON: a badge, a feed, a CSV, the metrics. */
const media = (mediaType: string, description: string): Json => ({
  description,
  content: { [mediaType]: { schema: { type: "string" } } },
});

const incidentFilters = [
  query("provider", "Narrow to one provider id."),
  query("state", "all (default), active or resolved.", {
    type: "string",
    enum: ["all", "active", "resolved"],
  }),
  query("q", "Case-insensitive search over incident names."),
  query("days", "Keep only incidents that started within this window.", {
    type: "integer",
  }),
];

const paging = [
  query(
    "page",
    "1-based page number; a nonsense value falls back to the first page.",
    {
      type: "integer",
      minimum: 1,
    },
  ),
  query("pageSize", "Rows per page.", { type: "integer", minimum: 1 }),
];

/**
 * Every route the server registers, in the order `docs/api.md` presents them.
 * Summaries are that page's own sentences, shortened: two descriptions of one
 * endpoint is how they start disagreeing.
 */
const paths: Json = {
  "/health": {
    get: {
      tags: ["Health"],
      summary: "Liveness, and only that: the process answers.",
      description: "Never fails because a provider is unreachable.",
      responses: { "200": ok(ref("Health")) },
    },
  },
  "/ready": {
    get: {
      tags: ["Health"],
      summary: "Readiness: whether polling is working.",
      description:
        "503 when no cycle has completed, the last one is more than three poll intervals old, or every provider failed in it. This is what the container healthcheck asks.",
      responses: {
        "200": ok(ref("Readiness")),
        "503": {
          description: "Polling is not working.",
          ...json(ref("Readiness")),
        },
      },
    },
  },
  "/status": {
    get: {
      tags: ["Status"],
      summary:
        "Current status of every provider, plus the poll clock and groups.",
      description:
        "A pure database read: safe to poll, never reaches upstream.",
      responses: { "200": ok(ref("StatusPayload")) },
    },
  },
  "/history": {
    get: {
      tags: ["History"],
      summary: "Pre-aggregated daily buckets and 7/30/90-day uptime.",
      parameters: [
        query(
          "provider",
          "One provider; omit for a summary across all of them.",
        ),
        query("days", "7, 30 or 90. Anything else is a 400 naming them.", {
          type: "integer",
          enum: [7, 30, 90],
        }),
        query(
          "from",
          "Start of an arbitrary window, YYYY-MM-DD (roadmap 5.5).",
        ),
        query("to", "End of that window, inclusive, YYYY-MM-DD."),
      ],
      responses: {
        "200": ok({ type: "object" }),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/sla": {
    get: {
      tags: ["History"],
      summary: "Monthly uptime targets and what the month has spent of them.",
      description:
        "Roadmap 4.13. One entry per provider that has a target: the budget the target implies, minutes spent, the burn rate against elapsed time, and where the month lands at this rate. Providers with no target are absent rather than reported at 100%.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/history/calendar": {
    get: {
      tags: ["History"],
      summary: "A year of day cells for one provider.",
      parameters: [query("provider", "Provider id. Required.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/history/components": {
    get: {
      tags: ["History"],
      summary: "Per-component uptime for one provider's selected components.",
      parameters: [
        query("provider", "Provider id. Required."),
        query("days", "Window in days.", { type: "integer" }),
      ],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/notifications/preview": {
    get: {
      tags: ["Notifications"],
      summary:
        "What every configured channel would say about one invented transition.",
      description:
        "Roadmap 14.1. Nothing is sent and nothing is recorded. `text` is the whole message for a channel that posts text, and null for one that builds a structure of its own — `parts` is the heading, detail and url every channel assembles from, which is the honest common denominator rather than a mock-up that could drift.",
      parameters: [
        query(
          "kind",
          `One of ${PREVIEW_KINDS.join(", ")}. Defaults to the first.`,
        ),
      ],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/reliability": {
    get: {
      tags: ["History"],
      summary:
        "Per-provider MTTR, MTBF and the longest outage, plus incidents by weekday and hour.",
      description:
        "Roadmap 12.2 and 12.3, over rows the poller already wrote. `mttrMinutes` counts only incidents that have been resolved, `mtbfMinutes` needs at least two, and both are null rather than 0 when the window cannot answer. `byWeekdayHour` is [weekday][hour] in the operator's zone, Monday first, counted by when an incident started.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/annotations": {
    get: {
      tags: ["History"],
      summary: "The operator's own timeline markers over a window.",
      description:
        "A provider's markers include the fleet-wide ones: a deploy that broke one provider's page is exactly the marker wanted on its chart.",
      parameters: [
        query("days", "Window in days.", { type: "integer" }),
        query("from", "Range start, YYYY-MM-DD."),
        query("to", "Range end, YYYY-MM-DD."),
        query(
          "provider",
          "Narrow to one provider, fleet-wide markers included.",
        ),
      ],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
    post: {
      tags: ["History"],
      summary:
        "Write one marker — a deploy, a config change, anything of ours.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["at", "label", "colour"],
          properties: {
            at: { type: "string", format: "date-time" },
            label: { type: "string", minLength: 1, maxLength: 120 },
            colour: { type: "string", enum: [...ANNOTATION_COLOURS] },
            providerId: {
              type: "string",
              description: "Omit for a marker about the whole fleet.",
            },
          },
        }),
      },
      responses: {
        "201": ok({ type: "object" }, "The stored marker."),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/annotations/{id}": {
    delete: {
      tags: ["History"],
      summary: "Remove one marker.",
      parameters: [path("id", "Marker id.")],
      responses: {
        "204": { description: "Removed." },
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/incidents": {
    get: {
      tags: ["Incidents"],
      summary: "One page of the incident list, with the open ones beside it.",
      parameters: [...incidentFilters, ...paging],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/incidents/{providerId}/{incidentId}": {
    get: {
      tags: ["Incidents"],
      summary:
        "One incident: the timeline, what was sent, the last polls, the operator's notes.",
      parameters: [
        path("providerId", "Provider id."),
        path("incidentId", "The provider's own incident id."),
      ],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/incidents/{providerId}/{incidentId}/notes": {
    post: {
      tags: ["Incidents"],
      summary: "Write one operator note on an incident.",
      parameters: [
        path("providerId", "Provider id."),
        path("incidentId", "Incident id."),
      ],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["body"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 2000 },
          },
        }),
      },
      responses: {
        "201": ok({ type: "object" }, "The stored note."),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/incidents/{providerId}/{incidentId}/notes/{noteId}": {
    delete: {
      tags: ["Incidents"],
      summary: "Remove one note, scoped to the incident it was written on.",
      parameters: [
        path("providerId", "Provider id."),
        path("incidentId", "Incident id."),
        path("noteId", "Note id."),
      ],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/maintenances": {
    get: {
      tags: ["Incidents"],
      summary: "Declared maintenance windows: running, upcoming and past.",
      parameters: [
        query("provider", "One provider; omit for every enabled one."),
        query("days", "How far back a closed window is still returned.", {
          type: "integer",
        }),
      ],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/notifications": {
    get: {
      tags: ["Notifications"],
      summary: "What was actually sent, newest first.",
      parameters: [
        query("limit", "Capped at 200.", { type: "integer", maximum: 200 }),
      ],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/notifications/log": {
    get: {
      tags: ["Notifications"],
      summary:
        "One page of the delivery log, with counts that ignore the filter.",
      parameters: [
        query("state", "all (default), sent or failed.", {
          type: "string",
          enum: ["all", "sent", "failed"],
        }),
        query("channel", "Narrow to one channel id."),
        ...paging,
      ],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/map": {
    get: {
      tags: ["Status"],
      summary: "Where each provider is answering from, for the map and globe.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/export/incidents.csv": {
    get: {
      tags: ["Export"],
      summary: "The incident search's own result as RFC 4180 CSV.",
      parameters: incidentFilters,
      responses: {
        "200": media(
          "text/csv",
          "Capped at 20 000 rows; a capped export sets X-IsItDown-Truncated.",
        ),
      },
    },
  },
  "/export/incidents.json": {
    get: {
      tags: ["Export"],
      summary: "The same rows, with the filter echoed back.",
      parameters: incidentFilters,
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/export/history.csv": {
    get: {
      tags: ["Export"],
      summary: "Uptime history, one row per provider per day.",
      parameters: [
        query("provider", "One provider; omit for all."),
        query("days", "7, 30 or 90.", { type: "integer" }),
      ],
      responses: {
        "200": media("text/csv", "One row per provider per day."),
        "404": notFound,
      },
    },
  },
  "/export/history.json": {
    get: {
      tags: ["Export"],
      summary: "The same window as the charts are drawn from.",
      parameters: [
        query("provider", "One provider; omit for all."),
        query("days", "7, 30 or 90.", { type: "integer" }),
      ],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/trust": {
    get: {
      tags: ["History"],
      summary:
        "How closely each cross-checked status page tracked what a probe observed.",
      description:
        "Roadmap 8.1. One card per probe that names a page in `crossChecks`: median and p90 admission delay, how much of the observed outage the page had an incident open for, and how many episodes it never mentioned — three axes, never one score. A card whose window holds fewer than ten counted episodes reports the count and nothing else. A fleet with no probe returns an empty list.",
      parameters: [
        query("days", "Window in days: 30, 90 or 365.", { type: "integer" }),
      ],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/trust/{key}/episodes": {
    get: {
      tags: ["History"],
      summary: "Every disagreement behind one trust card, newest first.",
      description:
        "Excluded episodes included, with their reason: they are how the excluded counts on the card can be checked.",
      parameters: [
        {
          name: "key",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "`<probe>-><page>` or `<probe>-><page>#<component>`.",
        },
        query("days", "Window in days: 30, 90 or 365.", { type: "integer" }),
      ],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/export/trust.csv": {
    get: {
      tags: ["Export"],
      summary: "One row per trust episode, pair repeated on each.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": media("text/csv", "The episodes.") },
    },
  },
  "/export/trust.json": {
    get: {
      tags: ["Export"],
      summary: "Trust cards with their episodes, exclusions and vantage point.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/export/monthly.md": {
    get: {
      tags: ["Export"],
      summary: "One calendar month written up as Markdown.",
      parameters: [query("month", "YYYY-MM; defaults to the current month.")],
      responses: { "200": media("text/markdown", "The report.") },
    },
  },
  "/export/gatus.yaml": {
    get: {
      tags: ["Export"],
      summary: "The fleet as a Gatus config.yaml endpoint list.",
      responses: { "200": media("text/yaml", "Only http/tcp/dns probes translate; the rest are counted in the header.") },
    },
  },
  "/feeds/incidents.xml": {
    get: {
      tags: ["Export"],
      summary: "The incident search as an RSS 2.0 feed.",
      parameters: incidentFilters,
      responses: {
        "200": media("application/rss+xml", "Newest 200 incidents."),
      },
    },
  },
  "/feeds/incidents.ics": {
    get: {
      tags: ["Export"],
      summary: "The same rows as an iCalendar file, one VEVENT per incident.",
      parameters: incidentFilters,
      responses: { "200": media("text/calendar", "The calendar.") },
    },
  },
  "/config": {
    get: {
      tags: ["Configuration"],
      summary:
        "Services, polling settings, retention, delivery, channels, routing, removed providers.",
      description:
        "Channel credentials appear as variable names with an isSet flag — never values.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/export": {
    get: {
      tags: ["Configuration"],
      summary: "The whole configuration as a Light edition config.yml.",
      responses: {
        "200": media(
          "text/yaml",
          "Credentials leave as ${VAR} references, never values.",
        ),
      },
    },
  },
  "/config/import": {
    post: {
      tags: ["Configuration"],
      summary: "The same file, read back.",
      requestBody: {
        required: true,
        content: {
          "text/yaml": { schema: { type: "string" } },
          "application/json": {
            schema: {
              type: "object",
              required: ["yaml"],
              properties: { yaml: { type: "string" } },
            },
          },
        },
      },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/backup": {
    get: {
      tags: ["Configuration"],
      summary: "The whole database as one file, taken with VACUUM INTO.",
      responses: {
        "200": media(
          "application/octet-stream",
          "Carries X-IsItDown-Secrets: excluded.",
        ),
      },
    },
  },
  "/config/restore": {
    post: {
      tags: ["Configuration"],
      summary: "That file, put back, checked before anything is deleted.",
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/catalog": {
    get: {
      tags: ["Configuration"],
      summary: "The bundled provider catalog, answered from memory.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/services": {
    post: {
      tags: ["Configuration"],
      summary: "Add a service.",
      requestBody: { required: true, ...json(ref("Service")) },
      responses: {
        "201": ok(ref("Service"), "The stored service."),
        "400": badRequest,
        "409": {
          description: "A service with that id already exists.",
          ...json(ref("Error")),
        },
      },
    },
  },
  "/config/services/detect": {
    post: {
      tags: ["Configuration"],
      summary:
        "Which adapter reads the page at this URL, and the base URL it wants.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["url"],
          properties: { url: { type: "string" } },
        }),
      },
      responses: {
        "200": ok(
          { type: "object" },
          "adapter is null when nothing recognised the page.",
        ),
        "400": badRequest,
      },
    },
  },
  "/config/services/preview-components": {
    post: {
      tags: ["Configuration"],
      summary: "The components a provider exposes, for the selection picker.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/services/{id}": {
    patch: {
      tags: ["Configuration"],
      summary: "Edit a service.",
      parameters: [path("id", "Service id.")],
      requestBody: { required: true, ...json(ref("Service")) },
      responses: {
        "200": ok(ref("Service")),
        "400": badRequest,
        "404": notFound,
      },
    },
    delete: {
      tags: ["Configuration"],
      summary:
        "Remove a service — a soft delete, restorable inside its window.",
      parameters: [path("id", "Service id.")],
      responses: {
        "200": ok({ type: "object" }, "{ removed, removedAt, restoreUntil }"),
        "404": notFound,
      },
    },
  },
  "/config/services/{id}/impact": {
    get: {
      tags: ["Configuration"],
      summary: "What a permanent removal would take with it.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/config/services/{id}/restore": {
    post: {
      tags: ["Configuration"],
      summary:
        "Undo a removal inside its window; the gap in history is backfilled.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/config/services/{id}/permanently": {
    delete: {
      tags: ["Configuration"],
      summary:
        "The destructive half: cascades to samples, incidents, maintenances, state and rules.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/config/services/{id}/test": {
    post: {
      tags: ["Configuration"],
      summary: "One live fetch against that provider. Records nothing.",
      parameters: [path("id", "Service id.")],
      responses: {
        "200": ok({ type: "object" }, "A failed read is 200 with ok: false."),
        "404": notFound,
      },
    },
  },
  "/config/settings": {
    patch: {
      tags: ["Configuration"],
      summary: "Polling settings, retention and the delivery policy.",
      description: "The delivery patch is partial at every level.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/storage": {
    get: {
      tags: ["Configuration"],
      summary:
        "What retention costs: size on disk, sample count, bytes per sample.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/storage/maintenance": {
    post: {
      tags: ["Configuration"],
      summary: "PRAGMA integrity_check, then VACUUM. Deletes nothing.",
      responses: {
        "200": ok({ type: "object" }, "A failed check is 200 with ok: false."),
      },
    },
  },
  "/config/routing": {
    put: {
      tags: ["Configuration"],
      summary: "Replace the routing rules, in evaluation order.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/channels/{id}": {
    patch: {
      tags: ["Configuration"],
      summary:
        "Enable or disable a channel, set its variable names, its locale and its template.",
      description:
        "Refuses a literal secret. `locale` (roadmap 3.20) and `template` (roadmap 3.15) are the two fields that are not credentials: an empty string clears either back to the default, and a template naming an unknown token is a 400.",
      parameters: [path("id", "Channel id.")],
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/channels/{id}/secrets": {
    put: {
      tags: ["Configuration"],
      summary:
        "Save credential values. Write-only: the response carries names and isSet.",
      parameters: [path("id", "Channel id.")],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["fields"],
          properties: {
            fields: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        }),
      },
      responses: {
        "200": ok({ type: "object" }),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/channels/{id}/secrets/{field}": {
    delete: {
      tags: ["Configuration"],
      summary: "Forget a saved credential value.",
      parameters: [path("id", "Channel id."), path("field", "Field name.")],
      responses: {
        "200": ok({ type: "object" }),
        "404": notFound,
        "409": {
          description:
            "The variable came from the container's environment instead.",
          ...json(ref("Error")),
        },
      },
    },
  },
  "/config/channels/{id}/test": {
    post: {
      tags: ["Configuration"],
      summary: "One test notification, through the dispatcher.",
      parameters: [path("id", "Channel id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/config/push": {
    get: {
      tags: ["Configuration"],
      summary:
        "The server's VAPID public key, for a browser about to subscribe.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/push/subscriptions": {
    get: {
      tags: ["Configuration"],
      summary: "The browsers currently subscribed to desktop push.",
      responses: { "200": ok({ type: "object" }) },
    },
    post: {
      tags: ["Configuration"],
      summary: "Subscribe this browser.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "201": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/push/subscriptions/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Remove one subscribed browser.",
      parameters: [path("id", "Subscription id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/api/preferences": {
    get: {
      tags: ["Preferences"],
      summary: "Theme, locales, map view and time zone.",
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

const schemas: Json = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "object", properties: { message: { type: "string" } } },
    },
  },
  OverallStatus: {
    type: "string",
    enum: [
      "operational",
      "degraded",
      "partial_outage",
      "major_outage",
      "unknown",
    ],
  },
  Health: {
    type: "object",
    properties: {
      status: { type: "string" },
      providers: { type: "integer" },
      lastCycleAt: { type: "string", nullable: true },
    },
  },
  Readiness: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ready", "not-ready"] },
      providers: { type: "integer" },
      failed: { type: "integer" },
      lastCycleAt: { type: "string", nullable: true },
      ageSeconds: { type: "number", nullable: true },
      staleAfterSeconds: { type: "number" },
      reason: { type: "string" },
    },
  },
  StatusPayload: {
    type: "object",
    properties: {
      providers: { type: "array", items: ref("ProviderStatus") },
      groups: { type: "array", items: { type: "object" } },
      maintenance: {
        type: "object",
        properties: {
          active: { type: "array", items: { type: "object" } },
          upcoming: { type: "array", items: { type: "object" } },
        },
      },
      lastPollAt: { type: "string", nullable: true },
      nextPollAt: { type: "string", nullable: true },
    },
  },
  ProviderStatus: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      overallStatus: ref("OverallStatus"),
      activeIncidents: { type: "array", items: { type: "object" } },
      components: { type: "array", items: { type: "object" } },
      fetchedAt: { type: "string", nullable: true },
      failureCount: { type: "integer" },
    },
  },
  Service: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      adapter: { type: "string" },
      baseUrl: { type: "string" },
      enabled: { type: "boolean" },
      group: { type: "string", nullable: true },
      crossChecks: {
        type: "string",
        nullable: true,
        description:
          "On a probe: the provider whose page it cross-checks (roadmap 1.10).",
      },
      intervalMinutes: { type: "integer", nullable: true },
      mutedUntil: { type: "string", nullable: true },
      options: { type: "object", additionalProperties: { type: "string" } },
      components: { type: "array", items: { type: "object" } },
      scopeToComponents: { type: "boolean" },
      authority: {
        type: "string",
        enum: [...AUTHORITIES],
        nullable: true,
        description:
          "Which source is the record for this provider (roadmap 9.1). Null — the normal case — means the adapter decides: a probe is `observed`, a status page is `declared`.",
      },
    },
  },
};

/**
 * The document itself. Built on each call rather than kept as a frozen
 * constant: the only caller is a route that serialises it, and a shared mutable
 * object handed to two of them is a trap for no gain.
 */
export function openapiDocument(): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "IsItDown",
      version: API_VERSION,
      description:
        "The UI edition's HTTP API. It is a single-operator dashboard bound to the machine it runs on, so by default nothing here is authenticated. Setting API_TOKEN (roadmap 4.15) turns on the one scheme below: a bearer token granting read access from any host, while writes stay local-only. /health and /ready are never gated.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/", description: "This instance." }],
    tags: [
      { name: "Health", description: "Liveness and readiness." },
      {
        name: "Status",
        description: "What every provider is reporting right now.",
      },
      { name: "History", description: "Stored samples, aggregated." },
      {
        name: "Incidents",
        description: "Incident search, detail and operator notes.",
      },
      { name: "Notifications", description: "What was sent, and what failed." },
      { name: "Export", description: "Downloads and feeds." },
      {
        name: "Configuration",
        description: "Providers, settings, channels, routing, backups.",
      },
      {
        name: "Preferences",
        description: "Per-dashboard display preferences.",
      },
      { name: "Diagnostics", description: "Adapter probes and manual polls." },
      { name: "Live", description: "Streams and scrape targets." },
      {
        name: "Public",
        description:
          "The read-only status page, for readers who are not the operator.",
      },
      { name: "Meta", description: "This document." },
    ],
    paths,
    components: {
      schemas,
      /**
       * Declared rather than applied: with no `API_TOKEN` set — the default —
       * every route is open, and a `security` requirement on each path would
       * tell a generated client to demand a credential most installations do
       * not have.
       */
      securitySchemes: {
        apiToken: {
          type: "http",
          scheme: "bearer",
          description:
            "The value of API_TOKEN, when the instance sets one. Grants GET and HEAD from any host; anything else answers 403. X-API-Token carries the same value for a client that cannot send an Authorization header.",
        },
      },
    },
  };
}
