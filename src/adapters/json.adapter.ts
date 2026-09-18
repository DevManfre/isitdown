import { z } from "zod";
import type {
  Adapter,
  FetchContext,
  ServiceRef,
} from "../core/adapter.interface.ts";
import type {
  Incident,
  NormalizedStatus,
  OverallStatus,
} from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { worstStatus } from "./severity.ts";

/**
 * The generic JSON adapter — roadmap 11.1.
 *
 * It covers the gap between Statuspage, which is already one adapter for
 * hundreds of providers, and HTML scraping, which is one fragile adapter per
 * page. An enormous number of status pages serve perfectly good JSON in a shape
 * nobody standardised: the data is there, it is stable, and the only thing
 * missing is somebody to say which field means what.
 *
 * So that is what a provider supplies here — a path per field and a table of
 * status words — and a new provider costs configuration rather than code. Same
 * leverage as the feed adapter (1.5), and it turns the long tail into a form in
 * the dashboard.
 *
 * The mapping is validated **when it is configured, not when it is read**
 * (`validateOptions`): a typo in a path is a thing the operator can fix while
 * looking at the field they typed it in, and discovering it three minutes later
 * as a failed poll on a dashboard is the worst possible moment to be told.
 */

/**
 * One field's location in the body: dot-separated names, with `[n]` for an
 * array index — `page.status`, `components[0].state`, `result.items[2].name`.
 *
 * Deliberately not JSONPath or any other expression language. A path is a
 * lookup, and an expression language is a thing that evaluates: the first has
 * one obvious meaning to an operator typing it into a form, and the second is a
 * surface with filters, wildcards and eventually a parser of its own to
 * maintain. If a page needs more than a lookup, it needs an adapter.
 */
const PATH = /^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/;

const pathSchema = z
  .string()
  .trim()
  .regex(PATH, "must be a path like page.status or components[0].state");

const STATUSES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "unknown",
] as const;

/**
 * The provider's own status words, mapped to ours. Written as a JSON object
 * because `options` is a flat string map — the one place in this file where the
 * shape of the surrounding configuration shows through.
 *
 * Matching is case-insensitive and trimmed: a provider that writes "Operational"
 * in one field and "operational" in another is not two different states, and an
 * operator should not have to discover that by reading a chart that disagrees
 * with itself.
 */
const statusMapSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "statusMap must be a JSON object",
      });
      return z.NEVER;
    }
    const entries = z.record(z.enum(STATUSES)).safeParse(parsed);
    if (!entries.success) {
      ctx.addIssue({
        code: "custom",
        message: `statusMap values must each be one of ${STATUSES.join(", ")}`,
      });
      return z.NEVER;
    }
    return new Map(
      Object.entries(entries.data).map(([word, status]) => [
        word.trim().toLowerCase(),
        status,
      ]),
    );
  });

