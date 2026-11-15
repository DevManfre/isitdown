import { AUTHORITIES } from "../../core/authority.ts";
import { ref } from "./shared.ts";
import type { Json } from "./shared.ts";

/** The shapes more than one operation answers with, referenced as `#/components/schemas/<name>`. */
export const schemas: Json = {
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
      dependsOn: {
        type: "array",
        items: { type: "string" },
        nullable: true,
        description:
          "Providers this one runs on, declared by the operator (roadmap 2.9). A shared failure names the one most of its members declare.",
      },
      crossChecks: {
        type: "string",
        nullable: true,
        description:
          "On a probe: the provider whose page it cross-checks (roadmap 1.10).",
      },
      intervalMinutes: { type: "integer", nullable: true },
      intervalSeconds: {
        type: "integer",
        nullable: true,
        description:
          "On a probe only: a cadence in seconds, 10 to 3600, instead of intervalMinutes (roadmap 1.6).",
      },
      mutedUntil: { type: "string", nullable: true },
      options: { type: "object", additionalProperties: { type: "string" } },
      components: { type: "array", items: { type: "object" } },
      scopeToComponents: { type: "boolean" },
      favorite: {
        type: "boolean",
        description: "A star (roadmap 5.14): listed first, always on the wallboard, always in the weekly summary.",
      },
      authority: {
        type: "string",
        enum: [...AUTHORITIES],
        nullable: true,
        description:
          "Which source is the record for this provider (roadmap 9.1). Null — the normal case — means the adapter decides: a probe is `observed`, a status page is `declared`.",
      },
      impact: {
        type: "string",
        maxLength: 200,
        nullable: true,
        description: "What breaks when this provider does, in the operator's words (roadmap 3.7). Carried into every message.",
      },
      owner: {
        type: "string",
        maxLength: 80,
        nullable: true,
        description: "Who answers for this provider (roadmap 3.7). Carried into every message.",
      },
      runbook: {
        type: "string",
        maxLength: 4000,
        nullable: true,
        description:
          "What to do when it is down, in Markdown (roadmap 5.1). Shown on the provider's page; a message carries its first link, or its first line.",
      },
      tags: {
        type: "array",
        maxItems: 20,
        nullable: true,
        items: { type: "string" },
        description: "Free labels beside the group (roadmap 5.4); a routing rule names one as `tag:<slug>`.",
      },
      muteSchedules: {
        type: "array",
        maxItems: 20,
        nullable: true,
        items: { type: "object" },
        description:
          "Planned mutes (roadmap 5.2): `{ from, until }` for one span, or `{ days, start, end, timeZone }` for a weekly window — days `mon`…`sun`, times `HH:MM`, may wrap midnight.",
      },
      maintenanceWindows: {
        type: "array",
        maxItems: 50,
        nullable: true,
        items: { type: "object" },
        description:
          "Maintenance the operator declares (roadmap 5.3): `{ title, startsAt, endsAt }`. Silences and announces like a window the provider published.",
      },
    },
  },
};
