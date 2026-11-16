/** The few builders every path module spells its operations with. */

export type Json = Record<string, unknown>;

/** A query parameter, in the one shape every path below spells it. */
export const query = (
  name: string,
  description: string,
  schema: Json = { type: "string" },
): Json => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

export const path = (name: string, description: string): Json => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

export const json = (schema: Json): Json => ({
  content: { "application/json": { schema } },
});

export const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

export const ok = (schema: Json, description = "Success."): Json => ({
  description,
  ...json(schema),
});

export const notFound: Json = {
  description: "No such id.",
  ...json(ref("Error")),
};

export const badRequest: Json = {
  description: "The request names an invalid field or value.",
  ...json(ref("Error")),
};

/** A response that is not JSON: a badge, a feed, a CSV, the metrics. */
export const media = (mediaType: string, description: string): Json => ({
  description,
  content: { [mediaType]: { schema: { type: "string" } } },
});

export const incidentFilters = [
  query("provider", "Narrow to one provider id."),
  query("state", "all (default), active or resolved.", {
    type: "string",
    enum: ["all", "active", "resolved"],
  }),
  query("q", "Case-insensitive search over incident names."),
  query("days", "Keep only incidents that started within this window.", {
    type: "integer",
  }),
];

export const paging = [
  query(
    "page",
    "1-based page number; a nonsense value falls back to the first page.",
    {
      type: "integer",
      minimum: 1,
    },
  ),
  query("pageSize", "Rows per page.", { type: "integer", minimum: 1 }),
];
