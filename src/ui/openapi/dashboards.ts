import { path, json, ok, ref, notFound, badRequest } from "./shared.ts";
import type { Json } from "./shared.ts";
import { WIDGET_WIDTHS, WIDTHS } from "../dashboardLayout.ts";

/** Saved dashboards and the map. */
export const dashboardsPaths: Json = {
  "/dashboards": {
    get: {
      tags: ["Status"],
      summary: "Every named dashboard, in the rail's order — roadmap 4.2.",
      description:
        "`[{ id, name, home, isDefault, updatedAt }]`, no layouts. Exactly one is `home`: the one the Overview opens on.",
      responses: { "200": ok({ type: "array", items: ref("DashboardSummary") }) },
    },
    post: {
      tags: ["Status"],
      summary: "Create a named dashboard.",
      description:
        "Body `{ name, layout? }`. The id is taken from the name (`Vendor che pago` is `vendor-che-pago`) and never changes. No layout follows the built-in default. A name already in use, ignoring case, or a 21st dashboard is refused with 409.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            layout: ref("DashboardLayout"),
          },
        }),
      },
      responses: {
        "201": ok(ref("Dashboard"), "The created dashboard."),
        "400": badRequest,
        "409": { description: "The name is taken, or there are already 20 dashboards.", ...json(ref("Error")) },
      },
    },
  },
  "/dashboards/import": {
    post: {
      tags: ["Status"],
      summary: "Create a dashboard from an exported file.",
      description:
        "Body is what `GET /dashboards/{id}/export` answers: `{ format: \"isitdown.dashboard\", version: 1, name, layout }`. A name already in use is numbered (`Overview (2)`) rather than refused.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["format", "version", "name", "layout"],
          additionalProperties: false,
          properties: {
            format: { type: "string", const: "isitdown.dashboard" },
            version: { type: "integer", const: 1 },
            name: { type: "string", minLength: 1, maxLength: 60 },
            layout: ref("DashboardLayout"),
          },
        }),
      },
      responses: {
        "201": ok(ref("Dashboard"), "The created dashboard."),
        "400": badRequest,
        "409": { description: "There are already 20 dashboards.", ...json(ref("Error")) },
      },
    },
  },
  "/dashboards/restore": {
    post: {
      tags: ["Status"],
      summary: "Undo a delete.",
      description:
        "Body is what `DELETE /dashboards/{id}` answered. The dashboard comes back with the same id, at the same place in the rail, home again if it was. 409 if that id or name has been taken since, or there are already 20.",
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["id", "name", "layout", "position", "home"],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 40 },
            name: { type: "string", minLength: 1, maxLength: 60 },
            layout: { type: ["string", "null"] },
            position: { type: "integer", minimum: 0 },
            home: { type: "boolean" },
          },
        }),
      },
      responses: {
        "201": ok(ref("Dashboard"), "The restored dashboard."),
        "400": badRequest,
        "409": { description: "The id or name is taken, or there are already 20.", ...json(ref("Error")) },
      },
    },
  },
  "/dashboards/{id}/export": {
    get: {
      tags: ["Status"],
      summary: "One dashboard as a file to share.",
      description:
        "`{ format, version, name, layout }`, sent as an attachment. The layout is always concrete: a dashboard following the default exports what it draws.",
      parameters: [path("id", "Dashboard id.")],
      responses: { "200": ok(ref("DashboardExport")), "404": notFound },
    },
  },
  "/dashboards/{id}": {
    patch: {
      tags: ["Status"],
      summary: "Rename a dashboard, or make it home.",
      description:
        "Body `{ name?, home?: true }`. Neither moves `updatedAt`, so an edit open elsewhere can still save. Home is handed over, never put down: `home: false` is refused.",
      parameters: [path("id", "Dashboard id.")],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            home: { type: "boolean", const: true },
          },
        }),
      },
      responses: {
        "200": ok(ref("Dashboard")),
        "400": badRequest,
        "404": notFound,
        "409": { description: "The name is taken.", ...json(ref("Error")) },
      },
    },
    delete: {
      tags: ["Status"],
      summary: "Delete a dashboard.",
      description:
        "Home moves to the first one left. The last dashboard cannot be deleted (409). Answers the removed row `{ id, name, layout, position, home }` — `layout` the stored JSON string or null — which `POST /dashboards/restore` takes back for Undo.",
      parameters: [path("id", "Dashboard id.")],
      responses: {
        "200": ok(ref("DashboardRemoved"), "The removed row."),
        "404": notFound,
        "409": { description: "It is the last dashboard.", ...json(ref("Error")) },
      },
    },
    get: {
      tags: ["Status"],
      summary: "One dashboard's widget layout, the Overview's being `default`.",
      description:
        "Roadmap 4.1. A dashboard never customised answers the code default with `isDefault: true`; a stored layout this version cannot read answers the default with `layoutInvalid: true`. `home` says whether the Overview opens on it (4.2).",
      parameters: [path("id", "Dashboard id; `default` is the Overview.")],
      responses: { "200": ok(ref("Dashboard")), "404": notFound },
    },
    put: {
      tags: ["Status"],
      summary: "Save a widget layout.",
      description:
        "Body `{ layout, updatedAt }`, `updatedAt` being the version the edit started from. A save based on a copy someone else has since replaced is refused with 409 and the current dashboard under `current`.",
      parameters: [path("id", "Dashboard id.")],
      requestBody: {
        required: true,
        ...json({
          type: "object",
          required: ["layout", "updatedAt"],
          properties: {
            layout: ref("DashboardLayout"),
            updatedAt: { type: "string", minLength: 1 },
          },
        }),
      },
      responses: {
        "200": ok(ref("Dashboard")),
        "400": badRequest,
        "404": notFound,
        "409": {
          description: "The dashboard was saved elsewhere since this copy was read.",
          ...json({
            type: "object",
            required: ["error", "current"],
            properties: {
              error: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
              current: ref("Dashboard"),
            },
          }),
        },
      },
    },
  },
  "/dashboards/{id}/layout": {
    delete: {
      tags: ["Status"],
      summary: "Forget the customisation: the dashboard follows the default layout again.",
      parameters: [path("id", "Dashboard id.")],
      responses: { "200": ok(ref("Dashboard")), "404": notFound },
    },
  },
  "/map": {
    get: {
      tags: ["Status"],
      summary: "Where each provider is answering from, for the map and globe.",
      responses: {
        "200": ok({
          type: "object",
          required: ["points", "unlocated", "generatedAt"],
          properties: {
            points: {
              type: "array",
              items: {
                type: "object",
                required: ["providerId", "providerName", "componentId", "name", "lat", "lon", "status", "source"],
                properties: {
                  providerId: { type: "string" },
                  providerName: { type: "string" },
                  componentId: { type: "string" },
                  name: { type: "string" },
                  lat: { type: "number" },
                  lon: { type: "number" },
                  status: ref("OverallStatus"),
                  source: { type: "string", enum: ["iata", "region"], description: "How the location was worked out." },
                },
              },
            },
            unlocated: {
              type: "array",
              description: "Providers with components no location could be found for.",
              items: {
                type: "object",
                required: ["providerId", "providerName", "count"],
                properties: {
                  providerId: { type: "string" },
                  providerName: { type: "string" },
                  count: { type: "integer", description: "Components left off the map." },
                },
              },
            },
            generatedAt: {
              type: ["string", "null"],
              format: "date-time",
              description: "The oldest observation across the snapshot; null when there are no points.",
            },
          },
        }),
      },
    },
  },
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const dashboardsSchemas: Json = {
  DashboardLayout: {
    type: "object",
    required: ["version", "widgets"],
    properties: {
      version: { type: "integer", const: 1 },
      widgets: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          required: ["id", "type", "width", "props"],
          properties: {
            id: { type: "string", description: "Unique inside the layout." },
            type: { type: "string", enum: Object.keys(WIDGET_WIDTHS) },
            width: { type: "string", enum: [...WIDTHS], description: "Not every widget takes every width." },
            props: {
              type: "object",
              description: "What the widget is pointed at; its keys depend on `type` (a `filter` or a `provider`).",
              additionalProperties: true,
            },
          },
        },
      },
    },
  },
  Dashboard: {
    type: "object",
    required: ["id", "name", "layout", "isDefault", "home", "updatedAt"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      layout: ref("DashboardLayout"),
      isDefault: { type: "boolean", description: "The layout is the code default, never customised or unreadable." },
      home: { type: "boolean", description: "The Overview opens on it." },
      layoutInvalid: {
        type: "boolean",
        const: true,
        description: "Present when the stored layout could not be read and the default is served instead.",
      },
      updatedAt: { type: "string", format: "date-time", description: "The version a save is checked against." },
    },
  },
  DashboardSummary: {
    type: "object",
    required: ["id", "name", "isDefault", "home", "updatedAt"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      isDefault: { type: "boolean" },
      home: { type: "boolean" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  DashboardRemoved: {
    type: "object",
    required: ["id", "name", "layout", "position", "home"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      layout: { type: ["string", "null"], description: "The stored JSON string, or null when it followed the default." },
      position: { type: "integer", minimum: 0, description: "Place in the rail." },
      home: { type: "boolean" },
    },
  },
  DashboardExport: {
    type: "object",
    required: ["format", "version", "name", "layout"],
    properties: {
      format: { type: "string", const: "isitdown.dashboard" },
      version: { type: "integer", const: 1 },
      name: { type: "string" },
      layout: ref("DashboardLayout"),
    },
  },
};
