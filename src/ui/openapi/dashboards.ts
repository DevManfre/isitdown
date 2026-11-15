import { path, json, ok, notFound, badRequest } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Saved dashboards and the map. */
export const dashboardsPaths: Json = {
  "/dashboards": {
    get: {
      tags: ["Status"],
      summary: "Every named dashboard, in the rail's order — roadmap 4.2.",
      description:
        "`[{ id, name, home, isDefault, updatedAt }]`, no layouts. Exactly one is `home`: the one the Overview opens on.",
      responses: { "200": ok({ type: "array" }) },
    },
    post: {
      tags: ["Status"],
      summary: "Create a named dashboard.",
      description:
        "Body `{ name, layout? }`. The id is taken from the name (`Vendor che pago` is `vendor-che-pago`) and never changes. No layout follows the built-in default. A name already in use, ignoring case, or a 21st dashboard is refused with 409.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "201": ok({ type: "object" }, "The created dashboard."),
        "400": badRequest,
        "409": { description: "The name is taken, or there are already 20 dashboards.", ...json({ type: "object" }) },
      },
    },
  },
  "/dashboards/import": {
    post: {
      tags: ["Status"],
      summary: "Create a dashboard from an exported file.",
      description:
        "Body is what `GET /dashboards/{id}/export` answers: `{ format: \"isitdown.dashboard\", version: 1, name, layout }`. A name already in use is numbered (`Overview (2)`) rather than refused.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "201": ok({ type: "object" }, "The created dashboard."),
        "400": badRequest,
        "409": { description: "There are already 20 dashboards.", ...json({ type: "object" }) },
      },
    },
  },
  "/dashboards/restore": {
    post: {
      tags: ["Status"],
      summary: "Undo a delete.",
      description:
        "Body is what `DELETE /dashboards/{id}` answered. The dashboard comes back with the same id, at the same place in the rail, home again if it was. 409 if that id or name has been taken since, or there are already 20.",
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "201": ok({ type: "object" }, "The restored dashboard."),
        "400": badRequest,
        "409": { description: "The id or name is taken, or there are already 20.", ...json({ type: "object" }) },
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
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/dashboards/{id}": {
    patch: {
      tags: ["Status"],
      summary: "Rename a dashboard, or make it home.",
      description:
        "Body `{ name?, home?: true }`. Neither moves `updatedAt`, so an edit open elsewhere can still save. Home is handed over, never put down: `home: false` is refused.",
      parameters: [path("id", "Dashboard id.")],
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }),
        "400": badRequest,
        "404": notFound,
        "409": { description: "The name is taken.", ...json({ type: "object" }) },
      },
    },
    delete: {
      tags: ["Status"],
      summary: "Delete a dashboard.",
      description:
        "Home moves to the first one left. The last dashboard cannot be deleted (409). Answers the removed row `{ id, name, layout, position, home }` — `layout` the stored JSON string or null — which `POST /dashboards/restore` takes back for Undo.",
      parameters: [path("id", "Dashboard id.")],
      responses: {
        "200": ok({ type: "object" }, "The removed row."),
        "404": notFound,
        "409": { description: "It is the last dashboard.", ...json({ type: "object" }) },
      },
    },
    get: {
      tags: ["Status"],
      summary: "One dashboard's widget layout, the Overview's being `default`.",
      description:
        "Roadmap 4.1. A dashboard never customised answers the code default with `isDefault: true`; a stored layout this version cannot read answers the default with `layoutInvalid: true`. `home` says whether the Overview opens on it (4.2).",
      parameters: [path("id", "Dashboard id; `default` is the Overview.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
    put: {
      tags: ["Status"],
      summary: "Save a widget layout.",
      description:
        "Body `{ layout, updatedAt }`, `updatedAt` being the version the edit started from. A save based on a copy someone else has since replaced is refused with 409 and the current dashboard under `current`.",
      parameters: [path("id", "Dashboard id.")],
      requestBody: { required: true, ...json({ type: "object" }) },
      responses: {
        "200": ok({ type: "object" }),
        "400": badRequest,
        "404": notFound,
        "409": {
          description: "The dashboard was saved elsewhere since this copy was read.",
          ...json({ type: "object" }),
        },
      },
    },
  },
  "/dashboards/{id}/layout": {
    delete: {
      tags: ["Status"],
      summary: "Forget the customisation: the dashboard follows the default layout again.",
      parameters: [path("id", "Dashboard id.")],
      responses: { "200": ok({ type: "object" }), "404": notFound },
    },
  },
  "/map": {
    get: {
      tags: ["Status"],
      summary: "Where each provider is answering from, for the map and globe.",
      responses: { "200": ok({ type: "object" }) },
    },
  },
};
