import { z } from "zod";

/**
 * Validation for a persisted or transported NormalizedStatus. State that has
 * been through a file or a database column is external input like any other, so
 * it is validated rather than trusted on the way back in.
 */

export const incidentSchema = z.object({
  id: z.string(),
  name: z.string(),
  impact: z.string(),
  status: z.string(),
  updatedAt: z.string(),
});

export const componentStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]),
});

export const maintenanceWindowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  componentIds: z.array(z.string()).default([]),
});

export const normalizedStatusSchema = z.object({
  provider: z.string(),
  overallStatus: z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]),
  activeIncidents: z.array(incidentSchema),
  components: z.array(componentStatusSchema).default([]),
  maintenances: z.array(maintenanceWindowSchema).default([]),
  fetchedAt: z.string(),
});

export const dampingStateSchema = z.object({
  signature: z.string(),
  count: z.number().int().positive(),
});

export const providerRuntimeStateSchema = z.object({
  last: normalizedStatusSchema.nullable(),
  failureCount: z.number().int().min(0),
  degradedNotified: z.boolean(),
  // Both defaulted: a state file written before flap damping existed is a
  // valid store, and reading it must not be fatal. Absent means "no baseline
  // of its own yet", which the gate reads as the undamped behaviour.
  notifyBaseline: normalizedStatusSchema.nullable().default(null),
  pending: dampingStateSchema.nullable().default(null),
});
