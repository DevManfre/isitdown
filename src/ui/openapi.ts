/**
 * The UI edition's HTTP API, machine-readable — roadmap 4.10.
 *
 * Written here rather than generated from the route handlers, and deliberately
 * so: Express routes carry no type information about what they answer with, and
 * a spec inferred from them would describe the shapes as `object` and be worth
 * nothing to a generated client. What keeps it honest instead is
 * `test/ui/openapi.test.ts`, which walks the running app's own route table and
 * fails when a path is registered without being described here, or described
 * here without existing.
 *
 * `info.version` is the *API contract's* version, not the product's: the
 * package version moves with every release, and a client generated against
 * this document has no reason to be regenerated because the dashboard's CSS
 * changed.
 */

export const API_VERSION = "1.0.0";

import type { Json } from "./openapi/shared.ts";
import { schemas } from "./openapi/schemas.ts";
import { statusPaths } from "./openapi/status.ts";
import { historyPaths } from "./openapi/history.ts";
import { incidentsPaths } from "./openapi/incidents.ts";
import { dashboardsPaths } from "./openapi/dashboards.ts";
import { exportPaths } from "./openapi/export.ts";
import { configPaths } from "./openapi/config.ts";
import { settingsPaths } from "./openapi/settings.ts";
import { operationsPaths } from "./openapi/operations.ts";

/**
 * Every route the server registers, in the order `docs/api.md` presents them.
 * Summaries are that page's own sentences, shortened: two descriptions of one
 * endpoint is how they start disagreeing.
 */
const paths: Json = {
  ...statusPaths,
  ...historyPaths,
  ...incidentsPaths,
  ...dashboardsPaths,
  ...exportPaths,
  ...configPaths,
  ...settingsPaths,
  ...operationsPaths,
};

/**
 * The document itself. Built on each call rather than kept as a frozen
 * constant: the only caller is a route that serialises it, and a shared mutable
 * object handed to two of them is a trap for no gain.
 */
export function openapiDocument(): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "IsItDown",
      version: API_VERSION,
      description:
        "The UI edition's HTTP API. It is a single-operator dashboard bound to the machine it runs on, so by default nothing here is authenticated. Setting API_TOKEN (roadmap 4.15) turns on the one scheme below: a bearer token granting read access from any host, while writes stay local-only. /health and /ready are never gated.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/", description: "This instance." }],
    tags: [
      { name: "Health", description: "Liveness and readiness." },
      {
        name: "Status",
        description: "What every provider is reporting right now.",
      },
      { name: "History", description: "Stored samples, aggregated." },
      {
        name: "Incidents",
        description: "Incident search, detail and operator notes.",
      },
      { name: "Providers", description: "Acting on one provider from a notification." },
      { name: "Notifications", description: "What was sent, and what failed." },
      { name: "Export", description: "Downloads and feeds." },
      {
        name: "Configuration",
        description: "Providers, settings, channels, routing, backups.",
      },
      {
        name: "Preferences",
        description: "Per-dashboard display preferences.",
      },
      { name: "Diagnostics", description: "Adapter probes and manual polls." },
      { name: "Live", description: "Streams and scrape targets." },
      {
        name: "Public",
        description:
          "The read-only status page, for readers who are not the operator.",
      },
      { name: "Meta", description: "This document." },
    ],
    paths,
    components: {
      schemas,
      /**
       * Declared rather than applied: with no `API_TOKEN` set — the default —
       * every route is open, and a `security` requirement on each path would
       * tell a generated client to demand a credential most installations do
       * not have.
       */
      securitySchemes: {
        apiToken: {
          type: "http",
          scheme: "bearer",
          description:
            "The value of API_TOKEN, when the instance sets one. Grants GET and HEAD from any host; anything else answers 403. X-API-Token carries the same value for a client that cannot send an Authorization header.",
        },
      },
    },
  };
}
