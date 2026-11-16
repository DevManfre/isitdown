import { query, path, json, ref, ok, notFound, badRequest, media } from "./shared.ts";
import type { Json } from "./shared.ts";

const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const nullableStr = { type: ["string", "null"] };
const anyValue = {};
const severityFloor = { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] };
const stringList = { type: "array", items: str };
const obj = (properties: Json, required: string[] = Object.keys(properties)): Json => ({ type: "object", required, properties });
const freeForm = (description: string): Json => ({ type: "object", additionalProperties: true, description });

const configPolling = obj({
  intervalMinutes: int,
  requestTimeoutSeconds: int,
  maxRetries: int,
  failureThreshold: int,
  adaptivePolling: bool,
  adaptiveIntervalMinutes: int,
  confirmSamples: int,
  correlationThreshold: int,
  correlationWindowMinutes: int,
});

const configDelivery = obj({
  quietHours: obj({ enabled: bool, start: str, end: str, timeZone: str, minSeverity: severityFloor }),
  digest: obj({ enabled: bool, windowMinutes: int, immediateFloor: severityFloor }),
  cap: obj({ enabled: bool, maxPerHour: int }),
  updateInPlace: bool,
  maintenanceNotice: obj({ enabled: bool, leadMinutes: int }),
  escalation: obj({ enabled: bool, afterMinutes: int, channel: str, minSeverity: severityFloor }),
  channelHealth: obj({ enabled: bool, afterFailures: int }),
  incidentSummary: obj({ enabled: bool }),
  coalesce: obj({ enabled: bool, windowMinutes: int }),
  knownOutage: obj({ enabled: bool }),
  report: obj({ enabled: bool, frequency: { type: "string", enum: ["weekly", "monthly"] }, channel: str }),
  onCall: obj({ enabled: bool, minSeverity: severityFloor, rotation: stringList, startsOn: str }),
  deliveryTest: obj({ enabled: bool }),
  attachChart: bool,
});

const configChannel = obj({
  id: str,
  enabled: bool,
  locale: { ...str, description: "Empty means the installation's locale." },
  template: { ...str, description: "Empty means the default message layout." },
  fields: {
    type: "array",
    description: "Credentials as variable names with an isSet flag — never values.",
    items: obj({ name: str, envVar: str, isSet: bool, optional: bool }),
  },
});

const configRoutingRule = obj({
  provider: { ...str, description: "`*`, a provider id, `group:<name>`, `tag:<slug>` or a component target." },
  classes: { type: "array", items: { type: "string", enum: ["status", "incident", "maintenance", "monitoring"] } },
  minSeverity: severityFloor,
  channels: { type: "array", items: str, description: "`[\"*\"]` is every enabled channel; `[]` mutes." },
});

const configRemoved = obj({
  id: str,
  name: str,
  adapter: str,
  baseUrl: str,
  removedAt: str,
  restoreUntil: str,
});

const normalizedStatus = obj({
  provider: str,
  overallStatus: ref("OverallStatus"),
  activeIncidents: {
    type: "array",
    items: obj(
      { id: str, name: str, impact: str, status: str, updatedAt: str, createdAt: str },
      ["id", "name", "impact", "status", "updatedAt"],
    ),
  },
  components: { type: "array", items: obj({ id: str, name: str, status: ref("OverallStatus") }) },
  maintenances: {
    type: "array",
    items: obj({
      id: str,
      name: str,
      status: str,
      startsAt: str,
      endsAt: nullableStr,
      componentIds: stringList,
    }),
  },
  fetchedAt: str,
});