const optionsSchema = z
  .object({
    /** Appended to `baseUrl`; absent means the base url already is the document. */
    path: z.string().trim().startsWith("/").optional(),
    statusPath: pathSchema,
    statusMap: statusMapSchema,
    /**
     * Where the open incidents are, if the document carries any. Absent means
     * the provider publishes a status and nothing else, which is a perfectly
     * ordinary page — the status still moves the bars, there is simply nothing
     * to put on the timeline.
     */
    incidentsPath: pathSchema.optional(),
    /** Relative to one entry of `incidentsPath`. */
    incidentId: pathSchema.optional(),
    incidentName: pathSchema.optional(),
    incidentStatus: pathSchema.optional(),
    incidentImpact: pathSchema.optional(),
    incidentUpdatedAt: pathSchema.optional(),
  })
  .superRefine((options, ctx) => {
    // An incident list with no name is a timeline of blank rows: the name is
    // the one field that makes an entry worth showing at all.
    if (
      options.incidentsPath !== undefined &&
      options.incidentName === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "incidentsPath needs incidentName beside it",
      });
    }
    for (const key of [
      "incidentId",
      "incidentName",
      "incidentStatus",
      "incidentImpact",
      "incidentUpdatedAt",
    ] as const) {
      if (options[key] !== undefined && options.incidentsPath === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${key} means nothing without incidentsPath`,
        });
      }
    }
  });

export type JsonAdapterOptions = z.infer<typeof optionsSchema>;

/** Reads one path out of a parsed body. `undefined` for anything not there. */
function valueAt(body: unknown, path: string): unknown {
  let cursor: unknown = body;
  for (const segment of path.split(".")) {
    const [name, ...indexes] = segment.split("[");
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[name as string];
    for (const index of indexes) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[Number(index.slice(0, -1))];
    }
  }
  return cursor;
}

/** A path's value as a string, for the fields that are words rather than shapes. */
function stringAt(body: unknown, path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const value = valueAt(body, path);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

/**
 * A word the operator's table does not cover reads `unknown`, never a guess.
 *
 * The alternative — falling back to the word-matching heuristic the feed
 * adapter uses — would quietly invent a severity for a provider whose
 * vocabulary the operator has already described. A gap in the table is a thing
 * to be told about, and `unknown` is how a reading says it.
 */
function statusFor(
  word: string | undefined,
  table: Map<string, OverallStatus>,
): OverallStatus {
  if (word === undefined) return "unknown";
  return table.get(word.trim().toLowerCase()) ?? "unknown";
}

export const jsonAdapter: Adapter = {
  id: "json",
  version: 1,
  kind: "page",

  /**
   * Checked here rather than on every read — roadmap 11.1. The caller is the
   * edition's write path, so a mapping that cannot work is refused while the
   * operator is still looking at the form.
   */
  validateOptions(options: Record<string, string> | undefined): string[] {
    const parsed = optionsSchema.safeParse(options ?? {});
    if (parsed.success) return [];
    return parsed.error.issues.map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    );
  },

  async fetchStatus(
    service: ServiceRef,
    ctx: FetchContext,
  ): Promise<NormalizedStatus> {
    const options = optionsSchema.parse(service.options ?? {});
    const body = await fetchConditional(
      `${service.baseUrl}${options.path ?? ""}`,
      {
        providerId: service.id,
        accept: "application/json",
        timeoutMs: ctx.timeoutMs,
        onRead: ctx.onRead,
        label: "json fetch",
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("json fetch: the response was not JSON");
    }

    const declared = statusFor(
      stringAt(parsed, options.statusPath),
      options.statusMap,
    );
    const activeIncidents: Incident[] = [];

    if (options.incidentsPath !== undefined) {
      const entries = valueAt(parsed, options.incidentsPath);
      if (Array.isArray(entries)) {
        for (const [index, entry] of entries.entries()) {
          const name = stringAt(entry, options.incidentName);
          // An entry with no name is not an incident anybody can act on, and
          // filling one in would put a blank row on the timeline.
          if (name === undefined) continue;
          activeIncidents.push({
            // The provider's own id when it has one, and its position when it
            // does not: an incident has to be identifiable across two reads,
            // or every poll reopens it as a new one.
            id: stringAt(entry, options.incidentId) ?? `${index}`,
            name,
            impact: stringAt(entry, options.incidentImpact) ?? "unknown",
            status: stringAt(entry, options.incidentStatus) ?? "investigating",
            updatedAt:
              stringAt(entry, options.incidentUpdatedAt) ??
              new Date().toISOString(),
          });
        }
      }
    }

    // The declared word and the incidents both get a vote, worst wins — the
    // same rule the feed and Statuspage adapters fold by. A page saying
    // "operational" while listing an open incident is a page mid-update, and
    // reporting the calmer of the two would be reporting the one we know is
    // already out of date.
    const overallStatus =
      activeIncidents.length === 0
        ? declared
        : worstStatus([declared, "degraded"]);

    return {
      provider: service.id,
      overallStatus,
      activeIncidents,
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    };
  },
};
