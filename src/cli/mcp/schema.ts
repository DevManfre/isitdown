import { z } from "zod";
import { overallStatusSchema, providerStatusSchema, statusResponseSchema } from "../watch/schema.ts";

/**
 * The slice of the UI edition's HTTP contract the MCP tools read — the same
 * zod validation `watch` applies (its `/status` schemas are reused as they
 * are, widened by the few fields an assistant needs), and `.passthrough()`
 * for the same reason: the dashboard's payloads grow fields constantly, and
 * a client that rejected one it does not read would break on every addition.
 */

const liveIncidentSchema = z
  .object({ id: z.string(), name: z.string(), impact: z.string(), status: z.string(), updatedAt: z.string() })
  .passthrough();

export const fleetStatusSchema = statusResponseSchema.extend({
  providers: z.array(
    providerStatusSchema.extend({
      activeIncidents: z.array(liveIncidentSchema).optional(),
      uptime90: z.number().optional(),
      suspected: z.unknown().optional(),
      stale: z.unknown().optional(),
      maintenance: z.object({ active: z.array(z.unknown()) }).passthrough().optional(),
    }),
  ),
});

export type FleetStatus = z.infer<typeof fleetStatusSchema>;

/** `GET /history?provider=` — `src/ui/history.ts`, `ProviderHistory`. */
export const providerHistorySchema = z
  .object({
    providerId: z.string(),
    buckets: z.array(z.object({ day: z.string(), status: overallStatusSchema }).passthrough()),
    dailySeries: z.array(z.object({ day: z.string(), uptime: z.number().nullable() }).passthrough()),
    sampleCount: z.number(),
    incidentCount: z.number(),
    downtimeMinutes: z.number(),
  })
  .passthrough();

export type ProviderHistory = z.infer<typeof providerHistorySchema>;

/** One row of `GET /incidents` and `GET /incidents/timeline` — `IncidentRow`. */
const incidentRowSchema = z
  .object({
    providerId: z.string(),
    incidentId: z.string(),
    name: z.string(),
    impact: z.string(),
    startedAt: z.string(),
    resolvedAt: z.string().nullable(),
  })
  .passthrough();

export type IncidentRow = z.infer<typeof incidentRowSchema>;

export const incidentPageSchema = z
  .object({
    page: z.object({ items: z.array(incidentRowSchema), page: z.number(), pageSize: z.number(), total: z.number() }).passthrough(),
  })
  .passthrough();

export const incidentTimelineSchema = z.object({ days: z.number(), incidents: z.array(incidentRowSchema) }).passthrough();

export const annotationsSchema = z
  .object({
    annotations: z.array(
      z.object({ id: z.number(), at: z.string(), label: z.string(), providerId: z.string().nullable() }).passthrough(),
    ),
  })
  .passthrough();

/** Every error the API answers — `{ "error": { "message": "..." } }` (`docs/api.md` §6). */
export const apiErrorSchema = z.object({ error: z.object({ message: z.string() }) });
