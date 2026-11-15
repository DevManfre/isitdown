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
        "Roadmap 8.1. One card per probe that names a page in `crossChecks`: median and p90 admission delay, how much of the observed outage the page had an incident open for, and how many episodes it never mentioned — three axes, never one score. A card whose window holds fewer than ten counted episodes reports the count and nothing else. Every card also carries `revisions: { revised, resolved }` (roadmap 1.11): how many of the page's incidents resolved inside the window it edited afterwards, out of how many were read back — not built from episodes, so present whatever the floor says. A fleet with no probe returns an empty list.",
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
  "/export/monthly.html": {
    get: {
      tags: ["Export"],
      summary: "The same month as a self-contained page with its charts, to print or save as PDF.",
      parameters: [query("month", "YYYY-MM; defaults to the current month.")],
      responses: { "200": media("text/html", "The report, served inline.") },
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
      summary: "The same evidence as JSON.",
      parameters: [
        query("provider", "Provider id; it must have an SLA target."),
        query("month", "YYYY-MM; defaults to the current month."),
      ],
      responses: {
        "200": ok({ type: "object" }),
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
      summary: "The same report card as JSON, with the scale it was graded on.",
      parameters: [query("quarter", "YYYY-Qn; defaults to the current quarter.")],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
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
