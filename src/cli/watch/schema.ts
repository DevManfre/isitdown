import { z } from "zod";

/**
 * The slice of the UI edition's HTTP contract this client actually reads —
 * validated the same way any other external input is (project convention),
 * even though the "external" service here is this same codebase's own
 * server. `.passthrough()` everywhere: the dashboard's `/status` and
 * `/events` payloads grow fields for the dashboard's own views constantly,
 * and a client that rejected an unrecognised field would break on every one
 * of those additions instead of just ignoring what it doesn't render.
 */

export const overallStatusSchema = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "unknown",
]);

export type OverallStatus = z.infer<typeof overallStatusSchema>;

export const providerStatusSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    overallStatus: overallStatusSchema,
    fetchedAt: z.string().nullable(),
  })
  .passthrough();

export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const statusResponseSchema = z
  .object({
    providers: z.array(providerStatusSchema),
    serverNow: z.string(),
  })
  .passthrough();

export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** `hello`, sent once when a stream connects — src/ui/routes/events.routes.ts. */
export const helloEventSchema = z
  .object({
    lastPollAt: z.string().nullable(),
    nextPollAt: z.string().nullable(),
    serverNow: z.string(),
  })
  .passthrough();

export type HelloEvent = z.infer<typeof helloEventSchema>;

/** `cycle`, sent once a poll cycle finishes — src/ui/liveEvents.ts. */
export const cycleEventSchema = z
  .object({
    startedAt: z.string(),
    finishedAt: z.string(),
    serverNow: z.string(),
    providers: z.number(),
    failed: z.number(),
    changedProviders: z.array(z.string()),
  })
  .passthrough();

export type CycleEvent = z.infer<typeof cycleEventSchema>;
