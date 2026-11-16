import { ANNOTATION_COLOURS } from "../historyStore.interface.ts";
import { PREVIEW_KINDS } from "../notificationPreview.ts";
import { query, path, json, ok, ref, notFound, badRequest } from "./shared.ts";
import type { Json } from "./shared.ts";

/** History, search, reliability and the operator's annotations. */
export const historyPaths: Json = {
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
        "200": ok({
          oneOf: [ref("HistoryProvider"), ref("HistorySummary")],
        }),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/search": {
    get: {
      tags: ["History"],
      summary: "One text search over incident titles, operator notes and annotations.",
      description:
        "Roadmap 4.15. Case-insensitive, at most eight of each, newest first, scoped to the enabled providers. A query shorter than two characters answers three empty lists rather than every row.",
      parameters: [query("q", "The text to look for. Required.")],
      responses: { "200": ok(ref("SearchResults")) },
    },
  },
  "/sla": {
    get: {
      tags: ["History"],
      summary: "Monthly uptime targets and what the month has spent of them.",
      description:
        "Roadmap 4.13. One entry per provider that has a target: the budget the target implies, minutes spent, the burn rate against elapsed time, and where the month lands at this rate. Providers with no target are absent rather than reported at 100%.",
      responses: { "200": ok(ref("SlaReport")) },
    },
  },
  "/history/compare": {
    get: {
      tags: ["History"],
      summary: "A period beside the same one a year earlier.",
      description:
        "Roadmap 6.2. Uptime, downtime and incident counts for from..to and for the matched period a year before, with the fleet delta in percentage points (null when either side measured nothing). basis=date matches calendar dates (29 February reads against the 28th); basis=weekday goes back 52 weeks so a Monday is read against a Monday. A year-old period reads from the daily rollups retention keeps (roadmap 6.1).",
      parameters: [
        query("from", "First day, YYYY-MM-DD. Required, with to."),
        query("to", "Last day, YYYY-MM-DD, inclusive."),
        query("basis", "date or weekday. Required.", { type: "string", enum: ["date", "weekday"] }),
        query("provider", "Provider id. Omitted: every enabled provider."),
      ],
      responses: { "200": ok(ref("HistoryCompare")), "400": badRequest, "404": notFound },
    },
  },
  "/history/calendar": {
    get: {
      tags: ["History"],
      summary: "A year of day cells for one provider.",
      parameters: [query("provider", "Provider id. Required.")],
      responses: {
        "200": ok(ref("HistoryCalendar")),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/history/latency": {
    get: {
      tags: ["History"],
      summary: "Response-time percentiles for one provider.",
      description:
        "Roadmap 4.14. p50 and p95 per bucket over 24h, 7d or 30d, the provider's declared slowMs (null when it has none) and a summary with the count of readings at or over it. Buckets nothing was read in are absent, not zero.",
      parameters: [
        query("provider", "Provider id. Required."),
        query("range", "24h, 7d (default) or 30d.", { type: "string", enum: ["24h", "7d", "30d"] }),
      ],
      responses: { "200": ok(ref("HistoryLatency")), "400": badRequest, "404": notFound },
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
      responses: {
        "200": ok(ref("HistoryComponents")),
        "400": badRequest,
        "404": notFound,
      },
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
      responses: { "200": ok(ref("NotificationPreview")), "400": badRequest },
    },
  },
  "/coincidence": {
    get: {
      tags: ["History"],
      summary: "Pairs of providers whose incidents overlap far more often than chance.",
      description:
        "Roadmap 2.10, over rows the poller already wrote. Not a causal claim: a shortlist of pairs worth declaring as a `dependsOn`. `providerId` is the one with fewer incidents, `together` of its `incidents` overlapped `otherId`'s, `lift` is that rate over the share of the window `otherId` was open, and `declared` is true when either side already names the other. At least 3 overlaps and a lift of 3 to be listed; best first.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": ok(ref("CoincidenceReport")), "400": badRequest },
    },
  },
  "/reliability": {
    get: {
      tags: ["History"],
      summary:
        "Per-provider MTTR, MTBF and the longest outage, plus incidents by weekday and hour.",
      description:
        "Roadmap 12.2 and 12.3, over rows the poller already wrote. `mttrMinutes` counts only incidents that have been resolved, `mtbfMinutes` needs at least two, and both are null rather than 0 when the window cannot answer. `byWeekdayHour` is [weekday][hour] in the operator's zone, Monday first, counted by when an incident started. `forecast` (roadmap 6.7) is the chance of at least one incident in the next 7 days, `1 - e^(-rate × 7)` with the rate taken over the last 90 days whatever window is asked, and null until the provider has been watched for 90 days.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": ok(ref("ReliabilityReport")), "400": badRequest },
    },
  },
  "/reliability/words": {
    get: {
      tags: ["History"],
      summary: "Recurring words and phrases in incident titles, and the components most often not operational.",
      description:
        "Roadmap 6.9. Counted once per incident, over titles of incidents that started inside the window (update bodies are not stored). `phrases` holds runs of two or three words seen in at least two incidents; `components` ranks selected components by days spent not operational.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": ok(ref("ReliabilityWords")), "400": badRequest },
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
      responses: { "200": ok({
          type: "object",
          required: ["annotations"],
          properties: { annotations: { type: "array", items: ref("Annotation") } },
        }), "400": badRequest },
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
        "201": ok(ref("Annotation"), "The stored marker."),
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
};

