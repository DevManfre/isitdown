import { query, path, json, ref, ok, notFound, badRequest } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Configuration: settings, AI, operator series, storage, routing, channels and push. */
export const settingsPaths: Json = {
  "/config/settings": {
    patch: {
      tags: ["Configuration"],
      summary: "Polling settings, retention and the delivery policy.",
      description: "The delivery patch is partial at every level.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/ai": {
    get: {
      tags: ["Configuration"],
      summary: "Settings → AI implementation (roadmap 6.10): provider, model, base URL, whether a key is set, whether `claude` is on PATH.",
      description: "Never carries the key. `key.saved` is true when the dashboard saved it (and can clear it); a key from the container's environment is `set` but not `saved`.",
      responses: { "200": ok({ type: "object" }) },
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
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/ai/models": {
    get: {
      tags: ["Configuration"],
      summary: "What the model menu offers for the chosen provider: `{ models: [{ id, label }], error? }`.",
      description:
        "Anthropic: the API's own list when a key is saved, otherwise a fixed list of current models. OpenAI-compatible: the server's `/models`. Local CLI: Claude Code's aliases (`opus`, `sonnet`, `haiku`). Never fails: a list that cannot be read comes back with `error` beside the fallback.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/ai/{credential}": {
    put: {
      tags: ["Configuration"],
      summary: "Save an AI credential, write-only: `key` as `AI_API_KEY`, `cli-token` (from `claude setup-token`) as `CLAUDE_CODE_OAUTH_TOKEN`, in the secrets file beside the database.",
      parameters: [path("credential", "`key` or `cli-token`.")],
      requestBody: { required: true, ...json({ type: "object", properties: { value: { type: "string" } }, required: ["value"] }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest, "404": notFound },
    },
    delete: {
      tags: ["Configuration"],
      summary: "Forget a saved AI credential. 409 when it comes from the container's environment instead.",
      parameters: [path("credential", "`key` or `cli-token`.")],
      responses: { "200": ok({ type: "object" }), "404": notFound, "409": { description: "Not saved here.", ...json({ type: "object" }) } },
    },
  },
  "/config/series": {
    get: {
      tags: ["Configuration"],
      summary: "The operator's own metrics (roadmap 6.11): `{ series: [{ id, name, unit, source, url, query, points, createdAt }] }`.",
      responses: { "200": ok({ type: "object" }) },
    },
    post: {
      tags: ["Configuration"],
      summary: "Declare a series: `{ source: \"prometheus\", name, unit?, url, query }` or `{ source: \"csv\", name, unit?, csv }`.",
      description:
        "A Prometheus series stores only where to ask; it is read with `query_range` each time. A CSV one stores its rows: `timestamp,value` per line, ISO 8601 or Unix seconds, a header row allowed, up to 50,000 rows. An unreadable row is a 400 naming its line. At most 10 series.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "201": ok({ type: "object" }, "The stored series."), "400": badRequest },
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
        "200": ok({ type: "object" }, "`{ series, from, to, points: [{ at, value }] }`."),
        "400": badRequest,
        "404": notFound,
        "502": { description: "Prometheus refused the query or could not be reached.", ...json({ type: "object" }) },
      },
    },
  },
  "/config/storage": {
    get: {
      tags: ["Configuration"],
      summary:
        "What retention costs: size on disk, sample count, bytes per sample.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/health": {
    get: {
      tags: ["Configuration"],
      summary:
        "Roadmap 5.15 and 5.16. `{ abandoned: [{ id, name, reason, since }], checks: [{ id, state, fix, days? }] }`. `abandoned` lists providers switched off, or never read successfully, for 30 days (`reason` is `disabled` or `failing`). `checks` is the installation checklist — channels, channel test, backup, retention, version, API token — each `ok`, `warn` or `unknown`, with where to fix it. Read-only.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/storage/maintenance": {
    post: {
      tags: ["Configuration"],
      summary: "PRAGMA integrity_check, then VACUUM. Deletes nothing.",
      responses: {
        "200": ok({ type: "object" }, "A failed check is 200 with ok: false."),
      },
    },
  },
  "/config/routing": {
    put: {
      tags: ["Configuration"],
      summary: "Replace the routing rules, in evaluation order.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/recipients": {
    put: {
      tags: ["Configuration"],
      summary: "Replace the recipients: channels grouped by who they reach, preferred first.",
      description:
        "Roadmap 3.5. Body `{ recipients: [{ id, name, channels }] }`. A change a rule sends to several channels of one recipient goes to the first of them only, and to the next only if that one fails. At least two channels each, each channel in at most one recipient, every channel one that exists.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "200": ok({ type: "object" }), "400": badRequest },
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
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }),
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
        "200": ok({ type: "object" }),
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
        "200": ok({ type: "object" }),
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
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/config/push": {
    get: {
      tags: ["Configuration"],
      summary:
        "The server's VAPID public key, for a browser about to subscribe.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
  "/config/push/subscriptions": {
    get: {
      tags: ["Configuration"],
      summary: "The browsers currently subscribed to desktop push.",
      responses: { "200": ok({ type: "object" }) },
    },
    post: {
      tags: ["Configuration"],
      summary: "Subscribe this browser.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: { "201": ok({ type: "object" }), "400": badRequest },
    },
  },
  "/config/push/subscriptions/{id}": {
    delete: {
      tags: ["Configuration"],
      summary: "Remove one subscribed browser.",
      parameters: [path("id", "Subscription id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
};