/** Configuration: export and import, snapshots, backups, the catalog and providers. */
export const configPaths: Json = {
  "/config": {
    get: {
      tags: ["Configuration"],
      summary:
        "Services, polling settings, retention, delivery, channels, routing, removed providers.",
      description:
        "Channel credentials appear as variable names with an isSet flag — never values.",
      responses: {
        "200": ok(
          obj({
            services: { type: "array", items: ref("Service") },
            polling: configPolling,
            retention: obj({ days: int }),
            delivery: configDelivery,
            updateCheck: obj(
              {
                enabled: bool,
                status: { type: "string", enum: ["unknown", "current", "available", "failed"] },
                currentVersion: str,
                latestVersion: nullableStr,
                checkedAt: nullableStr,
              },
            ),
            catalogFeed: obj(
              {
                enabled: bool,
                status: { type: "string", enum: ["unknown", "current", "updated", "failed"] },
                source: { type: "string", enum: ["bundled", "remote"] },
                generatedAt: str,
                entries: int,
                checkedAt: nullableStr,
                reason: { ...str, description: "Why the last check did not take, when it did not." },
              },
              ["enabled", "status", "source", "generatedAt", "entries", "checkedAt"],
            ),
            channels: { type: "array", items: configChannel },
            routing: obj({ rules: { type: "array", items: configRoutingRule }, invalidRules: int }),
            recipients: {
              type: "array",
              items: obj({ id: str, name: str, channels: stringList }),
            },
            removed: { type: "array", items: configRemoved },
          }),
        ),
      },
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
      responses: { "200": ok(ref("ConfigImportReport")), "400": badRequest },
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
      responses: { "200": ok(ref("ConfigDiff")), "400": badRequest },
    },
  },
  "/config/snapshots": {
    get: {
      tags: ["Configuration"],
      summary: "Named configuration snapshots, newest first.",
      responses: {
        "200": ok(obj({ snapshots: { type: "array", items: ref("ConfigSnapshot") } })),
      },
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
      responses: {
        "201": ok(ref("ConfigSnapshot")),
        "400": badRequest,
        "409": { description: "A snapshot with that name already exists.", ...json(ref("Error")) },
      },
    },
  },
  "/config/snapshots/{id}/preview": {
    get: {
      tags: ["Configuration"],
      summary: "What restoring the snapshot would change.",
      responses: { "200": ok(ref("ConfigDiff")), "404": notFound },
    },
  },
  "/config/snapshots/{id}/restore": {
    post: {
      tags: ["Configuration"],
      summary: "Put the snapshot back, saving the configuration it replaces first.",
      responses: {
        "200": ok(
          obj({
            report: ref("ConfigImportReport"),
            safety: { ...ref("ConfigSnapshot"), description: "The snapshot taken of the configuration just replaced." },
          }),
        ),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/snapshots/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Delete a snapshot.",
      responses: { "204": { description: "Deleted." }, "404": notFound },
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
      responses: {
        "200": ok(obj({ entries: { type: "array", items: ref("ConfigHistoryEntry") } })),
        "400": badRequest,
      },
    },
  },
  "/config/history/{id}/revert": {
    post: {
      tags: ["Configuration"],
      summary: "Write a history entry's old value back.",
      responses: {
        "200": ok(obj({ reverted: ref("ConfigHistoryEntry") })),
        "404": notFound,
        "409": { description: "The old value can no longer be written.", ...json(ref("Error")) },
      },
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
      responses: {
        "200": ok(
          obj({
            tables: {
              type: "object",
              description: "Rows written per table.",
              additionalProperties: int,
            },
            fromSchemaVersion: int,
            schemaVersion: int,
            secretsKept: bool,
          }),
        ),
        "400": badRequest,
      },
    },
  },
  "/config/catalog": {
    get: {
      tags: ["Configuration"],
      summary: "The provider catalog in force, answered from memory.",
      description:
        "Roadmap 5.11 and 2.2. The list the image shipped, or — once catalog updates are on — the last signed copy downloaded in the background, when it is newer. No request leaves the server to answer this.",
      responses: {
        "200": ok(obj({ providers: { type: "array", items: ref("ConfigCatalogProvider") } })),
      },
    },
  },
  "/config/catalog/proposals": {
    get: {
      tags: ["Configuration"],
      summary: "Configured providers whose catalog entry has moved.",
      description:
        "Roadmap 2.2. `{ proposals: [{ serviceId, name, from: { adapter, baseUrl }, to: { adapter, baseUrl } }] }`, empty unless a downloaded catalog is in force. Never applied by the server: accepting one is `PATCH /config/services/{id}` with `to`.",
      responses: {
        "200": ok(obj({ proposals: { type: "array", items: ref("ConfigCatalogProposal") } })),
      },
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
      requestBody: {
        required: true,
        ...json(
          obj({
            files: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: obj({ path: { type: "string", minLength: 1, maxLength: 255 }, content: str }),
            },
          }),
        ),
      },
      responses: {
        "200": ok(
          obj({
            providers: {
              type: "array",
              items: obj({
                entry: ref("ConfigCatalogEntry"),
                evidence: { type: "array", items: obj({ file: str, found: str }) },
                configured: bool,
              }),
            },
            unmatchedHosts: stringList,
            files: {
              type: "array",
              items: obj({
                file: str,
                kind: {
                  type: "string",
                  enum: ["npm", "compose", "dockerfile", "env", "terraform", "pypi", "go", "hosts", "text"],
                },
                named: int,
              }),
            },
          }),
        ),
        "400": badRequest,
      },
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
      responses: {
        "200": ok(
          obj({
            tool: { type: "string", enum: ["uptimekuma", "gatus", "statping", "statusgator"] },
            services: {
              type: "array",
              items: obj({
                source: str,
                type: str,
                kind: { type: "string", enum: ["probe", "page", "heartbeat"] },
                service: freeForm("A service definition, as `POST /config/services` would take it."),
                notes: {
                  type: "array",
                  items: obj(
                    {
                      code: {
                        type: "string",
                        enum: [
                          "credentials-dropped",
                          "conditions-dropped",
                          "body-pattern-dropped",
                          "slow-is-degraded",
                          "cadence-raised",
                          "cadence-lowered",
                        ],
                      },
                      detail: str,
                    },
                    ["code"],
                  ),
                },
                configured: bool,
              }),
            },
            skipped: {
              type: "array",
              items: obj(
                {
                  source: str,
                  type: str,
                  reason: {
                    type: "string",
                    enum: [
                      "unsupported-type",
                      "unsupported-method",
                      "page-not-in-catalog",
                      "no-interval",
                      "duplicate",
                      "invalid",
                    ],
                  },
                  detail: str,
                },
                ["source", "type", "reason"],
              ),
            },
          }),
        ),
        "400": badRequest,
      },
    },
  },
  "/config/services": {
    patch: {
      tags: ["Configuration"],
      summary:
        "Edit several services at once (roadmap 5.5) — all or nothing.",
      description:
        "`{ ids, patch, addTags?, removeTags? }`. `patch` takes only the fleet-wide fields: `enabled`, `intervalMinutes`, `group`, `mutedUntil`, `tags` (null clears). `addTags` and `removeTags` change each provider's own tags instead of replacing them. Every id must exist and every cadence suit its adapter, or nothing is written.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["ids"],
          properties: {
            ids: { type: "array", items: str, minItems: 1, maxItems: 500 },
            patch: {
              type: "object",
              properties: {
                enabled: bool,
                intervalMinutes: { type: ["integer", "null"] },
                group: nullableStr,
                mutedUntil: nullableStr,
                tags: { type: ["array", "null"], items: str },
              },
            },
            addTags: stringList,
            removeTags: stringList,
          },
        }),
      },
      responses: {
        "200": ok(
          obj({ services: { type: "array", items: ref("Service") } }),
          "{ services } — the edited services as stored.",
        ),
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
          obj({
            adapter: nullableStr,
            baseUrl: nullableStr,
            probes: {
              type: "array",
              items: obj({
                adapter: str,
                url: str,
                outcome: { type: "string", enum: ["match", "other-shape", "unreachable"] },
              }),
            },
          }),
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
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["adapter", "baseUrl"],
          properties: { adapter: str, baseUrl: str },
        }),
      },
      responses: {
        "200": ok(
          obj({
            supported: bool,
            components: {
              type: "array",
              items: obj({
                id: str,
                name: str,
                group: nullableStr,
                showcase: bool,
                status: ref("OverallStatus"),
              }),
            },
          }),
          "supported is false, with no components, when the adapter cannot list them.",
        ),
        "400": badRequest,
        "502": { description: "The provider could not be read.", ...json(ref("Error")) },
      },
    },
  },
  "/config/services/preview-read": {
    post: {
      tags: ["Configuration"],
      summary: "One read of a provider that is not saved yet, from the form's own values.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["adapter", "baseUrl"],
          properties: {
            adapter: str,
            baseUrl: str,
            options: { type: "object", additionalProperties: str },
            components: { type: "array", items: { type: "object", additionalProperties: true } },
            scopeToComponents: bool,
          },
        }),
      },
      responses: {
        "200": ok(
          obj({ ok: bool, durationMs: int, status: normalizedStatus, error: str }, ["ok"]),
          "ok is false, with the adapter's own error, when the page cannot be read.",
        ),
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
        "200": ok(
          obj({ removed: str, removedAt: str, restoreUntil: str }),
          "{ removed, removedAt, restoreUntil }",
        ),
        "404": notFound,
      },
    },
  },
  "/config/services/{id}/impact": {
    get: {
      tags: ["Configuration"],
      summary: "What a permanent removal would take with it.",
      parameters: [path("id", "Service id.")],
      responses: {
        "200": ok(
          obj({
            samples: int,
            componentSamples: int,
            incidents: int,
            maintenances: int,
            routingRules: int,
            historyDays: int,
          }),
        ),
        "404": notFound,
      },
    },
  },
  "/config/services/{id}/restore": {
    post: {
      tags: ["Configuration"],
      summary:
        "Undo a removal inside its window; the gap in history is backfilled.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok(ref("Service"), "The restored service."), "404": notFound },
    },
  },
  "/config/services/{id}/permanently": {
    delete: {
      tags: ["Configuration"],
      summary:
        "The destructive half: cascades to samples, incidents, maintenances, state and rules.",
      parameters: [path("id", "Service id.")],
      responses: { "200": ok(obj({ purged: str })), "404": notFound },
    },
  },
  "/config/services/{id}/test": {
    post: {
      tags: ["Configuration"],
      summary: "One live fetch against that provider. Records nothing.",
      parameters: [path("id", "Service id.")],
      responses: {
        "200": ok(
          obj({ ok: bool, overallStatus: ref("OverallStatus"), error: str }, ["ok"]),
          "A failed read is 200 with ok: false.",
        ),
        "404": notFound,
      },
    },
  },
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const configSchemas: Json = {
  ConfigChange: obj({ path: str, from: anyValue, to: anyValue }, ["path"]),
  ConfigDiff: obj({
    services: obj({
      added: stringList,
      removed: stringList,
      changed: { type: "array", items: obj({ id: str, changes: { type: "array", items: ref("ConfigChange") } }) },
    }),
    settings: { type: "array", items: ref("ConfigChange") },
    channels: { type: "array", items: obj({ id: str, changes: { type: "array", items: ref("ConfigChange") } }) },
    routing: {
      type: ["object", "null"],
      description: "Null when the file leaves the rules alone or they are identical.",
      required: ["from", "to"],
      properties: { from: int, to: int },
    },
    recipients: {
      type: ["object", "null"],
      required: ["from", "to"],
      properties: { from: int, to: int },
    },
    empty: { ...bool, description: "True when importing would change nothing." },
  }),
  ConfigImportReport: obj({
    added: stringList,
    updated: stringList,
    removed: stringList,
    channels: stringList,
    routingRules: int,
    settings: stringList,
  }),
  ConfigSnapshot: obj({
    id: int,
    name: str,
    createdAt: str,
    services: { ...int, description: "Providers the snapshot holds." },
  }),
  ConfigHistoryEntry: obj({
    id: int,
    at: str,
    actor: str,
    kind: { type: "string", enum: ["service", "setting", "channel", "routing", "recipients", "credential"] },
    target: str,
    field: { ...str, description: "`*` for a provider added or removed as a whole." },
    before: { description: "The value before the write; any JSON." },
    after: { description: "The value after the write; any JSON." },
    method: str,
    route: str,
    revertible: bool,
  }, ["id", "at", "actor", "kind", "target", "field", "method", "route", "revertible"]),
  ConfigCatalogEntry: obj({ id: str, name: str, adapter: str, baseUrl: str }),
  ConfigCatalogProvider: obj({ id: str, name: str, adapter: str, baseUrl: str, configured: bool }),
  ConfigCatalogProposal: obj({
    serviceId: str,
    name: str,
    from: obj({ adapter: str, baseUrl: str }),
    to: obj({ adapter: str, baseUrl: str }),
  }),
};
