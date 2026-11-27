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
import { statusPaths, statusSchemas } from "./openapi/status.ts";
import { historyPaths, historySchemas } from "./openapi/history.ts";
import { incidentsPaths, incidentsSchemas } from "./openapi/incidents.ts";
import { dashboardsPaths, dashboardsSchemas } from "./openapi/dashboards.ts";
import { exportPaths, exportSchemas } from "./openapi/export.ts";
import { configPaths, configSchemas } from "./openapi/config.ts";
import { settingsPaths, settingsSchemas } from "./openapi/settings.ts";
import { operationsPaths, operationsSchemas } from "./openapi/operations.ts";
import { requiredScope } from "./apiToken.ts";

/**
 * Every route the server registers, in the order `docs/api.md` presents them.
 * Summaries are that page's own sentences, shortened: two descriptions of one
 * endpoint is how they start disagreeing.
 */
const allPaths: Json = {
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
 * Each operation carries the token scope it needs as `x-required-scope` —
 * roadmap 9.11 — read off the same table the gate enforces, so the document
 * cannot promise a scope the server does not check.
 */
const paths: Json = Object.fromEntries(
  Object.entries(allPaths).map(([route, operations]) => [
    route,
    Object.fromEntries(
      Object.entries(operations as Record<string, Json>).map(([method, operation]) => [
        method,
        { ...operation, "x-required-scope": requiredScope(method, route.replace(/\{[^}]+\}/g, "x")) },
      ]),
    ),
  ]),
);

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
        "The UI edition's HTTP API. It is a single-operator dashboard bound to the machine it runs on, so by default nothing here is authenticated. Setting API_TOKEN (roadmap 4.15), or creating a token at /config/tokens (roadmap 9.11), turns on the one scheme below. API_TOKEN grants read access from any host; a created token grants the scopes it was made with, and each operation names the scope it needs in x-required-scope. Without a token, only requests from this machine get in. /health and /ready are never gated.",
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
      schemas: {
        ...schemas,
        ...statusSchemas,
        ...historySchemas,
        ...incidentsSchemas,
        ...dashboardsSchemas,
        ...exportSchemas,
        ...configSchemas,
        ...settingsSchemas,
        ...operationsSchemas,
      },
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
            "API_TOKEN (read only), or a token created at POST /config/tokens (its scopes). A request the token's scopes do not cover answers 403 naming the scope it needs. X-API-Token carries the same value for a client that cannot send an Authorization header.",
        },
      },
    },
  };
}
