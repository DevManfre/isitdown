import { query, path, json, ok, ref, notFound, badRequest, media, incidentFilters, paging } from "./shared.ts";
import type { Json } from "./shared.ts";
import { STATUS_CHANGE_KINDS } from "../../core/types.ts";

/** Incidents, maintenances and the notification history. */
export const incidentsPaths: Json = {
  "/incidents": {
    get: {
      tags: ["Incidents"],
      summary: "One page of the incident list, with the open ones beside it.",
      parameters: [...incidentFilters, ...paging],
      responses: {
        "200": ok({
          type: "object",
          required: ["active", "page", "counts"],
          properties: {
            active: {
              type: "array",
              description: "Every open incident of the enabled providers, outside the search and the paging.",
              items: ref("IncidentWithCost"),
            },
            page: {
              type: "object",
              required: ["items", "page", "pageSize", "total"],
              properties: {
                items: { type: "array", items: ref("IncidentWithCost") },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer", description: "Rows matching the filter and the selected state." },
              },
            },
            counts: {
              type: "object",
              description: "Matches of the search per state, whatever state is selected.",
              required: ["all", "active", "resolved"],
              properties: {
                all: { type: "integer" },
                active: { type: "integer" },
                resolved: { type: "integer" },
              },
            },
          },
        }),
      },
    },
  },
  "/incidents/timeline": {
    get: {
      tags: ["Incidents"],
      summary: "Every incident running at any point of a window, for the Gantt.",
      description:
        "Roadmap 4.12. Not paged: one row per incident with just what a bar needs, for the enabled providers, capped at 5000. An incident that began before the window and was still open in it is included.",
      parameters: [query("days", "7, 30 (default) or 90.", { type: "integer", enum: [7, 30, 90] })],
      responses: {
        "200": ok({
          type: "object",
          required: ["days", "incidents"],
          properties: {
            days: { type: "integer", enum: [7, 30, 90] },
            incidents: {
              type: "array",
              items: {
                type: "object",
                required: ["providerId", "incidentId", "name", "impact", "startedAt", "resolvedAt"],
                properties: {
                  providerId: { type: "string" },
                  incidentId: { type: "string" },
                  name: { type: "string" },
                  impact: { type: "string" },
                  startedAt: { type: "string", format: "date-time" },
                  resolvedAt: { type: ["string", "null"], format: "date-time" },
                },
              },
            },
          },
        }),
        "400": badRequest,
      },
    },
  },
  "/incidents/{providerId}/{incidentId}": {
    get: {
      tags: ["Incidents"],
      summary:
        "One incident: the timeline, what was sent, the last polls, the operator's notes, any edit the provider made to it after resolving it, and whether it is followed.",
      parameters: [
        path("providerId", "Provider id."),
        path("incidentId", "The provider's own incident id."),
      ],
      responses: {
        "200": ok({
          type: "object",
          required: ["incident", "timeline", "actionLog", "polls", "otherActiveIncidents", "notes", "revisions", "followed"],
          properties: {
            incident: ref("IncidentWithCost"),
            timeline: {
              type: "array",
              description: "What IsItDown observed, oldest first.",
              items: {
                type: "object",
                required: ["at", "label"],
                properties: {
                  at: { type: "string", format: "date-time" },
                  label: { type: "string", enum: ["opened", "observed", "resolved"] },
                  status: { type: "string", description: "Absent on `resolved`." },
                },
              },
            },
            actionLog: {
              type: "array",
              description: "What was sent about this incident, from its start until a moment after its end.",
              items: ref("SentNotification"),
            },
            polls: {
              type: "array",
              description: "The provider's most recent polls (up to 500), newest first.",
              items: {
                type: "object",
                required: ["observedAt", "overallStatus", "ok"],
                properties: {
                  observedAt: { type: "string", format: "date-time" },
                  overallStatus: ref("OverallStatus"),
                  ok: { type: "boolean" },
                },
              },
            },
            otherActiveIncidents: {
              type: "array",
              description: "The provider's other open incidents.",
              items: ref("IncidentRow"),
            },
            notes: { type: "array", items: ref("IncidentNote") },
            revisions: {
              type: "array",
              description: "Edits the provider made after resolving the incident.",
              items: {
                type: "object",
                required: ["field", "before", "after", "observedAt"],
                properties: {
                  field: { type: "string", enum: ["impact", "started_at", "resolved_at"] },
                  before: { type: "string" },
                  after: { type: "string" },
                  observedAt: { type: "string", format: "date-time", description: "When the edit was noticed." },
                },
              },
            },
            followed: { type: "boolean" },
          },
        }),
        "404": notFound,
      },
    },
  },
  "/incidents/{providerId}/{incidentId}/summary": {
    post: {
      tags: ["Incidents"],
      summary: "A plain-language summary of the provider's updates, written by the operator's chosen model.",
      description:
        "Roadmap 6.10. Off by default: 409 until Settings → AI implementation names a provider. The provider's updates are read live from its page (Statuspage adapters) and never stored; nor is the summary. `locale` picks the language it is written in. 422 when the provider posted no updates, 502 when its page or the model could not be reached. The error carries a `code`: `not-configured`, `no-key`, `no-cli`, `refused`, `failed`, `updates` or `no-updates`.",
      parameters: [path("providerId", "Provider id."), path("incidentId", "The provider's own incident id.")],
      requestBody: {
        required: false,
        ...json({ type: "object", properties: { locale: { type: "string", minLength: 2, maxLength: 35 } } }),
      },
      responses: {
        "200": ok(
          {
            type: "object",
            required: ["summary", "model", "updates", "generatedAt"],
            properties: {
              summary: { type: "string" },
              model: { type: "string", description: "Which model wrote it." },
              updates: { type: "integer", description: "How many provider updates it was written from." },
              generatedAt: { type: "string", format: "date-time" },
            },
          },
          "`{ summary, model, updates, generatedAt }`.",
        ),
        "400": badRequest,
        "404": notFound,
        "409": { description: "AI is off, or the key or CLI it needs is missing.", ...json(ref("IncidentCodedError")) },
        "422": { description: "The provider posted no updates.", ...json(ref("IncidentCodedError")) },
        "502": {
          description: "The provider's page or the model could not be reached.",
          ...json(ref("IncidentCodedError")),
        },
      },
    },
  },
  "/incidents/{providerId}/{incidentId}/postmortem.md": {
    get: {
      tags: ["Incidents"],
      summary: "One incident written up as a Markdown postmortem.",
      description:
        "Roadmap 6.4. Duration and estimated cost, one timeline merging what IsItDown observed, the provider's later edits, what was sent to which channel, the operator's notes and the markers of the period, and the providers down at the same time with a Mermaid chart. Works on an open incident too, flagged as such inside the document.",
      parameters: [
        path("providerId", "Provider id."),
        path("incidentId", "The provider's own incident id."),
      ],
      responses: { "200": media("text/markdown", "The postmortem."), "404": notFound },
    },
  },
  "/incidents/{providerId}/{incidentId}/follow": {
    put: {
      tags: ["Incidents"],
      summary: "Follow an open incident: every update reaches every enabled channel until it resolves.",
      description:
        "Roadmap 3.6. Bypasses the routing rules for this one incident, not quiet hours. Ends by itself when the incident resolves. A resolved incident is a 409. Answers `{ followed: true }`.",
      parameters: [path("providerId", "Provider id."), path("incidentId", "The provider's own incident id.")],
      responses: {
        "200": ok(ref("IncidentFollowed")),
        "404": notFound,
        "409": { description: "The incident has already resolved.", ...json(ref("Error")) },
      },
    },
    delete: {
      tags: ["Incidents"],
      summary: "Stop following an incident. Idempotent.",
      parameters: [path("providerId", "Provider id."), path("incidentId", "The provider's own incident id.")],
      responses: { "200": ok(ref("IncidentFollowed")) },
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
        "201": ok(ref("IncidentNote"), "The stored note."),
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
      responses: {
        "204": { description: "Removed." },
        "400": badRequest,
        "404": notFound,
      },
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
      responses: {
        "200": ok({
          type: "object",
          required: ["maintenances"],
          properties: {
            maintenances: {
              type: "array",
              items: {
                type: "object",
                required: ["providerId", "id", "name", "status", "startsAt", "endsAt", "componentIds", "firstSeenAt", "lastSeenAt"],
                properties: {
                  providerId: { type: "string" },
                  id: { type: "string", description: "The provider's own window id." },
                  name: { type: "string", description: "Empty when the provider omits a title." },
                  status: { type: "string", description: "The provider's own lifecycle word, e.g. `in_progress`." },
                  startsAt: { type: "string", format: "date-time" },
                  endsAt: { type: ["string", "null"], format: "date-time", description: "Null when no end is declared." },
                  componentIds: {
                    type: "array",
                    description: "Empty means page-wide.",
                    items: { type: "string" },
                  },
                  firstSeenAt: { type: "string", format: "date-time" },
                  lastSeenAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        }),
      },
    },
  },
  "/notifications": {
    get: {
      tags: ["Notifications"],
      summary: "What was actually sent, newest first.",
      parameters: [
        query("limit", "Capped at 200.", { type: "integer", maximum: 200 }),
      ],
      responses: {
        "200": ok({
          type: "object",
          required: ["notifications"],
          properties: { notifications: { type: "array", items: ref("SentNotification") } },
        }),
      },
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
      responses: {
        "200": ok({
          type: "object",
          required: ["page", "counts"],
          properties: {
            page: {
              type: "object",
              required: ["items", "page", "pageSize", "total"],
              properties: {
                items: { type: "array", items: ref("SentNotification") },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer", description: "Rows matching the channel and the selected state." },
              },
            },
            counts: {
              type: "object",
              description: "Matches of the channel filter per outcome, whatever state is selected.",
              required: ["all", "sent", "failed"],
              properties: {
                all: { type: "integer" },
                sent: { type: "integer" },
                failed: { type: "integer" },
              },
            },
          },
        }),
      },
    },
  },
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const incidentsSchemas: Json = {
  IncidentRow: {
    type: "object",
    required: ["providerId", "incidentId", "name", "impact", "status", "startedAt", "updatedAt", "resolvedAt"],
    properties: {
      providerId: { type: "string" },
      incidentId: { type: "string", description: "The provider's own incident id." },
      name: { type: "string" },
      impact: { type: "string" },
      status: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      resolvedAt: { type: ["string", "null"], format: "date-time", description: "Null while open." },
      declaredAt: {
        type: "string",
        format: "date-time",
        description: "When the provider published it, by its own clock. Absent when its page gives no such stamp.",
      },
      firstSeenAt: {
        type: "string",
        format: "date-time",
        description: "The poll that first carried it. Absent for one already open on the first reading.",
      },
    },
  },
  IncidentWithCost: {
    type: "object",
    required: ["providerId", "incidentId", "name", "impact", "status", "startedAt", "updatedAt", "resolvedAt", "cost"],
    properties: {
      providerId: { type: "string" },
      incidentId: { type: "string", description: "The provider's own incident id." },
      name: { type: "string" },
      impact: { type: "string" },
      status: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      resolvedAt: { type: ["string", "null"], format: "date-time", description: "Null while open." },
      declaredAt: {
        type: "string",
        format: "date-time",
        description: "When the provider published it, by its own clock. Absent when its page gives no such stamp.",
      },
      firstSeenAt: {
        type: "string",
        format: "date-time",
        description: "The poll that first carried it. Absent for one already open on the first reading.",
      },
      cost: {
        type: ["number", "null"],
        description: "Estimated cost of the downtime; null when no hourly rate is declared for the provider.",
      },
    },
  },
  SentNotification: {
    type: "object",
    required: ["providerId", "channel", "kind", "text", "sentAt", "ok", "attempts"],
    properties: {
      id: { type: "integer" },
      providerId: { type: "string" },
      channel: { type: "string", description: "Channel id." },
      kind: { type: "string", enum: [...STATUS_CHANGE_KINDS] },
      text: { type: "string", description: "The rendered message." },
      sentAt: { type: "string", format: "date-time" },
      ok: { type: "boolean" },
      error: { type: "string", description: "Why a send failed." },
      attempts: { type: "integer", description: "Tries spent before this outcome." },
    },
  },
  IncidentNote: {
    type: "object",
    required: ["id", "body", "createdAt"],
    properties: {
      id: { type: "integer" },
      body: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  IncidentFollowed: {
    type: "object",
    required: ["followed"],
    properties: { followed: { type: "boolean" } },
  },
  IncidentCodedError: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["message", "code"],
        properties: {
          message: { type: "string" },
          code: {
            type: "string",
            enum: ["not-configured", "no-key", "no-cli", "refused", "failed", "updates", "no-updates"],
          },
        },
      },
    },
  },
};
