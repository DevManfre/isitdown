// `zod/v4` rather than `zod`: the published JSON Schema is generated from this
// definition (`z.toJSONSchema`), which only the v4 API has. Nothing else here
// crosses into the v3 schemas, so the two never meet.
import { z } from "zod/v4";
import { STATUS_CHANGE_KINDS, type NotificationPayload, type StatusChange } from "../core/types.ts";

/**
 * The version of the generic webhook's body — roadmap 7.11.
 *
 * The rule a receiver can rely on: a field is *added* without changing this
 * number, so a receiver must ignore fields it does not know; removing or
 * renaming one, or changing what one means, is version 2 and a new schema file
 * beside this one.
 */
export const WEBHOOK_SCHEMA_VERSION = 1;

/** Where the schema is published, relative to the repository root. */
export const WEBHOOK_SCHEMA_PATH = `schema/webhook-event.v${WEBHOOK_SCHEMA_VERSION}.json`;

const status = z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]);
const isoTime = z.string().describe("ISO 8601, UTC.");

const incident = z.object({
  id: z.string(),
  name: z.string().describe("The provider's own title; empty when it gives none."),
  impact: z.string().describe("The provider's own impact word, e.g. `minor`. Not normalised."),
  status: z.string().describe("The provider's own lifecycle word, e.g. `investigating`. Not normalised."),
  updatedAt: isoTime,
  createdAt: isoTime.optional().describe("When the provider declared it; absent when the page does not say."),
});

const maintenance = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().describe("The provider's own lifecycle word, e.g. `in_progress`. Not normalised."),
  startsAt: isoTime,
  endsAt: isoTime.nullable().describe("Null when the provider declares no end."),
  componentIds: z.array(z.string()).describe("Components it covers; empty means the whole page."),
});

/** One transition from the diff engine, field for field `StatusChange` in `src/core/types.ts`. */
const change = z.object({
  kind: z.enum(STATUS_CHANGE_KINDS),
  providerId: z.string(),
  previousStatus: status.optional().describe("Absent when there is no comparable prior state."),
  currentStatus: status,
  incident: incident.optional().describe("On the incident_* kinds."),
  component: z.object({ id: z.string(), name: z.string() }).optional().describe("On component_status_change."),
  failureCount: z.number().optional().describe("On monitoring_degraded."),
  maintenance: maintenance.optional().describe("On the maintenance_* kinds."),
  openIncidents: z.number().optional().describe("On maintenance_ended: incidents still open as it closed."),
  startsInMinutes: z.number().optional().describe("On maintenance_upcoming: whole minutes until it opens, rounded up."),
  correlated: z
    .object({
      providerIds: z.array(z.string()),
      windowMinutes: z.number(),
      cause: z.string().optional(),
      durationMinutes: z.number().optional(),
    })
    .optional()
    .describe("On correlated_outage and correlated_resolved."),
  crossCheck: z
    .object({
      probeId: z.string(),
      note: z.string().optional(),
      authority: z.enum(["declared", "observed"]).optional(),
    })
    .optional()
    .describe("On silent_outage."),
  sla: z
    .object({
      month: z.string().describe("`YYYY-MM`, UTC."),
      target: z.number(),
      uptime: z.number(),
      budgetMinutes: z.number(),
      spentMinutes: z.number(),
      projectedUptime: z.number(),
    })
    .optional()
    .describe("On sla_burn. Percentages as numbers: 99.9."),
  latency: z
    .object({ latencyMs: z.number(), medianMs: z.number(), thresholdMs: z.number() })
    .optional()
    .describe("On slow_status_page."),
  channel: z
    .object({ id: z.string(), failures: z.number(), since: isoTime, error: z.string().optional() })
    .optional()
    .describe("On channel_failing."),
  report: z
    .object({
      frequency: z.enum(["weekly", "monthly"]),
      from: z.string().describe("`YYYY-MM-DD`, inclusive."),
      to: z.string().describe("`YYYY-MM-DD`, inclusive."),
      fleetUptime: z.number().nullable(),
      incidentCount: z.number(),
      worst: z.array(z.object({ providerId: z.string(), uptime: z.number() })),
      favorites: z.array(z.object({ providerId: z.string(), uptime: z.number().nullable() })).optional(),
      sla: z.array(
        z.object({
          providerId: z.string(),
          target: z.number(),
          spentMinutes: z.number(),
          budgetMinutes: z.number(),
        }),
      ),
    })
    .optional()
    .describe("On periodic_report."),
  at: isoTime,
});

/**
 * The body the generic webhook POSTs: the diff engine's change as it is, the
 * provider it is about, and the rendered message for a receiver that only
 * wants text to show. A receiver that routes on the event reads `change` and
 * never has to parse `message`.
 */
export const webhookEventSchema = z
  .object({
    schemaVersion: z.literal(WEBHOOK_SCHEMA_VERSION),
    change,
    service: z.object({
      id: z.string(),
      name: z.string(),
      statusUrl: z.string().describe("The provider's public status page."),
      impact: z.string().optional().describe("The operator's note: what breaks when it does."),
      owner: z.string().optional().describe("The operator's note: who to call."),
      runbook: z.string().optional().describe("The runbook's first link, or its first line."),
    }),
    message: z.string().describe("The same text every chat channel sends, rendered in the channel's language."),
    chart: z
      .object({ contentType: z.literal("image/svg+xml"), svg: z.string() })
      .optional()
      .describe("The provider's last 24 hours, when the operator turned charts on."),
  })
  .meta({
    $id: `https://github.com/DevManfre/isitdown/blob/main/${WEBHOOK_SCHEMA_PATH}`,
    title: "IsItDown webhook event",
    description:
      "The body of the generic webhook channel. Fields are added without changing schemaVersion; ignore the ones you do not know.",
  });

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

// The schema and the diff engine's type cannot drift apart unnoticed. Every
// change the engine produces must fit the schema (the assignment), and a field
// added to `StatusChange` but not described here fails `Undescribed` — a plain
// assignment would let it through, since TypeScript ignores extra properties
// on anything that is not an object literal.
const _fits: z.infer<typeof change> = {} as StatusChange;
type Undescribed = Exclude<keyof StatusChange, keyof z.infer<typeof change>>;
const _allDescribed: [Undescribed] extends [never] ? true : Undescribed = true;
void _fits;
void _allDescribed;

/** The webhook body for one payload, in the shape the schema publishes. */
export function webhookEvent(payload: NotificationPayload, message: string): WebhookEvent {
  return {
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    change: payload.change,
    service: payload.service,
    message,
    // Absent unless the operator turned charts on (roadmap 3.12), so a receiver
    // that never asked for one sees the body it always saw.
    ...(payload.chart === undefined ? {} : { chart: { contentType: "image/svg+xml", svg: payload.chart.svg } }),
  };
}

/**
 * The JSON Schema committed at `WEBHOOK_SCHEMA_PATH`, generated from the
 * definition above. Objects stay open (no `additionalProperties: false`): a
 * field added later must not break a receiver validating against this file.
 */
export const webhookJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(webhookEventSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
