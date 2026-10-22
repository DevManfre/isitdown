import { STATUS_CHANGE_KINDS, type NotificationPayload, type StatusChange, type StatusChangeKind } from "../../../src/core/types.ts";

/**
 * The fixed transitions the notifier contract suite (roadmap 3.8) sends through
 * every channel. Fixed on purpose: the golden files record the exact bytes each
 * channel puts on the wire for these, so a timestamp or an id that moved between
 * runs would read as a change in the channel.
 */

export const AT = "2026-08-19T14:32:07.000Z";

export const service = { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" };

export const INCIDENT_TITLE = "API requests failing";

const incident = {
  id: "inc-1",
  name: INCIDENT_TITLE,
  impact: "major",
  status: "investigating",
  updatedAt: AT,
};

const maintenance = {
  id: "mnt-1",
  name: "Database upgrade",
  status: "scheduled",
  startsAt: "2026-08-19T16:00:00.000Z",
  endsAt: "2026-08-19T16:30:00.000Z",
  componentIds: [],
};

/** One valid change of every kind the diff engine emits, for the "never throws" sweep. */
const BY_KIND: Record<StatusChangeKind, Omit<StatusChange, "kind" | "providerId" | "at">> = {
  status_change: { previousStatus: "operational", currentStatus: "degraded" },
  component_status_change: {
    previousStatus: "operational",
    currentStatus: "partial_outage",
    component: { id: "cmp-1", name: "Actions" },
  },
  incident_opened: { previousStatus: "operational", currentStatus: "major_outage", incident },
  incident_updated: {
    currentStatus: "major_outage",
    incident: { ...incident, status: "identified" },
  },
  incident_resolved: {
    previousStatus: "major_outage",
    currentStatus: "operational",
    incident: { ...incident, status: "resolved" },
  },
  maintenance_started: { currentStatus: "operational", maintenance: { ...maintenance, status: "in_progress" } },
  maintenance_ended: { currentStatus: "operational", maintenance: { ...maintenance, status: "completed" }, openIncidents: 0 },
  maintenance_upcoming: { currentStatus: "operational", maintenance, startsInMinutes: 90 },
  monitoring_degraded: { currentStatus: "unknown", failureCount: 5 },
  correlated_outage: {
    currentStatus: "major_outage",
    correlated: { providerIds: ["github", "vercel", "netlify"], windowMinutes: 10, cause: "cloudflare" },
  },
  correlated_resolved: {
    currentStatus: "operational",
    correlated: {
      providerIds: ["github", "vercel", "netlify"],
      windowMinutes: 10,
      durationMinutes: 47,
      cause: "cloudflare",
    },
  },
  periodic_report: {
    currentStatus: "unknown",
    report: {
      frequency: "weekly",
      from: "2026-08-10",
      to: "2026-08-16",
      fleetUptime: 99.46,
      incidentCount: 4,
      worst: [{ providerId: "vercel", uptime: 97.1 }],
      sla: [{ providerId: "github", target: 99.9, spentMinutes: 21.6, budgetMinutes: 43.2 }],
    },
  },
  silent_outage: { currentStatus: "major_outage", crossCheck: { probeId: "github-api", note: "HTTP 503" } },
  sla_burn: {
    currentStatus: "degraded",
    sla: {
      month: "2026-08",
      target: 99.9,
      uptime: 99.82,
      budgetMinutes: 43.2,
      spentMinutes: 51,
      projectedUptime: 99.71,
    },
  },
  slow_status_page: { currentStatus: "operational", latency: { latencyMs: 4200, medianMs: 210, thresholdMs: 2000 } },
  channel_failing: {
    currentStatus: "operational",
    channel: { id: "discord", failures: 3, since: AT, error: "HTTP 404" },
  },
};

export function payloadFor(kind: StatusChangeKind, extra: Partial<StatusChange> = {}): NotificationPayload {
  return {
    change: { kind, providerId: service.id, at: AT, ...BY_KIND[kind], ...extra },
    service,
    locale: "en",
  };
}

export const ALL_KINDS = STATUS_CHANGE_KINDS;

export const opened = payloadFor("incident_opened");
export const resolved = payloadFor("incident_resolved");
export const anotherIncident = payloadFor("incident_opened", {
  incident: { ...incident, id: "inc-2", name: "Webhooks delayed" },
});

/**
 * A digest far past any channel's ceiling: two hundred changes, each a line.
 * Its rendering runs to tens of kilobytes, which is what every channel's limit
 * is checked against.
 */
export const flood: NotificationPayload = {
  ...opened,
  digest: {
    windowMinutes: 15,
    items: Array.from({ length: 200 }, (_, index) =>
      payloadFor("incident_opened", {
        incident: { ...incident, id: `inc-${index}`, name: `${INCIDENT_TITLE} in region ${index} — ünïcödé 🔥` },
      }),
    ),
  },
};

/** The transitions recorded in each channel's golden file, by name. */
export const GOLDEN_PAYLOADS: Record<string, NotificationPayload> = {
  "incident-opened": opened,
  "incident-resolved": resolved,
  "status-degraded": payloadFor("status_change"),
  "maintenance-upcoming": payloadFor("maintenance_upcoming"),
};