const str = { type: "string" };
const int = { type: "integer" };
const num = { type: "number" };
const nullable = (type: string): Json => ({ type: [type, "null"] });
const arrayOf = (items: Json): Json => ({ type: "array", items });
const object = (properties: Json, required: string[] = Object.keys(properties)): Json => ({
  type: "object",
  required,
  properties,
});

const dayUptime = object({ day: str, uptime: nullable("number") });
const dayCoverage = object({ day: str, observed: nullable("number") });
const bucket = (): Json => object({ day: str, status: ref("OverallStatus") });
const periodDay = object({ day: str, uptime: num, status: ref("OverallStatus") });
const period = object({
  from: str,
  to: str,
  fleetUptime: nullable("number"),
  providers: arrayOf(
    object({
      providerId: str,
      uptime: nullable("number"),
      measuredDays: int,
      sampleCount: int,
      downtimeMinutes: num,
      downtimeCost: nullable("number"),
      incidentCount: int,
      worstDay: { oneOf: [periodDay, { type: "null" }] },
      days: arrayOf(periodDay),
    }),
  ),
  incidents: arrayOf(ref("HistoryIncidentRow")),
});
const termCount = object({ term: str, incidents: int, providers: arrayOf(str) });

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const historySchemas: Json = {
  Annotation: object({
    id: int,
    at: { type: "string", format: "date-time" },
    label: str,
    colour: { type: "string", enum: [...ANNOTATION_COLOURS] },
    providerId: { ...nullable("string"), description: "Null for a marker about the whole fleet." },
    createdAt: { type: "string", format: "date-time" },
  }),
  HistoryIncidentRow: object(
    {
      providerId: str,
      incidentId: str,
      name: str,
      impact: str,
      status: str,
      startedAt: str,
      updatedAt: str,
      resolvedAt: nullable("string"),
      declaredAt: { type: "string", description: "When the provider published it, by its own clock." },
      firstSeenAt: { type: "string", description: "The poll that first carried it." },
    },
    ["providerId", "incidentId", "name", "impact", "status", "startedAt", "updatedAt", "resolvedAt"],
  ),
  HistoryProvider: object({
    providerId: str,
    buckets: arrayOf(bucket()),
    uptime7: num,
    uptime30: num,
    uptime90: num,
    sampleCount: int,
    incidentCount: int,
    downtimeMinutes: num,
    dailySeries: arrayOf(dayUptime),
    previousUptime: nullable("number"),
    dailyCoverage: arrayOf(dayCoverage),
    coverage: nullable("number"),
    detectionDelay: {
      oneOf: [
        object({ medianMinutes: num, worstMinutes: num, measured: int }),
        { type: "null" },
      ],
    },
  }),
  HistorySummary: object({
    aggregateUptime: num,
    dailyUptime: arrayOf(dayUptime),
    aggregateDelta: nullable("number"),
    months: arrayOf(object({ month: str, uptime: nullable("number") })),
    providers: arrayOf(ref("HistoryProvider")),
    dailyCoverage: arrayOf(dayCoverage),
    coverage: nullable("number"),
  }),
  HistoryCalendar: object({
    providerId: str,
    days: int,
    cells: arrayOf(object({ day: str, status: ref("OverallStatus"), uptime: nullable("number") })),
    uptime: num,
    measuredDays: int,
  }),
  HistoryComponents: object({
    provider: str,
    days: int,
    components: arrayOf(
      object({
        componentId: str,
        name: str,
        buckets: arrayOf(bucket()),
        uptime7: num,
        uptime30: num,
        uptime90: num,
        sampleCount: int,
      }),
    ),
  }),
  HistoryLatency: object({
    provider: str,
    range: { type: "string", enum: ["24h", "7d", "30d"] },
    slowMs: nullable("integer"),
    summary: {
      oneOf: [
        object({ p50: num, p95: num, samples: int, overSlow: nullable("integer") }),
        { type: "null" },
      ],
    },
    points: arrayOf(object({ at: str, p50: num, p95: num, samples: int })),
  }),
  HistoryCompare: object({
    basis: { type: "string", enum: ["date", "weekday"] },
    current: period,
    previous: period,
    fleetDelta: nullable("number"),
  }),
  SearchResults: object({
    query: str,
    incidents: arrayOf(ref("HistoryIncidentRow")),
    notes: arrayOf(
      object({
        id: int,
        body: str,
        createdAt: str,
        providerId: str,
        incidentId: str,
        incidentName: nullable("string"),
      }),
    ),
    annotations: arrayOf(ref("Annotation")),
  }),
  SlaReport: object({
    month: { type: "string", description: "YYYY-MM, UTC." },
    providers: arrayOf(
      object({
        providerId: str,
        month: str,
        target: num,
        uptime: nullable("number"),
        budgetMinutes: num,
        spentMinutes: num,
        remainingMinutes: num,
        burnRate: nullable("number"),
        projectedUptime: nullable("number"),
        willMiss: { type: "boolean" },
        elapsedMinutes: num,
        monthMinutes: num,
        measuredMinutes: num,
      }),
    ),
  }),
  CoincidenceReport: object({
    days: int,
    pairs: arrayOf(
      object({
        providerId: str,
        otherId: str,
        together: int,
        incidents: int,
        rate: num,
        lift: num,
        declared: { type: "boolean" },
      }),
    ),
  }),
  ReliabilityReport: object({
    days: int,
    providers: arrayOf(
      object({
        providerId: str,
        incidents: int,
        mttrMinutes: nullable("number"),
        resolved: int,
        mtbfMinutes: nullable("number"),
        longestOutageMinutes: nullable("number"),
        downtimeMinutes: num,
        downtimeCost: nullable("number"),
        previousIncidents: int,
        forecast: {
          oneOf: [
            object({ basisDays: int, incidents: int, perWeek: num, probability: num }),
            { type: "null" },
          ],
        },
      }),
    ),
    byWeekdayHour: arrayOf(arrayOf(int)),
  }),
  ReliabilityWords: object({
    days: int,
    incidents: int,
    words: arrayOf(termCount),
    phrases: arrayOf(termCount),
    components: arrayOf(
      object({ providerId: str, componentId: str, name: str, badDays: int }),
    ),
  }),
  NotificationPreview: object({
    kind: { type: "string", enum: [...PREVIEW_KINDS] },
    provider: str,
    channels: arrayOf(
      object({
        channel: str,
        enabled: { type: "boolean" },
        locale: str,
        templated: { type: "boolean" },
        text: nullable("string"),
        parts: object({ heading: str, detail: str, url: str }),
      }),
    ),
  }),
};
