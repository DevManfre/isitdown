import { query, path, json, ref, ok, notFound, badRequest, media } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Configuration: export and import, snapshots, backups, the catalog and providers. */
export const configPaths: Json = {
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
  "/config/import/preview": {
    post: {
      tags: ["Configuration"],
      summary: "What importing the same file would do, without doing it.",
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
  "/config/snapshots": {
    get: {
      tags: ["Configuration"],
      summary: "Named configuration snapshots, newest first.",
      responses: { "200": ok({ type: "object" }) },
    },
    post: {
      tags: ["Configuration"],
      summary: "Save the configuration as it stands under a name.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 80 } } },
          },
        },
      },
      responses: { "201": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/snapshots/{id}/preview": {
    get: {
      tags: ["Configuration"],
      summary: "What restoring the snapshot would change.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/snapshots/{id}/restore": {
    post: {
      tags: ["Configuration"],
      summary: "Put the snapshot back, saving the configuration it replaces first.",
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/snapshots/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Delete a snapshot.",
      responses: { "204": { description: "Deleted." } },
    },
  },
  "/config/history": {
    get: {
      tags: ["Configuration"],
      summary: "The configuration history: every value a write moved, newest first.",
      parameters: [
        { name: "kind", in: "query", schema: { type: "string", enum: ["service", "setting", "channel", "routing", "recipients", "credential"] } },
        { name: "target", in: "query", schema: { type: "string" } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
      ],
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/history/{id}/revert": {
    post: {
      tags: ["Configuration"],
      summary: "Write a history entry's old value back.",
      responses: { "200": ok({ type: "object" }), "404": notFound, "409": { description: "The old value can no longer be written." } },
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
      summary: "The provider catalog in force, answered from memory.",
      description:
        "Roadmap 5.11 and 2.2. The list the image shipped, or — once catalog updates are on — the last signed copy downloaded in the background, when it is newer. No request leaves the server to answer this.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/catalog/proposals": {
    get: {
      tags: ["Configuration"],
      summary: "Configured providers whose catalog entry has moved.",
      description:
        "Roadmap 2.2. `{ proposals: [{ serviceId, name, from: { adapter, baseUrl }, to: { adapter, baseUrl } }] }`, empty unless a downloaded catalog is in force. Never applied by the server: accepting one is `PATCH /config/services/{id}` with `to`.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/catalog/proposals/{id}/dismiss": {
    post: {
      tags: ["Configuration"],
      summary: "Turn one catalog proposal down, for the value it offers.",
      parameters: [path("id", "Service id.")],
      responses: { "204": { description: "Dismissed." }, "404": notFound },
    },
  },
  "/config/discover": {
    post: {
      tags: ["Configuration"],
      summary: "Map a project's files onto the catalog.",
      description:
        "Roadmap 2.3. Body `{ files: [{ path, content }] }`, 1 to 50 files within the 64 kB body limit — package.json, compose files, Dockerfiles, .env, Terraform, requirements.txt, pyproject.toml, go.mod, a hosts file. Answers `{ providers: [{ entry, evidence: [{ file, found }], configured }], unmatchedHosts, files }`. Nothing is added and nothing is fetched.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/import/neighbour": {
    post: {
      tags: ["Configuration"],
      summary: "Read another monitoring tool's export into proposed providers.",
      description:
        "Roadmap 2.4. The body is an Uptime Kuma backup, a Gatus config.yaml, a Statping export or a StatusGator board's monitor list — as a text body (up to 256 kB), as `{ content }`, or as the export's own JSON. `?from=uptimekuma|gatus|statping|statusgator` names the tool; absent, it is detected. Answers `{ tool, services: [{ source, type, kind, service, notes, configured }], skipped: [{ source, type, reason, detail }] }`, `kind` being `probe`, `page` (a status page the catalog recognises) or `heartbeat`. Every `service` passes the same checks a save does. Nothing is added and nothing is fetched.",
      parameters: [query("from", "The tool that wrote the export; detected when absent.", { type: "string", enum: ["uptimekuma", "gatus", "statping", "statusgator"] })],
      requestBody: { required: true, ...media("text/plain", "The export as it stands.") },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/services": {
    patch: {
      tags: ["Configuration"],
      summary:
        "Edit several services at once (roadmap 5.5) — all or nothing.",
      description:
        "`{ ids, patch, addTags?, removeTags? }`. `patch` takes only the fleet-wide fields: `enabled`, `intervalMinutes`, `group`, `mutedUntil`, `tags` (null clears). `addTags` and `removeTags` change each provider's own tags instead of replacing them. Every id must exist and every cadence suit its adapter, or nothing is written.",
      requestBody: { required: true, ...json({ type: "object", required: ["ids"] }) },
      responses: {
        "200": ok({ type: "object" }, "{ services } — the edited services as stored."),
        "400": badRequest,
        "404": notFound,
      },
    },
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
  "/config/services/preview-read": {
    post: {
      tags: ["Configuration"],
      summary: "One read of a provider that is not saved yet, from the form's own values.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }, "ok is false, with the adapter's own error, when the page cannot be read."),
        "400": badRequest,
      },
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
};
