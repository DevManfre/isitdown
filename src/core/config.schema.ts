import { z } from "zod";
import { EVENT_CLASSES, SEVERITY_FLOORS } from "./routing.ts";

/**
 * Validation for the parts of the configuration both editions share. The Light
 * edition's file loader and the UI edition's settings writes compose these
 * rather than restating them, so the same entity can never end up with two
 * divergent definitions.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug: letters, digits and dashes");

const httpUrl = z
  .string()
  .trim()
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === "http:" || url.protocol === "https:";
    },
    { message: "must be an http or https URL" },
  )
  // A trailing slash would double up when an adapter appends its endpoint path.
  .transform((value) => value.replace(/\/+$/, ""));

export const componentSelectionSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      /** Snapshot of the provider's name at selection time; display fallback. */
      name: z.string().trim().min(1),
    }),
  )
  .refine((list) => new Set(list.map((component) => component.id)).size === list.length, {
    message: "component ids must be unique",
  });

export const serviceDefinitionSchema = z.object({
  id: slug,
  name: z.string().trim().min(1),
  adapter: slug,
  baseUrl: httpUrl,
  enabled: z.boolean().default(true),
  /**
   * The group this provider belongs to — "my stack" (roadmap 2.6). A slug, so
   * a routing rule can name it (`group:deploy-path`) and both editions write it
   * the same way. Optional rather than defaulted: a fleet is a flat list until
   * an operator says otherwise, and "no group" has to stay distinguishable from
   * a group that happens to be called something.
   */
  group: slug.optional(),
  /** Omitted, not defaulted: absent has to stay distinguishable from "same as the global". */
  intervalMinutes: z.number().int().positive().max(1440).optional(),
  options: z.record(z.string()).optional(),
  /**
   * ISO 8601, UTC. While it is in the future the provider notifies nothing —
   * "I know, stop telling me, for two hours". Optional rather than defaulted:
   * absent is the normal state, and it reads differently from a mute that has
   * expired but is still recorded.
   */
  mutedUntil: z.string().datetime().optional(),
  components: componentSelectionSchema.default([]),
  scopeToComponents: z.boolean().default(false),
});

export const pollingSchema = z.object({
  intervalMinutes: z.number().int().positive().max(1440).default(3),
  requestTimeoutSeconds: z.number().int().positive().max(120).default(8),
  maxRetries: z.number().int().positive().max(10).default(3),
  failureThreshold: z.number().int().positive().max(100).default(5),
  /**
   * Watch a provider closely while it is having a bad day, and leave it alone
   * once it is not. On by default: an incident is the one time the configured
   * cadence is too slow, and the traffic it costs is bounded by how long the
   * incident lasts.
   */
  adaptivePolling: z.boolean().default(true),
  /**
   * The cadence a provider with an open incident (or a status worse than
   * operational) is polled on instead of its own. Never slower than what the
   * provider already asked for — the poller takes the shorter of the two — so
   * raising this can only ever mean "less closely".
   */
  adaptiveIntervalMinutes: z.number().int().positive().max(1440).default(1),
  /**
   * Flap damping: how many consecutive polls must agree on a reading before a
   * transition notifies. 1 is off, and off is the default — damping trades
   * latency for trust, and which side of that an operator wants depends on
   * their providers. Capped low: anything past a handful of polls is a mute
   * with extra steps.
   */
  confirmSamples: z.number().int().positive().max(10).default(1),
});

export const localeSchema = z
  .string()
  .regex(/^[a-z]{2}(-[a-z0-9]+)*$/, "must be a lowercase locale tag such as en or pt-br")
  .default("en");

/**
 * One routing rule, shared by the Light edition's `routing:` block and the UI
 * edition's `routing_rules` rows, so the two editions cannot disagree about
 * what a valid rule is. Order is the array's order — there is no position
 * field to contradict it.
 */
export const routingRuleSchema = z.object({
  provider: z.union([z.literal("*"), slug]),
  classes: z.array(z.enum(EVENT_CLASSES)).default([...EVENT_CLASSES]),
  minSeverity: z.enum(SEVERITY_FLOORS).default("any"),
  /** `["*"]` means every enabled channel; `[]` mutes. */
  channels: z.array(z.union([z.literal("*"), slug])).default(["*"]),
});

export const routingRulesSchema = z.array(routingRuleSchema);

/**
 * A wall-clock time of day, as an operator writes one. Validated as a string
 * rather than parsed into minutes here, because both editions store it as
 * written — a config file an operator can read back is worth more than a
 * normalised number.
 */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a 24-hour time such as 23:00");

/**
 * Quiet hours (roadmap 3.11). The floor defaults to `major_outage` rather than
 * to `any`: an operator who switches quiet hours on and configures nothing else
 * means "wake me only for something serious", not "wake me for everything".
 */
export const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: clockTime.default("23:00"),
  end: clockTime.default("07:00"),
  /** An IANA zone name, or "auto" for the zone the process runs in. */
  timeZone: z.string().trim().max(64).default("auto"),
  minSeverity: z.enum(SEVERITY_FLOORS).default("major_outage"),
});

/**
 * Digest mode (roadmap 3.12). The window is capped at a day and floored at a
 * minute: below a minute it batches nothing (the poll cadence is longer), and
 * beyond a day a "digest" is a report nobody is waiting for.
 */
export const digestSchema = z.object({
  enabled: z.boolean().default(false),
  windowMinutes: z.number().int().positive().max(1440).default(15),
  immediateFloor: z.enum(SEVERITY_FLOORS).default("major_outage"),
});

/** Per-provider alert cap (roadmap 3.13). */
export const alertCapSchema = z.object({
  enabled: z.boolean().default(false),
  maxPerHour: z.number().int().positive().max(1000).default(10),
});

/**
 * The delivery policy as a whole, shared by the Light edition's `delivery:`
 * block and the UI edition's settings rows, so the two editions cannot disagree
 * about what a valid policy is.
 */
export const deliverySchema = z.object({
  quietHours: quietHoursSchema.default({}),
  digest: digestSchema.default({}),
  cap: alertCapSchema.default({}),
  updateInPlace: z.boolean().default(false),
});
