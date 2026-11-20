import { query, json, ref, ok, notFound, badRequest, media, incidentFilters } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Downloads, trust and feeds. */
export const exportPaths: Json = {
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
      responses: {
        "200": ok({
          type: "object",
          required: ["generatedAt", "filter", "count", "truncated", "incidents"],
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            filter: {
              type: "object",
              description: "The search as it was read, echoed back.",
              required: ["provider", "state", "query", "days"],
              properties: {
                provider: { type: ["string", "null"] },
                state: { type: "string", enum: ["all", "active", "resolved"] },
                query: { type: ["string", "null"] },
                days: { type: ["integer", "null"] },
              },
            },
            count: { type: "integer" },
            truncated: { type: "boolean", description: "The 20 000 row cap was hit." },
            incidents: { type: "array", items: ref("IncidentRow") },
          },
        }),
      },
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
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/export/history.json": {
    get: {
      tags: ["Export"],
      deprecated: true,
      summary: "The same window as the charts are drawn from.",
      parameters: [
        query("provider", "One provider; omit for all."),
        query("days", "7, 30 or 90.", { type: "integer" }),
      ],
      responses: {
        "200": ok({
          type: "object",
          required: ["generatedAt", "days", "providers"],
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            days: { type: "integer", enum: [7, 30, 90] },
            providers: { type: "array", items: ref("ExportProviderHistory") },
          },
        }),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/trust": {
    get: {
      tags: ["History"],
      summary:
        "How closely each cross-checked status page tracked what a probe observed.",
      description:
        "Roadmap 8.1. One card per probe that names a page in `crossChecks`: median and p90 admission delay, how much of the observed outage the page had an incident open for, and how many episodes it never mentioned — three axes, never one score. A card whose window holds fewer than ten counted episodes reports the count and nothing else. Every card also carries `revisions: { revised, resolved }` (roadmap 1.11): how many of the page's incidents resolved inside the window it edited afterwards, out of how many were read back — not built from episodes, so present whatever the floor says. A fleet with no probe returns an empty list.",
      parameters: [
        query("days", "Window in days: 30, 90 or 365.", { type: "integer" }),
      ],
      responses: {
        "200": ok({
          type: "object",
          required: ["days", "windows", "cards"],
          properties: {
            days: { type: "integer", enum: [30, 90, 365] },
            windows: { type: "array", items: { type: "integer" }, description: "The windows on offer." },
            cards: {
              type: "array",
              items: {
                allOf: [
                  ref("TrustCard"),
                  {
                    type: "object",
                    required: ["key", "revisions"],
                    properties: {
                      key: { type: "string", description: "`<probe>-><page>` or `<probe>-><page>#<component>`." },
                      revisions: ref("TrustRevisions"),
                    },
                  },
                ],
              },
            },
          },
        }),
      },
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
      responses: {
        "200": ok({
          type: "object",
          required: ["key", "days", "episodes"],
          properties: {
            key: { type: "string" },
            days: { type: "integer", enum: [30, 90, 365] },
            episodes: { type: "array", items: ref("TrustEpisode") },
          },
        }),
        "404": notFound,
      },
    },
  },
  "/export/trust.csv": {
    get: {
      tags: ["Export"],
      deprecated: true,
      summary: "One row per trust episode, pair repeated on each.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: { "200": media("text/csv", "The episodes.") },
    },
  },
  "/export/trust.json": {
    get: {
      tags: ["Export"],
      deprecated: true,
      summary: "Trust cards with their episodes, exclusions and vantage point.",
      parameters: [query("days", "Window in days.", { type: "integer" })],
      responses: {
        "200": ok({
          type: "object",
          required: ["generatedAt", "days", "vantagePoint", "pairs"],
          properties: {
            generatedAt: { type: "string", format: "date-time" },
            days: { type: "integer" },
            vantagePoint: { type: "string", description: "A reminder that it is one probe on one network." },
            pairs: {
              type: "array",
              items: {
                type: "object",
                required: ["pair", "card", "episodes"],
                properties: {
                  pair: ref("TrustPair"),
                  card: ref("TrustCard"),
                  episodes: { type: "array", items: ref("TrustEpisode") },
                },
              },
            },
          },
        }),
      },
    },
  },
  "/export/monthly.md": {
    get: {
      tags: ["Export"],
      summary: "One calendar month written up as Markdown.",
      parameters: [query("month", "YYYY-MM; defaults to the current month.")],
      responses: { "200": media("text/markdown", "The report."), "400": badRequest },
    },
  },
  "/export/monthly.html": {
    get: {
      tags: ["Export"],
      summary: "The same month as a self-contained page with its charts, to print or save as PDF.",
      parameters: [query("month", "YYYY-MM; defaults to the current month.")],
      responses: { "200": media("text/html", "The report, served inline."), "400": badRequest },
    },
  },
  "/export/sla-evidence.md": {
    get: {
      tags: ["Export"],
      summary: "One provider's month as evidence for an SLA credit claim.",
      parameters: [
        query("provider", "Provider id; it must have an SLA target."),
        query("month", "YYYY-MM; defaults to the current month."),
      ],
      responses: {
        "200": media("text/markdown", "Target, measured uptime, downtime windows and the provider's incidents."),
        "400": badRequest,
        "404": notFound,
        "409": { description: "The provider has no SLA target.", ...json(ref("Error")) },
      },
    },
  },
  "/export/sla-evidence.json": {
    get: {
      tags: ["Export"],
      deprecated: true,
      summary: "The same evidence as JSON.",
      parameters: [
        query("provider", "Provider id; it must have an SLA target."),
        query("month", "YYYY-MM; defaults to the current month."),
      ],
      responses: {
        "200": ok({
          type: "object",
          required: [
            "providerId", "providerName", "statusPage", "month", "from", "to", "partial", "target", "uptime",
            "belowTarget", "intervalMinutes", "allowedMinutes", "downtimeMinutes", "sampleCount", "rawSampleCount",
            "windows", "incidents", "generatedAt",
          ],
          properties: {
            providerId: { type: "string" },
            providerName: { type: "string" },
            statusPage: { type: "string" },
            month: { type: "string", description: "YYYY-MM." },
            from: { type: "string" },
            to: { type: "string" },
            partial: { type: "boolean", description: "The month is still running." },
            target: { type: "number", description: "The SLA target, as a percentage." },
            uptime: { type: ["number", "null"], description: "Measured uptime; null when nothing was measured." },
            belowTarget: { type: "boolean" },
            intervalMinutes: { type: "number" },
            allowedMinutes: { type: "number", description: "Downtime the target allows over the month." },
            downtimeMinutes: { type: "number" },
            sampleCount: { type: "integer" },
            rawSampleCount: { type: "integer", description: "How many of them are still held raw." },
            windows: {
              type: "array",
              items: {
                type: "object",
                required: ["startedAt", "endedAt", "minutes", "worstStatus", "incidentIds"],
                properties: {
                  startedAt: { type: "string", format: "date-time" },
                  endedAt: { type: ["string", "null"], format: "date-time", description: "Null when still down at the last poll." },
                  minutes: { type: "number" },
                  worstStatus: { type: "string" },
                  incidentIds: { type: "array", items: { type: "string" } },
                },
              },
            },
            incidents: { type: "array", items: ref("IncidentRow") },
            generatedAt: { type: "string", format: "date-time" },
          },
        }),
        "400": badRequest,
        "404": notFound,
        "409": { description: "The provider has no SLA target.", ...json(ref("Error")) },
      },
    },
  },
  "/export/report-card.md": {
    get: {
      tags: ["Export"],
      summary: "The quarterly vendor report card: one grade per axis per provider.",
      description:
        "Roadmap 6.8. Availability, admission delay (from the trust card, needs a cross-checking probe and ten outages), MTTR and incident count, each graded A–E on the fixed scale printed in the document, never combined into one grade. A running quarter is covered up to today and flagged.",
      parameters: [query("quarter", "YYYY-Qn; defaults to the current quarter.")],
      responses: {
        "200": media("text/markdown", "One table row per provider, then the scale."),
        "400": badRequest,
      },
    },
  },
  "/export/report-card.json": {
    get: {
      tags: ["Export"],
      deprecated: true,
      summary: "The same report card as JSON, with the scale it was graded on.",
      parameters: [query("quarter", "YYYY-Qn; defaults to the current quarter.")],
      responses: {
        "200": ok({
          type: "object",
          required: ["quarter", "from", "to", "partial", "generatedAt", "scale", "providers"],
          properties: {
            quarter: { type: "string", description: "YYYY-Qn." },
            from: { type: "string" },
            to: { type: "string", description: "The quarter's last day, or today while it runs." },
            partial: { type: "boolean" },
            generatedAt: { type: "string", format: "date-time" },
            scale: {
              type: "object",
              description: "The thresholds each grade was given on, best first.",
              required: ["availability", "admission", "mttr", "incidents"],
              properties: {
                availability: { type: "array", items: { type: "number" }, description: "Uptime %, at least." },
                admission: { type: "array", items: { type: "number" }, description: "Median minutes to admission, at most." },
                mttr: { type: "array", items: { type: "number" }, description: "Mean minutes to resolution, at most." },
                incidents: { type: "array", items: { type: "number" }, description: "Incidents started, at most." },
              },
            },
            providers: {
              type: "array",
              items: {
                type: "object",
                required: ["providerId", "name", "availability", "admission", "mttr", "incidents"],
                properties: {
                  providerId: { type: "string" },
                  name: { type: "string" },
                  availability: {
                    type: "object",
                    required: ["uptime", "grade"],
                    properties: { uptime: { type: ["number", "null"] }, grade: ref("ReportCardGrade") },
                  },
                  admission: {
                    type: ["object", "null"],
                    description: "Null when no probe cross-checks this provider's page.",
                    required: ["counted", "admitted", "medianMinutes", "grade"],
                    properties: {
                      counted: { type: "integer" },
                      admitted: { type: "integer" },
                      medianMinutes: { type: ["number", "null"] },
                      grade: ref("ReportCardGrade"),
                    },
                  },
                  mttr: {
                    type: "object",
                    required: ["minutes", "resolved", "grade"],
                    properties: {
                      minutes: { type: ["number", "null"] },
                      resolved: { type: "integer" },
                      grade: ref("ReportCardGrade"),
                    },
                  },
                  incidents: {
                    type: "object",
                    required: ["count", "grade"],
                    properties: { count: { type: "integer" }, grade: ref("ReportCardGrade") },
                  },
                },
              },
            },
          },
        }),
        "400": badRequest,
      },
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
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const exportSchemas: Json = {
  ReportCardGrade: {
    type: ["string", "null"],
    enum: ["A", "B", "C", "D", "E", null],
    description: "Null when there is too little data to grade.",
  },
  ExportProviderHistory: {
    type: "object",
    required: [
      "providerId", "buckets", "uptime7", "uptime30", "uptime90", "sampleCount", "incidentCount", "downtimeMinutes",
      "dailySeries", "previousUptime", "dailyCoverage", "coverage", "detectionDelay",
    ],
    properties: {
      providerId: { type: "string" },
      buckets: {
        type: "array",
        description: "One entry per day of the window, oldest first.",
        items: {
          type: "object",
          required: ["day", "status"],
          properties: { day: { type: "string" }, status: ref("OverallStatus") },
        },
      },
      uptime7: { type: "number" },
      uptime30: { type: "number" },
      uptime90: { type: "number" },
      sampleCount: { type: "integer", description: "Zero means never measured." },
      incidentCount: { type: "integer" },
      downtimeMinutes: { type: "number" },
      dailySeries: {
        type: "array",
        items: {
          type: "object",
          required: ["day", "uptime"],
          properties: { day: { type: "string" }, uptime: { type: ["number", "null"], description: "Null on an unmeasured day." } },
        },
      },
      previousUptime: { type: ["number", "null"], description: "The window just before this one." },
      dailyCoverage: {
        type: "array",
        items: {
          type: "object",
          required: ["day", "observed"],
          properties: {
            day: { type: "string" },
            observed: { type: ["number", "null"], description: "Fraction of the day the poller ran, 0 to 1; null when unknown." },
          },
        },
      },
      coverage: { type: ["number", "null"] },
      detectionDelay: {
        type: ["object", "null"],
        required: ["medianMinutes", "worstMinutes", "measured"],
        properties: {
          medianMinutes: { type: "number" },
          worstMinutes: { type: "number" },
          measured: { type: "integer" },
        },
      },
    },
  },
  TrustPair: {
    type: "object",
    required: ["probeId", "pageId", "componentId"],
    properties: {
      probeId: { type: "string" },
      pageId: { type: "string" },
      componentId: { type: "string", description: "Empty means the whole page." },
    },
  },
  TrustRevisions: {
    type: "object",
    required: ["revised", "resolved"],
    properties: {
      revised: { type: "integer", description: "Resolved incidents the page edited afterwards." },
      resolved: { type: "integer", description: "Incidents read back." },
    },
  },
  TrustCard: {
    type: "object",
    description:
      "Below the episode floor only `pair`, `days`, `counted` and `floor` are present; above it the figures are.",
    required: ["pair", "days", "counted"],
    properties: {
      pair: ref("TrustPair"),
      days: { type: "integer" },
      counted: { type: "integer", description: "Episodes inside the window that count." },
      floor: { type: "integer", description: "Episodes needed before figures show. Present only below it." },
      excluded: {
        type: "object",
        required: ["maintenance", "fleetBlind"],
        properties: { maintenance: { type: "integer" }, fleetBlind: { type: "integer" } },
      },
      delay: {
        type: ["object", "null"],
        required: ["medianMinutes", "p90Minutes", "admitted"],
        properties: {
          medianMinutes: { type: "number" },
          p90Minutes: { type: "number" },
          admitted: { type: "integer" },
        },
      },
      coverage: {
        type: ["object", "null"],
        required: ["observedMinutes", "admittedMinutes", "percent"],
        properties: {
          observedMinutes: { type: "number" },
          admittedMinutes: { type: "number" },
          percent: { type: "number" },
        },
      },
      never: { type: "integer", description: "Outages the page never mentioned." },
      afterRecovery: { type: "integer", description: "Outages it admitted only after recovery." },
      resolutionMinutes: { type: "number", description: "The error bar on every duration." },
    },
  },
  TrustEpisode: {
    type: "object",
    required: [
      "probeDownAt", "probeUpAt", "pageAdmittedAt", "pageClearedAt", "outcome", "excluded", "delayMinutes",
      "observedMinutes", "admittedMinutes", "resolutionMinutes",
    ],
    properties: {
      probeDownAt: { type: "string", format: "date-time" },
      probeUpAt: { type: "string", format: "date-time" },
      pageAdmittedAt: { type: ["string", "null"], format: "date-time" },
      pageClearedAt: { type: ["string", "null"], format: "date-time" },
      outcome: { type: "string", enum: ["admitted", "after_recovery", "never"] },
      excluded: { type: ["string", "null"], enum: ["maintenance", "fleet_blind", null], description: "Why it is not counted." },
      delayMinutes: { type: ["number", "null"], description: "Null when never admitted." },
      observedMinutes: { type: "number" },
      admittedMinutes: { type: "number" },
      resolutionMinutes: { type: "number" },
    },
  },
};
