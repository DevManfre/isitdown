import { AUTHORITIES } from "../../core/authority.ts";
import { ref } from "./shared.ts";
import type { Json } from "./shared.ts";

/** The shapes more than one operation answers with, referenced as `#/components/schemas/<name>`. */
export const schemas: Json = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
          code: { type: "string", description: "A machine-readable reason, where a client acts on it." },
        },
      },
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
      lastCycleAt: { type: ["string", "null"] },
    },
  },
  Readiness: {
    type: "object",
    required: ["status", "providers", "failed", "lastCycleAt", "ageSeconds", "staleAfterSeconds"],
    properties: {
      status: { type: "string", enum: ["ready", "not_ready"] },
      providers: { type: "integer" },
      failed: {
        type: ["integer", "null"],
        description: "Providers that failed in the last cycle; null before the first one.",
      },
      lastCycleAt: { type: ["string", "null"] },
      ageSeconds: { type: ["number", "null"] },
      staleAfterSeconds: { type: "number" },
      reason: { type: "string", description: "Present only when not ready." },
    },
  },
  StatusPayload: {
    type: "object",
    required: ["providers", "groups", "pollIntervalMinutes", "lastPollAt", "nextPollAt", "serverNow"],
    properties: {
      providers: { type: "array", items: ref("ProviderStatus") },
      groups: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "providers", "status", "affected"],
          properties: {
            id: { type: "string" },
            providers: { type: "array", items: { type: "string" } },
            status: ref("OverallStatus"),
            affected: { type: "array", items: { type: "string" } },
          },
        },
      },
      pollIntervalMinutes: { type: "number" },
      lastPollAt: { type: ["string", "null"] },
      nextPollAt: { type: ["string", "null"] },
      serverNow: { type: "string", description: "The clock nextPollAt is stamped on." },
    },
  },
  Incident: {
    type: "object",
    required: ["id", "name", "impact", "status", "updatedAt"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      impact: { type: "string" },
      status: { type: "string" },
      updatedAt: { type: "string" },
      createdAt: { type: "string" },
    },
  },
  ComponentStatus: {
    type: "object",
    required: ["id", "name", "status"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      status: ref("OverallStatus"),
    },
  },
  MaintenanceWindow: {
    type: "object",
    required: ["id", "name", "status", "startsAt", "endsAt", "componentIds"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      status: { type: "string" },
      startsAt: { type: "string" },
      endsAt: { type: ["string", "null"] },
      componentIds: { type: "array", items: { type: "string" } },
    },
  },
  ComponentSelection: {
    type: "object",
    required: ["id", "name"],
    properties: { id: { type: "string" }, name: { type: "string" } },
  },
  ProviderStatus: {
    type: "object",
    required: [
      "id",
      "name",
      "adapter",
      "baseUrl",
      "enabled",
      "overallStatus",
      "activeIncidents",
      "components",
      "componentSelection",
      "scopeToComponents",
      "favorite",
      "fetchedAt",
      "failureCount",
      "mutedUntil",
      "runbook",
      "tags",
      "authority",
      "impact",
      "owner",
      "suspected",
      "stale",
      "uptime90",
      "maintenance",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      adapter: { type: "string" },
      baseUrl: { type: "string" },
      enabled: { type: "boolean" },
      overallStatus: ref("OverallStatus"),
      activeIncidents: { type: "array", items: ref("Incident") },
      components: { type: "array", items: ref("ComponentStatus") },
      componentSelection: { type: "array", items: ref("ComponentSelection") },
      scopeToComponents: { type: "boolean" },
      favorite: { type: "boolean" },
      fetchedAt: { type: ["string", "null"] },
      failureCount: { type: "integer" },
      mutedUntil: { type: ["string", "null"], description: "A live mute only, planned ones included." },
      runbook: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
      authority: { type: "string", enum: [...AUTHORITIES], description: "Resolved, never null." },
      impact: { type: ["string", "null"] },
      owner: { type: ["string", "null"] },
      suspected: {
        type: ["object", "null"],
        description: "Roadmap 1.3: what a probe measured while the page says operational.",
        required: ["status", "probeId", "since"],
        properties: {
          status: ref("OverallStatus"),
          probeId: { type: "string" },
          since: { type: "string" },
          note: { type: "string" },
        },
      },
      stale: {
        type: ["object", "null"],
        description: "Roadmap 1.8: the reading may be the adapter's last good one.",
        required: ["reason", "since"],
        properties: {
          reason: { type: "string", enum: ["unchanged", "shrunk"] },
          since: { type: "string" },
          longestStillMs: { type: "number" },
          components: { type: "integer" },
          expected: { type: "integer" },
        },
      },
      uptime90: { type: ["number", "null"] },
      maintenance: {
        type: "object",
        required: ["active", "upcoming"],
        properties: {
          active: { type: "array", items: ref("MaintenanceWindow") },
          upcoming: { type: "array", items: ref("MaintenanceWindow") },
        },
      },
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
      group: { type: ["string", "null"] },
      dependsOn: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "Providers this one runs on, declared by the operator (roadmap 2.9). A shared failure names the one most of its members declare.",
      },
      crossChecks: {
        type: ["string", "null"],
        description:
          "On a probe: the provider whose page it cross-checks (roadmap 1.10).",
      },
      intervalMinutes: { type: ["integer", "null"] },
      intervalSeconds: {
        type: ["integer", "null"],
        description:
          "On a probe only: a cadence in seconds, 10 to 3600, instead of intervalMinutes (roadmap 1.6).",
      },
      mutedUntil: { type: ["string", "null"] },
      options: { type: "object", additionalProperties: { type: "string" } },
      components: { type: "array", items: ref("ComponentSelection") },
      scopeToComponents: { type: "boolean" },
      favorite: {
        type: "boolean",
        description: "A star (roadmap 5.14): listed first, always on the wallboard, always in the weekly summary.",
      },
      authority: {
        type: ["string", "null"],
        enum: [...AUTHORITIES],
        description:
          "Which source is the record for this provider (roadmap 9.1). Null — the normal case — means the adapter decides: a probe is `observed`, a status page is `declared`.",
      },
      impact: {
        type: ["string", "null"],
        maxLength: 200,
        description: "What breaks when this provider does, in the operator's words (roadmap 3.7). Carried into every message.",
      },
      owner: {
        type: ["string", "null"],
        maxLength: 80,
        description: "Who answers for this provider (roadmap 3.7). Carried into every message.",
      },
      runbook: {
        type: ["string", "null"],
        maxLength: 4000,
        description:
          "What to do when it is down, in Markdown (roadmap 5.1). Shown on the provider's page; a message carries its first link, or its first line.",
      },
      tags: {
        type: ["array", "null"],
        maxItems: 20,
        items: { type: "string" },
        description: "Free labels beside the group (roadmap 5.4); a routing rule names one as `tag:<slug>`.",
      },
      muteSchedules: {
        type: ["array", "null"],
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            until: { type: "string" },
            days: {
              type: "array",
              items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
            },
            start: { type: "string" },
            end: { type: "string" },
            timeZone: { type: "string" },
          },
        },
        description:
          "Planned mutes (roadmap 5.2): `{ from, until }` for one span, or `{ days, start, end, timeZone }` for a weekly window — days `mon`…`sun`, times `HH:MM`, may wrap midnight.",
      },
      maintenanceWindows: {
        type: ["array", "null"],
        maxItems: 50,
        items: {
          type: "object",
          required: ["title", "startsAt", "endsAt"],
          properties: {
            title: { type: "string" },
            startsAt: { type: "string" },
            endsAt: { type: "string" },
          },
        },
        description:
          "Maintenance the operator declares (roadmap 5.3): `{ title, startsAt, endsAt }`. Silences and announces like a window the provider published.",
      },
    },
  },
};
