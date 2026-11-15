import { query, path, json, ok, notFound, badRequest, media, incidentFilters, paging } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Incidents, maintenances and the notification history. */
export const incidentsPaths: Json = {
  "/incidents": {
    get: {
      tags: ["Incidents"],
      summary: "One page of the incident list, with the open ones beside it.",
      parameters: [...incidentFilters, ...paging],
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/incidents/timeline": {
    get: {
      tags: ["Incidents"],
      summary: "Every incident running at any point of a window, for the Gantt.",
      description:
        "Roadmap 4.12. Not paged: one row per incident with just what a bar needs, for the enabled providers, capped at 5000. An incident that began before the window and was still open in it is included.",
      parameters: [query("days", "7, 30 (default) or 90.", { type: "integer", enum: [7, 30, 90] })],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
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
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/incidents/{providerId}/{incidentId}/summary": {
    post: {
      tags: ["Incidents"],
      summary: "A plain-language summary of the provider's updates, written by the operator's chosen model.",
      description:
        "Roadmap 6.10. Off by default: 409 until Settings → AI implementation names a provider. The provider's updates are read live from its page (Statuspage adapters) and never stored; nor is the summary. `locale` picks the language it is written in. 422 when the provider posted no updates, 502 when its page or the model could not be reached. The error carries a `code`: `not-configured`, `no-key`, `no-cli`, `refused`, `failed`, `updates` or `no-updates`.",
      parameters: [path("providerId", "Provider id."), path("incidentId", "The provider's own incident id.")],
      requestBody: { required: false, ...json({ type: "object", properties: { locale: { type: "string" } } }) },
      responses: {
        "200": ok({ type: "object" }, "`{ summary, model, updates, generatedAt }`."),
        "404": notFound,
        "409": { description: "AI is off, or the key or CLI it needs is missing.", ...json({ type: "object" }) },
        "422": { description: "The provider posted no updates.", ...json({ type: "object" }) },
        "502": { description: "The provider's page or the model could not be reached.", ...json({ type: "object" }) },
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
        "200": ok({ type: "object" }),
        "404": notFound,
        "409": { description: "The incident has already resolved." },
      },
    },
    delete: {
      tags: ["Incidents"],
      summary: "Stop following an incident. Idempotent.",
      parameters: [path("providerId", "Provider id."), path("incidentId", "The provider's own incident id.")],
      responses: { "200": ok({ type: "object" }) },
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
};
