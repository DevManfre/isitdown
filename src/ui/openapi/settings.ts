import { query, path, json, ref, ok, notFound, badRequest } from "./shared.ts";
import type { Json } from "./shared.ts";
import { TEMPLATE_MAX_LENGTH } from "../../notifiers/template.ts";

/** Configuration: settings, AI, operator series, storage, routing, channels and push. */
export const settingsPaths: Json = {
  "/config/settings": {
    patch: {
      tags: ["Configuration"],
      summary: "Polling settings, retention and the delivery policy.",
      description: "The delivery patch is partial at every level.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          properties: {
            intervalMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            requestTimeoutSeconds: { type: "integer", minimum: 1, maximum: 120 },
            maxRetries: { type: "integer", minimum: 1, maximum: 10 },
            failureThreshold: { type: "integer", minimum: 1, maximum: 100 },
            adaptivePolling: { type: "boolean" },
            adaptiveIntervalMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            confirmSamples: { type: "integer", minimum: 1, maximum: 10 },
            correlationThreshold: { type: "integer", minimum: 0, maximum: 100 },
            correlationWindowMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            retentionDays: { type: "integer", minimum: 7, maximum: 3650 },
            delivery: {
              type: "object",
              properties: {
                quietHours: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                    end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
                    timeZone: { type: "string", maxLength: 64 },
                    minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                  },
                },
                digest: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    windowMinutes: { type: "integer", minimum: 1, maximum: 1440 },
                    immediateFloor: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                  },
                },
                cap: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    maxPerHour: { type: "integer", minimum: 1, maximum: 1000 },
                  },
                },
                updateInPlace: { type: "boolean" },
                maintenanceNotice: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    leadMinutes: { type: "integer", minimum: 1, maximum: 10080 },
                  },
                },
                escalation: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    afterMinutes: { type: "integer", minimum: 1, maximum: 1440 },
                    channel: { type: "string", maxLength: 64 },
                    minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                  },
                },
                channelHealth: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    afterFailures: { type: "integer", minimum: 2, maximum: 100 },
                  },
                },
                incidentSummary: { type: "object", properties: { enabled: { type: "boolean" } } },
                coalesce: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    windowMinutes: { type: "integer", minimum: 1, maximum: 60 },
                  },
                },
                knownOutage: { type: "object", properties: { enabled: { type: "boolean" } } },
                report: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    frequency: { type: "string", enum: ["weekly", "monthly"] },
                    channel: { type: "string", maxLength: 64 },
                  },
                },
                onCall: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                    rotation: {
                      type: "array",
                      maxItems: 32,
                      items: { type: "string", minLength: 1, maxLength: 64 },
                    },
                    startsOn: {
                      type: "string",
                      pattern: "^(\\d{4}-\\d{2}-\\d{2})?$",
                      description: "YYYY-MM-DD, or empty.",
                    },
                  },
                },
                deliveryTest: { type: "object", properties: { enabled: { type: "boolean" } } },
                attachChart: { type: "boolean" },
              },
              description: "Every field optional, at every level: send only what changes.",
            },
            updateCheckEnabled: { type: "boolean" },
            catalogFeedEnabled: { type: "boolean" },
          },
        }),
      },
      responses: { "200": ok(ref("SettingsApplied")), "400": badRequest },
    },
  },
  "/config/ai": {
    get: {
      tags: ["Configuration"],
      summary: "Settings → AI implementation (roadmap 6.10): provider, model, base URL, whether a key is set, whether `claude` is on PATH.",
      description: "Never carries the key. `key.saved` is true when the dashboard saved it (and can clear it); a key from the container's environment is `set` but not `saved`.",
      responses: { "200": ok(ref("SettingsAi")) },
    },
    patch: {
      tags: ["Configuration"],
      summary: "Change the provider (`off`, `anthropic`, `openai`, `claude-cli`), the model or the OpenAI-compatible base URL.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          properties: {
            provider: { type: "string", enum: ["off", "anthropic", "openai", "claude-cli"] },
            model: { type: "string" },
            baseUrl: { type: "string" },
          },
        }),
      },
      responses: { "200": ok(ref("SettingsAi")), "400": badRequest },
    },
  },
  "/config/ai/models": {
    get: {
      tags: ["Configuration"],
      summary: "What the model menu offers for the chosen provider: `{ models: [{ id, label }], error? }`.",
      description:
        "Anthropic: the API's own list when a key is saved, otherwise a fixed list of current models. OpenAI-compatible: the server's `/models`. Local CLI: Claude Code's aliases (`opus`, `sonnet`, `haiku`). Never fails: a list that cannot be read comes back with `error` beside the fallback.",
      responses: {
        "200": ok({
          type: "object",
          required: ["models"],
          properties: {
            models: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "label"],
                properties: { id: { type: "string" }, label: { type: "string" } },
              },
            },
            error: { type: "string", description: "Why the live list could not be read; `models` is then the fallback." },
          },
        }),
      },
    },
  },
  "/config/ai/{credential}": {
    put: {
      tags: ["Configuration"],
      summary: "Save an AI credential, write-only: `key` as `AI_API_KEY`, `cli-token` (from `claude setup-token`) as `CLAUDE_CODE_OAUTH_TOKEN`, in the secrets file beside the database.",
      parameters: [path("credential", "`key` or `cli-token`.")],
      requestBody: { required: true, ...json({ type: "object", properties: { value: { type: "string" } }, required: ["value"] }) },
      responses: { "200": ok(ref("SettingsAi")), "400": badRequest, "404": notFound },
    },
    delete: {
      tags: ["Configuration"],
      summary: "Forget a saved AI credential. 409 when it comes from the container's environment instead.",
      parameters: [path("credential", "`key` or `cli-token`.")],
      responses: { "200": ok(ref("SettingsAi")), "404": notFound, "409": { description: "Not saved here.", ...json(ref("Error")) } },
    },
  },
  "/config/series": {
    get: {
      tags: ["Configuration"],
      summary: "The operator's own metrics (roadmap 6.11): `{ series: [{ id, name, unit, source, url, query, points, createdAt }] }`.",
      responses: {
        "200": ok({ type: "object", required: ["series"], properties: { series: { type: "array", items: ref("SettingsSeries") } } }),
      },
    },
    post: {
      tags: ["Configuration"],
      summary: "Declare a series: `{ source: \"prometheus\", name, unit?, url, query }` or `{ source: \"csv\", name, unit?, csv }`.",
      description:
        "A Prometheus series stores only where to ask; it is read with `query_range` each time. A CSV one stores its rows: `timestamp,value` per line, ISO 8601 or Unix seconds, a header row allowed, up to 50,000 rows. An unreadable row is a 400 naming its line. At most 10 series.",
      requestBody: {
        required: true,
        ...json({
        oneOf: [
          {
            type: "object",
            required: ["source", "name", "url", "query"],
            additionalProperties: false,
            properties: {
              source: { type: "string", const: "prometheus" },
              name: { type: "string", minLength: 1, maxLength: 80 },
              unit: { type: "string", maxLength: 16 },
              url: { type: "string", format: "uri", maxLength: 2048 },
              query: { type: "string", minLength: 1, maxLength: 4000 },
            },
          },
          {
            type: "object",
            required: ["source", "name", "csv"],
            additionalProperties: false,
            properties: {
              source: { type: "string", const: "csv" },
              name: { type: "string", minLength: 1, maxLength: 80 },
              unit: { type: "string", maxLength: 16 },
              csv: { type: "string", minLength: 1, maxLength: 4000000 },
            },
          },
        ],
      }),
      },
      responses: { "201": ok(ref("SettingsSeries"), "The stored series."), "400": badRequest },
    },
  },
  "/config/series/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Remove a series, and its points with it.",
      parameters: [path("id", "Series id.")],
      responses: { "204": { description: "Removed." }, "404": notFound },
    },
  },
  "/series/{id}": {
    get: {
      tags: ["History"],
      summary: "One of the operator's series over a window, thinned to about 300 points, for drawing under the incidents.",
      description:
        "Roadmap 6.11. Thinning keeps the largest value in each bucket, so a spike survives. A Prometheus query must return exactly one series (wrap it in `sum(...)`); a bearer token comes from `PROMETHEUS_TOKEN`. 502 when Prometheus refuses or cannot be reached.",
      parameters: [
        path("id", "Series id."),
        query("from", "Window start, ISO 8601."),
        query("to", "Window end, ISO 8601. At most 400 days after `from`."),
      ],
      responses: {
        "200": ok(
          {
            type: "object",
            required: ["series", "from", "to", "points"],
            properties: {
              series: ref("SettingsSeries"),
              from: { type: "string", format: "date-time" },
              to: { type: "string", format: "date-time" },
              points: {
                type: "array",
                items: {
                  type: "object",
                  required: ["at", "value"],
                  properties: { at: { type: "string", format: "date-time" }, value: { type: "number" } },
                },
              },
            },
          },
          "`{ series, from, to, points: [{ at, value }] }`.",
        ),
        "400": badRequest,
        "404": notFound,
        "502": { description: "Prometheus refused the query or could not be reached.", ...json(ref("Error")) },
      },
    },
  },
  "/config/storage": {
    get: {
      tags: ["Configuration"],
      summary:
        "What retention costs: size on disk, sample count, bytes per sample.",
      responses: {
        "200": ok({
          type: "object",
          required: ["dbBytes", "sampleCount", "bytesPerSample", "measured", "samplesPerDay"],
          properties: {
            dbBytes: { type: "integer", description: "Size of the database file." },
            sampleCount: { type: "integer" },
            bytesPerSample: { type: "integer", description: "Measured, or an estimate when `measured` is false." },
            measured: { type: "boolean" },
            samplesPerDay: { type: "integer", description: "What the enabled providers write at the current interval." },
          },
        }),
      },
    },
  },
  "/config/usage-report": {
    get: {
      tags: ["Configuration"],
      summary: "The opt-in usage report (roadmap 16.3): counts and identifiers only, for the operator to paste into an issue.",
      responses: {
        "200": ok({
          type: "object",
          required: ["edition", "version", "providers", "channels", "delivery", "routingRules", "recipients", "features", "deprecatedInUse"],
          properties: {
            edition: { type: "string", enum: ["light", "ui"] },
            version: { type: "string" },
            providers: {
              type: "object",
              required: ["total", "enabled", "byAdapter"],
              properties: {
                total: { type: "integer" },
                enabled: { type: "integer" },
                byAdapter: { type: "object", additionalProperties: { type: "integer" } },
              },
            },
            channels: { type: "array", items: { type: "string" }, description: "Enabled channel ids." },
            delivery: { type: "array", items: { type: "string" }, description: "Delivery features switched on." },
            routingRules: { type: "integer" },
            recipients: { type: "integer" },
            features: { type: "object", additionalProperties: { type: "boolean" } },
            deprecatedInUse: { type: "array", items: { type: "string" }, description: "Deprecated routes served since start." },
          },
        }),
      },
    },
  },
  "/config/health": {
    get: {
      tags: ["Configuration"],
      summary:
        "Roadmap 5.15 and 5.16. `{ abandoned: [{ id, name, reason, since }], checks: [{ id, state, fix, days? }] }`. `abandoned` lists providers switched off, or never read successfully, for 30 days (`reason` is `disabled` or `failing`). `checks` is the installation checklist — channels, channel test, backup, retention, version, API token — each `ok`, `warn` or `unknown`, with where to fix it. Read-only.",
      responses: {
        "200": ok({
          type: "object",
          required: ["abandoned", "checks"],
          properties: {
            abandoned: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "reason", "since"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  reason: { type: "string", enum: ["disabled", "failing"] },
                  since: { type: "string", format: "date-time" },
                },
              },
            },
            checks: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "state", "fix"],
                properties: {
                  id: { type: "string", enum: ["channels", "channel-test", "backup", "retention", "version", "token"] },
                  state: { type: "string", enum: ["ok", "warn", "unknown"] },
                  fix: { type: "string", description: "A dashboard route, or an https link to the manual." },
                  days: { type: "integer" },
                },
              },
            },
          },
        }),
      },
    },
  },
  "/config/storage/maintenance": {
    post: {
      tags: ["Configuration"],
      summary: "PRAGMA integrity_check, then VACUUM. Deletes nothing.",
      responses: {
        "200": ok(
          {
            type: "object",
            required: ["ok", "integrity", "bytesBefore", "bytesAfter", "reclaimed", "durationMs"],
            properties: {
              ok: { type: "boolean" },
              integrity: { type: "string", description: "SQLite's own words: `ok`, or the first problems it found." },
              bytesBefore: { type: "integer" },
              bytesAfter: { type: "integer" },
              reclaimed: { type: "integer" },
              durationMs: { type: "integer" },
            },
          },
          "A failed check is 200 with ok: false.",
        ),
      },
    },
  },
  "/config/routing": {
    put: {
      tags: ["Configuration"],
      summary: "Replace the routing rules, in evaluation order.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["rules"],
          properties: {
            rules: {
              type: "array",
              items: {
                type: "object",
                required: ["provider"],
                properties: {
                  provider: {
                    type: "string",
                    pattern: "^(\\*|group:[a-z0-9][a-z0-9-]*|tag:[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*(#[A-Za-z0-9._:-]{1,128})?)$",
                    description: "`*`, `group:<slug>`, `tag:<slug>`, a provider id, or `<provider>#<component>`.",
                  },
                  classes: {
                    type: "array",
                    items: { type: "string", enum: ["status", "incident", "maintenance", "monitoring"] },
                  },
                  minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                  channels: {
                    type: "array",
                    items: { type: "string", pattern: "^(\\*|[a-z0-9][a-z0-9-]*)$" },
                    description: "`[\"*\"]` is every enabled channel; `[]` mutes.",
                  },
                },
              },
            },
          },
        }),
      },
      responses: {
        "200": ok({
          type: "object",
          required: ["rules", "invalidRules"],
          properties: {
            rules: {
              type: "array",
              items: {
                type: "object",
                required: ["provider", "classes", "minSeverity", "channels"],
                properties: {
                  provider: { type: "string", description: "A provider id, `group:<slug>`, `tag:<slug>`, `<provider>#<component>` or `*`." },
                  classes: { type: "array", items: { type: "string", enum: ["status", "incident", "maintenance", "monitoring"] } },
                  minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
                  channels: { type: "array", items: { type: "string" }, description: "Channel ids; `*` is every enabled channel, none mutes." },
                },
              },
            },
            invalidRules: { type: "integer", description: "Stored rules that could not be read and were skipped." },
          },
        }),
        "400": badRequest,
      },
    },
  },
  "/config/recipients": {
    put: {
      tags: ["Configuration"],
      summary: "Replace the recipients: channels grouped by who they reach, preferred first.",
      description:
        "Roadmap 3.5. Body `{ recipients: [{ id, name, channels }] }`. A change a rule sends to several channels of one recipient goes to the first of them only, and to the next only if that one fails. At least two channels each, each channel in at most one recipient, every channel one that exists.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["recipients"],
          properties: {
            recipients: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                required: ["id", "name", "channels"],
                properties: {
                  id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
                  name: { type: "string", minLength: 1, maxLength: 80 },
                  channels: {
                    type: "array",
                    minItems: 2,
                    maxItems: 10,
                    uniqueItems: true,
                    items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
                  },
                },
              },
            },
          },
        }),
      },
      responses: {
        "200": ok({
          type: "object",
          required: ["recipients"],
          properties: {
            recipients: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "channels"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  channels: { type: "array", items: { type: "string" }, description: "Channel ids, preferred first." },
                },
              },
            },
          },
        }),
        "400": badRequest,
      },
    },
  },
  "/config/channels/{id}": {
    patch: {
      tags: ["Configuration"],
      summary:
        "Enable or disable a channel, set its variable names, its locale and its template.",
      description:
        "Refuses a literal secret. `locale` (roadmap 3.20) and `template` (roadmap 3.15) are the two fields that are not credentials: an empty string clears either back to the default, and a template naming an unknown token is a 400.",
      parameters: [path("id", "Channel id.")],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            fields: { type: "object", additionalProperties: { type: "string" } },
            locale: {
              type: "string",
              pattern: "^([a-z]{2}(-[a-z0-9]+)*)?$",
              description: "A lowercase locale tag, or empty to go back to the installation's own.",
            },
            template: { type: "string", maxLength: TEMPLATE_MAX_LENGTH },
          },
        }),
      },
      responses: {
        "200": ok(ref("SettingsChannel")),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/channels/{id}/secrets": {
    put: {
      tags: ["Configuration"],
      summary:
        "Save credential values. Write-only: the response carries names and isSet.",
      parameters: [path("id", "Channel id.")],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["fields"],
          properties: {
            fields: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        }),
      },
      responses: {
        "200": ok(ref("SettingsChannel")),
        "400": badRequest,
        "404": notFound,
      },
    },
  },
  "/config/channels/{id}/secrets/{field}": {
    delete: {
      tags: ["Configuration"],
      summary: "Forget a saved credential value.",
      parameters: [path("id", "Channel id."), path("field", "Field name.")],
      responses: {
        "200": ok(ref("SettingsChannel")),
        "400": badRequest,
        "404": notFound,
        "409": {
          description:
            "The variable came from the container's environment instead.",
          ...json(ref("Error")),
        },
      },
    },
  },
  "/config/channels/{id}/test": {
    post: {
      tags: ["Configuration"],
      summary: "One test notification, through the dispatcher.",
      parameters: [path("id", "Channel id.")],
      responses: {
        "200": ok(
          {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean" }, error: { type: "string", description: "Why the test did not go out; present when `ok` is false." } },
          },
          "A failed test is 200 with ok: false.",
        ),
        "404": notFound,
      },
    },
  },
  "/config/push": {
    get: {
      tags: ["Configuration"],
      summary:
        "The server's VAPID public key, for a browser about to subscribe.",
      responses: {
        "200": ok({ type: "object", required: ["publicKey"], properties: { publicKey: { type: "string" } } }),
      },
    },
  },
  "/config/push/subscriptions": {
    get: {
      tags: ["Configuration"],
      summary: "The browsers currently subscribed to desktop push.",
      responses: { "200": ok(ref("SettingsPushDevices")) },
    },
    post: {
      tags: ["Configuration"],
      summary: "Subscribe this browser.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["endpoint", "keys", "label"],
          properties: {
            endpoint: { type: "string", format: "uri", maxLength: 2048, pattern: "^https://" },
            keys: {
              type: "object",
              required: ["p256dh", "auth"],
              properties: {
                p256dh: { type: "string", minLength: 1, maxLength: 256 },
                auth: { type: "string", minLength: 1, maxLength: 256 },
              },
            },
            label: { type: "string", minLength: 1, maxLength: 80 },
          },
        }),
      },
      responses: { "201": ok(ref("SettingsPushDevices")), "400": badRequest },
    },
  },
  "/config/push/subscriptions/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Remove one subscribed browser.",
      parameters: [path("id", "Subscription id.")],
      responses: { "204": { description: "Removed." }, "404": notFound },
    },
  },
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const settingsSchemas: Json = {
  SettingsAi: {
    type: "object",
    required: ["provider", "model", "baseUrl", "defaults", "key", "cliToken", "claudeCli"],
    properties: {
      provider: { type: "string", enum: ["off", "anthropic", "openai", "claude-cli"] },
      model: { type: "string", description: "Blank means the provider's default." },
      baseUrl: { type: "string", description: "`openai` only. Blank means OpenAI's own endpoint." },
      defaults: {
        type: "object",
        description: "The default model per provider.",
        additionalProperties: { type: "string" },
      },
      key: ref("SettingsAiCredential"),
      cliToken: ref("SettingsAiCredential"),
      claudeCli: { type: "boolean", description: "Whether `claude` is on PATH." },
    },
  },
  SettingsAiCredential: {
    type: "object",
    required: ["envVar", "set", "saved"],
    properties: {
      envVar: { type: "string" },
      set: { type: "boolean", description: "The variable resolves, from the dashboard or the environment." },
      saved: { type: "boolean", description: "The dashboard saved it, so the dashboard can clear it." },
    },
  },
  SettingsChannel: {
    type: "object",
    required: ["id", "enabled", "locale", "template", "fields"],
    properties: {
      id: { type: "string" },
      enabled: { type: "boolean" },
      locale: { type: "string", description: "Empty means the installation's locale." },
      template: { type: "string", description: "Empty means the default layout." },
      fields: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "envVar", "isSet", "optional"],
          properties: {
            name: { type: "string" },
            envVar: { type: "string", description: "The environment variable holding the value." },
            isSet: { type: "boolean" },
            optional: { type: "boolean" },
          },
        },
      },
    },
  },
  SettingsSeries: {
    type: "object",
    required: ["id", "name", "unit", "source", "url", "query", "points", "createdAt"],
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      unit: { type: "string", description: "Free text shown on the axis. Empty for none." },
      source: { type: "string", enum: ["prometheus", "csv"] },
      url: { type: ["string", "null"], description: "`prometheus` only." },
      query: { type: ["string", "null"], description: "`prometheus` only." },
      points: { type: "integer", description: "`csv` only: how many points were uploaded." },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  SettingsPushDevices: {
    type: "object",
    required: ["devices"],
    properties: {
      devices: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "label", "createdAt"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  SettingsApplied: {
    type: "object",
    required: ["delivery", "updateCheck", "catalogFeed", "polling", "retention"],
    properties: {
      delivery: {
        type: "object",
        required: [
          "quietHours", "digest", "cap", "updateInPlace", "maintenanceNotice", "escalation", "channelHealth",
          "incidentSummary", "coalesce", "knownOutage", "report", "onCall", "deliveryTest", "attachChart",
        ],
        properties: {
          quietHours: {
            type: "object",
            required: ["enabled", "start", "end", "timeZone", "minSeverity"],
            properties: {
              enabled: { type: "boolean" },
              start: { type: "string", description: "HH:MM." },
              end: { type: "string", description: "HH:MM." },
              timeZone: { type: "string", description: "An IANA zone, or `auto`." },
              minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
            },
          },
          digest: {
            type: "object",
            required: ["enabled", "windowMinutes", "immediateFloor"],
            properties: {
              enabled: { type: "boolean" },
              windowMinutes: { type: "integer" },
              immediateFloor: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
            },
          },
          cap: {
            type: "object",
            required: ["enabled", "maxPerHour"],
            properties: { enabled: { type: "boolean" }, maxPerHour: { type: "integer" } },
          },
          updateInPlace: { type: "boolean" },
          maintenanceNotice: {
            type: "object",
            required: ["enabled", "leadMinutes"],
            properties: { enabled: { type: "boolean" }, leadMinutes: { type: "integer" } },
          },
          escalation: {
            type: "object",
            required: ["enabled", "afterMinutes", "channel", "minSeverity"],
            properties: {
              enabled: { type: "boolean" },
              afterMinutes: { type: "integer" },
              channel: { type: "string" },
              minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
            },
          },
          channelHealth: {
            type: "object",
            required: ["enabled", "afterFailures"],
            properties: { enabled: { type: "boolean" }, afterFailures: { type: "integer" } },
          },
          incidentSummary: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } },
          coalesce: {
            type: "object",
            required: ["enabled", "windowMinutes"],
            properties: { enabled: { type: "boolean" }, windowMinutes: { type: "integer" } },
          },
          knownOutage: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } },
          report: {
            type: "object",
            required: ["enabled", "frequency", "channel"],
            properties: {
              enabled: { type: "boolean" },
              frequency: { type: "string", enum: ["weekly", "monthly"] },
              channel: { type: "string" },
            },
          },
          onCall: {
            type: "object",
            required: ["enabled", "minSeverity", "rotation", "startsOn"],
            properties: {
              enabled: { type: "boolean" },
              minSeverity: { type: "string", enum: ["any", "degraded", "partial_outage", "major_outage"] },
              rotation: { type: "array", items: { type: "string" }, description: "Recipient ids, in turn." },
              startsOn: { type: "string" },
            },
          },
          deliveryTest: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } },
          attachChart: { type: "boolean" },
        },
      },
      updateCheck: {
        type: "object",
        required: ["enabled", "status", "currentVersion", "latestVersion", "checkedAt"],
        properties: {
          enabled: { type: "boolean" },
          status: { type: "string", enum: ["unknown", "current", "available", "failed"] },
          currentVersion: { type: "string" },
          latestVersion: { type: ["string", "null"], description: "Only set when `status` is `available`." },
          checkedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      catalogFeed: {
        type: "object",
        required: ["enabled", "status", "source", "generatedAt", "entries", "checkedAt"],
        properties: {
          enabled: { type: "boolean" },
          status: { type: "string", enum: ["unknown", "current", "updated", "failed"] },
          source: { type: "string", enum: ["bundled", "remote"] },
          generatedAt: { type: "string", format: "date-time" },
          entries: { type: "integer" },
          checkedAt: { type: ["string", "null"], format: "date-time" },
          reason: { type: "string", description: "Why the last check did not take, when it did not." },
        },
      },
      polling: {
        type: "object",
        required: [
          "intervalMinutes", "requestTimeoutSeconds", "maxRetries", "failureThreshold", "adaptivePolling",
          "adaptiveIntervalMinutes", "confirmSamples", "correlationThreshold", "correlationWindowMinutes",
        ],
        properties: {
          intervalMinutes: { type: "number" },
          requestTimeoutSeconds: { type: "number" },
          maxRetries: { type: "integer" },
          failureThreshold: { type: "integer" },
          adaptivePolling: { type: "boolean" },
          adaptiveIntervalMinutes: { type: "number" },
          confirmSamples: { type: "integer" },
          correlationThreshold: { type: "integer" },
          correlationWindowMinutes: { type: "integer" },
        },
      },
      retention: { type: "object", required: ["days"], properties: { days: { type: "integer" } } },
    },
  },
};
