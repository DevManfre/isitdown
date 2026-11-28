import { z } from "zod";
import { EVENT_CLASSES, SEVERITY_FLOORS } from "./routing.ts";

/**
 * Validation for the parts of the configuration both editions share. The Light
 * edition's file loader and the UI edition's settings writes compose these
 * rather than restating them, so the same entity can never end up with two
 * divergent definitions.
 */

/** The fastest cadence a probe may ask for (roadmap 1.6). */
export const MIN_INTERVAL_SECONDS = 10;

const slug = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "must be a lowercase slug: letters, digits and dashes",
  );

/**
 * What a probe cross-checks: a provider id, optionally narrowed to one of its
 * components with the same `provider#component` form a routing rule targets
 * (roadmap 2.9). The component half only refines what the trust card (roadmap
 * 8.1) compares the probe against — the silent-outage check itself still reads
 * the provider, since a page claiming nothing is wrong is the thing it is about.
 */
const crossCheckTarget = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*(#[A-Za-z0-9][A-Za-z0-9 ._-]*)?$/,
    "must be a provider slug, optionally narrowed with #component",
  );

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
      id: z.string().min(1).describe("The component's id as the provider publishes it."),
      /** Snapshot of the provider's name at selection time; display fallback. */
      name: z.string().trim().min(1)
        .describe("The component's name, shown where the provider's own is unavailable."),
    }),
  )
  .refine(
    (list) =>
      new Set(list.map((component) => component.id)).size === list.length,
    {
      message: "component ids must be unique",
    },
  );

/**
 * A wall-clock time of day, as an operator writes one. Validated as a string
 * rather than parsed into minutes here, because both editions store it as
 * written — a config file an operator can read back is worth more than a
 * normalised number.
 */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a 24-hour time such as 23:00");

/** The weekdays a recurring mute names, in the order a week is read. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const isoInstant = z.string().datetime({ offset: true });

/**
 * One planned mute — roadmap 5.2. Either a single span ("from Friday 18:00 to
 * Monday 08:00") or a weekly window ("every Tuesday 02:00–04:00, Rome time").
 * A weekly window may wrap midnight, like quiet hours: 23:00–01:00 on a
 * Saturday runs into Sunday morning.
 */
export const muteScheduleSchema = z.union([
  z
    .object({
      from: isoInstant.describe("Start of a one-off mute, ISO 8601 with offset."),
      until: isoInstant.describe("End of a one-off mute, ISO 8601 with offset; after from."),
    })
    .strict()
    .refine((span) => Date.parse(span.from) < Date.parse(span.until), {
      message: "until must be after from",
      path: ["until"],
    }),
  z
    .object({
      days: z
        .array(z.enum(WEEKDAYS))
        .min(1)
        .refine((list) => new Set(list).size === list.length, {
          message: "days must be unique",
        }).describe("Weekdays a weekly mute runs on: mon, tue, wed, thu, fri, sat, sun."),
      start: clockTime.describe("Start of a weekly mute, 24-hour HH:MM."),
      end: clockTime.describe("End of a weekly mute, 24-hour HH:MM; may wrap past midnight."),
      /** An IANA zone name, or "auto" for the zone the process runs in. */
      timeZone: z.string().trim().max(64).default("auto")
        .describe("IANA time zone the weekly window is read in, or \"auto\" for the process's own. Default auto."),
    })
    .strict()
    .refine((window) => window.start !== window.end, {
      message: "end must differ from start",
      path: ["end"],
    }),
]);

export const muteSchedulesSchema = z.array(muteScheduleSchema).max(20);

/**
 * One maintenance window the operator declared — roadmap 5.3. Unlike a
 * provider's own it always has an end: a window with none would rely on a
 * lifecycle word nobody is going to update, and silence the provider forever.
 */
export const operatorMaintenanceWindowSchema = z
  .object({
    title: z.string().trim().max(120).default("").describe("What the maintenance is, shown on the timeline."),
    startsAt: isoInstant.describe("When the window opens, ISO 8601 with offset."),
    endsAt: isoInstant.describe("When the window closes, ISO 8601 with offset; after startsAt."),
  })
  .strict()
  .refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export const operatorMaintenanceWindowsSchema = z
  .array(operatorMaintenanceWindowSchema)
  .max(50);

export const serviceDefinitionSchema = z.object({
  id: slug.describe("Unique lowercase slug for this provider (letters, digits, dashes)."),
  name: z.string().trim().min(1).describe("Display name."),
  adapter: slug
    .describe("How the page is read: statuspage, rss, html, http, tcp, dns and others (see docs/configuration.md)."),
  baseUrl: httpUrl.describe("The status page or endpoint URL, http or https."),
  enabled: z.boolean().default(true).describe("false keeps the entry but stops polling it. Default true."),
  /**
   * The group this provider belongs to — "my stack" (roadmap 2.6). A slug, so
   * a routing rule can name it (`group:deploy-path`) and both editions write it
   * the same way. Optional rather than defaulted: a fleet is a flat list until
   * an operator says otherwise, and "no group" has to stay distinguishable from
   * a group that happens to be called something.
   */
  group: slug.optional()
    .describe("Slug of the group this provider belongs to; routing can target group:<slug>."),
  /**
   * The providers this one runs on, declared by the operator and never
   * inferred (roadmap 2.9). When several providers go bad together, a shared
   * upstream named here is what the shared-failure alert calls the probable
   * cause. Slugs, not checked against the fleet: an upstream you do not
   * monitor (a cloud you only depend on) is still worth naming.
   */
  dependsOn: z.array(slug).min(1).max(20).optional()
    .describe("Ids of providers this one runs on, named as the probable cause of a shared failure."),
  /**
   * Only on a probe (`http`, `tcp`, `dns`) or a mailbox reading (`imap`,
   * roadmap 1.4): the provider whose status page this probe is a second
   * opinion on — silent-outage cross-check (roadmap 1.10).
   * When the probe cannot reach the service and that provider's page still
   * reports operational, the disagreement is itself the news.
   *
   * On the probe rather than on the provider because the probe is the thing
   * that knows what it is checking: a page can have several probes pointed at
   * it, and none of them is the page's own business.
   */
  crossChecks: crossCheckTarget.optional()
    .describe("Probes and imap only: the provider (optionally provider#component) whose page this is a second opinion on."),
  /** Omitted, not defaulted: absent has to stay distinguishable from "same as the global". */
  intervalMinutes: z.number().int().positive().max(1440).optional()
    .describe("This provider's own cadence, 1–1440; omit to follow pollIntervalMinutes."),
  /**
   * A cadence in seconds, for a probe only — roadmap 1.6. A status page
   * publishes on a human's schedule and reading it more than once a minute
   * buys nothing, but an endpoint can be down for thirty seconds and a probe on
   * the minute floor would never see it. Ten seconds is the floor: below it
   * the request timeout and its retries are longer than the cadence itself.
   *
   * Which adapters may carry it, and that it excludes `intervalMinutes`, is
   * `cadenceProblems`' business: the schema cannot see the adapter registry.
   */
  intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(3600).optional()
    .describe("Probes only: cadence in seconds, 10–3600. Never together with intervalMinutes."),
  options: z.record(z.string()).optional()
    .describe("Adapter-specific settings, as strings (see the adapter's section in docs/configuration.md)."),
  /**
   * ISO 8601, UTC. While it is in the future the provider notifies nothing —
   * "I know, stop telling me, for two hours". Optional rather than defaulted:
   * absent is the normal state, and it reads differently from a mute that has
   * expired but is still recorded.
   */
  mutedUntil: z.string().datetime().optional()
    .describe("ISO 8601 UTC time until which this provider notifies nothing."),
  components: componentSelectionSchema.default([])
    .describe("Components to watch, each with its id and name; empty watches the whole page."),
  scopeToComponents: z.boolean().default(false)
    .describe("true derives the provider's status from the selected components only. Default false."),
  /**
   * A star (roadmap 5.14): listed first, always on the wallboard, always in the
   * weekly summary. Absent reads as not starred, so a file that never heard of
   * it behaves exactly as before.
   */
  favorite: z.boolean().optional()
    .describe("Star the provider: listed first and always in the weekly summary."),
  /**
   * The monthly uptime this provider is supposed to deliver, as a percentage —
   * `99.9` (roadmap 4.13). Optional rather than defaulted: most providers are
   * watched without anybody having promised anything, and a default would
   * invent a promise and then report against it.
   *
   * Floored at 50 and capped at 100. Below half the month, a "target" is not
   * one; and the samples this is measured from are polls, so a figure with more
   * than three decimals is claiming a precision a three-minute cadence does not
   * have.
   */
  slaTarget: z.number().min(50).max(100).optional()
    .describe("Promised monthly uptime in percent, 50–100 (e.g. 99.9)."),
  /**
   * What an hour of this provider being down costs the operator, in whatever
   * currency they think in — roadmap 6.3. Optional rather than defaulted for the
   * same reason as `slaTarget`: a default would put an invented figure beside
   * every incident. A bare number, no currency code: the figure is the
   * operator's own estimate and nothing here converts or sums across currencies.
   */
  outageCostPerHour: z.number().positive().max(1_000_000_000).optional()
    .describe("What an hour of outage costs you, as a bare number in your own currency."),
  /**
   * Which source is the record for this provider — roadmap 9.1. `declared` is
   * the provider's own page, `observed` is our own reading.
   *
   * Optional rather than defaulted, and deliberately so: absent means "whatever
   * this adapter implies", so a probe stays `observed` and a status page stays
   * `declared` without every row having to repeat it — and a row written today
   * does not freeze today's rule into itself. `src/core/authority.ts` is
   * where the rule lives; this is only where an operator overrides it.
   */
  authority: z.enum(["declared", "observed"]).optional()
    .describe("Override whether this source is declared (the provider's word) or observed (our own reading)."),
  /**
   * What breaks when this provider does, and who answers for it — roadmap 3.7.
   * One sentence and one name, carried into every message: bounded so a
   * paragraph pasted here cannot turn every alert into a page of text.
   */
  impact: z.string().trim().min(1).max(200).optional()
    .describe("What breaks when this provider does, one sentence carried into every message."),
  owner: z.string().trim().min(1).max(80).optional()
    .describe("Who answers for this provider, carried into every message."),
  /**
   * What to do when this provider is down — roadmap 5.1. Markdown, written by
   * the operator, shown on the provider's page and linked from every message
   * about it. About the provider rather than about one incident, which is what
   * an incident note is for. Bounded so it stays a runbook and not a wiki.
   */
  runbook: z.string().trim().min(1).max(4000).optional()
    .describe("What to do when it is down, in Markdown; linked from every message."),
  /**
   * Free labels beside the single group — roadmap 5.4. A provider sits in one
   * group but carries any number of tags (`paid`, `critical`, `eu`), each one
   * a slug so a routing rule can name it as `tag:critical`.
   */
  tags: z
    .array(slug)
    .max(20)
    .refine((list) => new Set(list).size === list.length, {
      message: "tags must be unique",
    })
    .optional()
    .describe("Free lowercase labels; routing can target tag:<slug>."),
  /**
   * Mutes the operator planned rather than pressed — roadmap 5.2. Each one is
   * either a single future span or a weekly window; while any runs, the
   * provider is muted exactly as `mutedUntil` mutes it.
   */
  muteSchedules: muteSchedulesSchema.optional().describe("Planned mutes: one-off spans or weekly windows."),
  /**
   * Maintenance the operator declares because the provider does not — roadmap
   * 5.3. Merged into every reading as if the page had published it, so it
   * silences, notifies and draws on the timeline the same way.
   */
  maintenanceWindows: operatorMaintenanceWindowsSchema.optional()
    .describe("Maintenance you declare for this provider, treated as if its page had published it."),
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
  /**
   * Correlated-outage detection (roadmap 2.7): how many providers have to go
   * bad inside `correlationWindowMinutes` before the cycle reports one shared
   * failure instead of one alert each. 0 and 1 are off, which is the default —
   * this is the only feature here that *replaces* alerts, and an operator has
   * to ask for that rather than discover it during an incident.
   */
  correlationThreshold: z.number().int().min(0).max(100).default(0),
  /**
   * How wide that window is. Wider catches a slow-moving shared failure and
   * risks folding two unrelated bad days into one; the default is about as
   * long as a Cloudflare event takes to show up across several status pages.
   */
  correlationWindowMinutes: z.number().int().positive().max(1440).default(10),
});

export const localeSchema = z
  .string()
  .regex(
    /^[a-z]{2}(-[a-z0-9]+)*$/,
    "must be a lowercase locale tag such as en or pt-br",
  )
  .default("en");

/**
 * One routing rule, shared by the Light edition's `routing:` block and the UI
 * edition's `routing_rules` rows, so the two editions cannot disagree about
 * what a valid rule is. Order is the array's order — there is no position
 * field to contradict it.
 */
/**
 * A rule's target, which is not simply a provider id: `group:<slug>` covers a
 * whole stack (roadmap 2.6) and `<provider>#<component>` covers one component of
 * one provider (roadmap 2.9). Both were evaluated by `core/routing.ts` before
 * this schema knew about them, which meant a `group:` rule written into a Light
 * `config.yml` was rejected at load — so the two forms are spelled out here, in
 * the one place both editions validate a rule through.
 *
 * A component id is the provider's, not ours: Statuspage writes hex, Better
 * Stack and Uptime Kuma write numbers, and a scraper writes whatever the page
 * called it. The charset is therefore wide where the provider half stays a slug.
 */
const groupTarget = z
  .string()
  .regex(
    /^group:[a-z0-9][a-z0-9-]*$/,
    "must be group: followed by a lowercase slug",
  );

const tagTarget = z
  .string()
  .regex(/^tag:[a-z0-9][a-z0-9-]*$/, "must be tag: followed by a lowercase slug");

const componentTarget = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*#[A-Za-z0-9._:-]{1,128}$/,
    "must be a provider id, then #, then the component id the provider publishes",
  );

export const routingRuleSchema = z.object({
  provider: z.union([z.literal("*"), groupTarget, tagTarget, componentTarget, slug])
    .describe("Which changes the rule matches: a service id, group:<slug>, tag:<slug>, <id>#<component>, or \"*\"."),
  classes: z.array(z.enum(EVENT_CLASSES)).default([...EVENT_CLASSES])
    .describe("Event classes matched: status, incident, maintenance, monitoring. Default all."),
  minSeverity: z.enum(SEVERITY_FLOORS).default("any")
    .describe("Lowest severity matched: any, degraded, partial_outage, major_outage. Default any."),
  /** `["*"]` means every enabled channel; `[]` mutes. */
  channels: z.array(z.union([z.literal("*"), slug])).default(["*"])
    .describe("Channel ids to send to, \"*\" for every enabled channel, or [] to mute. Default [\"*\"]."),
});

export const routingRulesSchema = z.array(routingRuleSchema);

/**
 * Quiet hours (roadmap 3.11). The floor defaults to `major_outage` rather than
 * to `any`: an operator who switches quiet hours on and configures nothing else
 * means "wake me only for something serious", not "wake me for everything".
 */
export const quietHoursSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Hold back changes below minSeverity during the window. Default false."),
  start: clockTime.default("23:00").describe("Window start, 24-hour HH:MM (inclusive). Default 23:00."),
  end: clockTime.default("07:00")
    .describe("Window end, 24-hour HH:MM (exclusive); may wrap midnight. Default 07:00."),
  /** An IANA zone name, or "auto" for the zone the process runs in. */
  timeZone: z.string().trim().max(64).default("auto")
    .describe("IANA time zone the window is read in, or \"auto\" for the process's own. Default auto."),
  minSeverity: z.enum(SEVERITY_FLOORS).default("major_outage")
    .describe("Severity that still gets through inside the window. Default major_outage."),
});

/**
 * Digest mode (roadmap 3.12). The window is capped at a day and floored at a
 * minute: below a minute it batches nothing (the poll cadence is longer), and
 * beyond a day a "digest" is a report nobody is waiting for.
 */
export const digestSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Batch changes below immediateFloor into one message per window. Default false."),
  windowMinutes: z.number().int().positive().max(1440).default(15)
    .describe("Length of the digest window in minutes, 1–1440. Default 15."),
  immediateFloor: z.enum(SEVERITY_FLOORS).default("major_outage")
    .describe("Severity sent at once instead of batched. Default major_outage."),
});

/** Per-provider alert cap (roadmap 3.13). */
export const alertCapSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Cap the messages per provider per rolling hour. Default false."),
  maxPerHour: z.number().int().positive().max(1000).default(10)
    .describe("Most changes per provider per hour, 1–1000. Default 10."),
});

/**
 * The delivery policy as a whole, shared by the Light edition's `delivery:`
 * block and the UI edition's settings rows, so the two editions cannot disagree
 * about what a valid policy is.
 */
/**
 * Heads-up before a declared maintenance window (roadmap 3.3). Capped at a week:
 * providers publish windows days ahead, but a notice a fortnight early is one
 * nobody still remembers when the day comes.
 */
export const maintenanceNoticeSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Announce a declared maintenance window before it opens. Default false."),
  leadMinutes: z.number().int().positive().max(10_080).default(120)
    .describe("How long before the window to announce it, in minutes, 1–10080. Default 120."),
});

/**
 * Escalation (roadmap 3.2). Capped at a day: a change nobody has answered in
 * twenty-four hours is not an escalation, it is a different problem. `channel`
 * is a free string rather than a channel enum — which channels exist is the
 * configuration's business, and a stale name is caught where the escalation
 * runs, with the channel in the message, not here with a bare enum error.
 */
export const escalationSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Resend an unacknowledged change on another channel. UI edition only. Default false."),
  afterMinutes: z.number().int().positive().max(1440).default(15)
    .describe("Minutes without acknowledgement before escalating, 1–1440. Default 15."),
  channel: z.string().trim().max(64).default("").describe("The channel id the escalation goes to."),
  minSeverity: z.enum(SEVERITY_FLOORS).default("major_outage")
    .describe("Lowest severity that escalates. Default major_outage."),
});

/**
 * Say so on another channel when one keeps failing (roadmap 3.4). Floored at
 * two: one failed message is a blip the retries already absorbed, and an alert
 * on every one would be noise about noise.
 */
export const channelHealthSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Tell the other channels when one keeps failing. Default false."),
  afterFailures: z.number().int().min(2).max(100).default(3)
    .describe("Failed messages in a row before saying so, 2–100. Default 3."),
});

/** One summary when a shared failure ends (roadmap 3.10). */
export const incidentSummarySchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Replace the resolved messages of a shared failure with one summary. Default false."),
});

/**
 * Wait for the incident's last update (roadmap 3.11). Capped at an hour: past
 * that the "latest state" is stale news, and the escalation clock is running.
 */
export const coalesceSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Send only the latest of a run of updates to the same incident. Default false."),
  windowMinutes: z.number().int().positive().max(60).default(2)
    .describe("How long an update waits for a newer one, in minutes, 1–60. Default 2."),
});

/** Quiet updates during an outage already announced (roadmap 3.14). */
export const knownOutageSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Batch further updates of an incident already in major outage into the digest. Default false."),
});

/**
 * The periodic report (roadmap 3.13). Weekly or monthly only: a daily one is a
 * digest, which already exists, and anything in between is a calendar nobody
 * asked for.
 */
export const reportSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Send the fleet's weekly or monthly report. UI edition only. Default false."),
  frequency: z.enum(["weekly", "monthly"]).default("weekly").describe("weekly or monthly. Default weekly."),
  channel: z.string().trim().max(64).default("").describe("The channel id the report goes to."),
});

/**
 * Who is on call (roadmap 3.15). A rotation of recipients that already exist —
 * this is not a roster, only "which of them hears a major this week". Weeks
 * run Monday to Sunday, UTC, counted from `startsOn`; a rotation of one is
 * allowed (it is "always this person"). `rotation` holds recipient ids, whose
 * existence is checked where both editions know their recipients, like routing
 * rules do for channels.
 */
export const onCallSchema = z.object({
  enabled: z.boolean().default(false).describe("Also notify whoever is on call this week. Default false."),
  minSeverity: z.enum(SEVERITY_FLOORS).default("major_outage")
    .describe("Lowest severity the on-call person hears. Default major_outage."),
  rotation: z.array(z.string().trim().min(1).max(64)).max(32).default([])
    .describe("Recipient ids taking turns, one per week (Monday to Sunday, UTC)."),
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startsOn must be a YYYY-MM-DD date")
    .or(z.literal(""))
    .default("")
    .describe("Any day of the rotation's first week, YYYY-MM-DD."),
});

/**
 * The routine delivery test (roadmap 3.16): once a week every enabled channel
 * gets a message that says it is a test. Weekly only — a daily one trains the
 * team to ignore it, which defeats the point.
 */
export const deliveryTestSchema = z.object({
  enabled: z.boolean().default(false)
    .describe("Send every enabled channel a routine test message once a week. Default false."),
});

export const deliverySchema = z.object({
  quietHours: quietHoursSchema.default({}).describe("Hours when only serious changes get through."),
  digest: digestSchema.default({}).describe("Batch non-urgent changes into one message per window."),
  cap: alertCapSchema.default({}).describe("A ceiling on messages per provider per hour."),
  updateInPlace: z.boolean().default(false)
    .describe("Edit one message per incident instead of sending one per update, where the channel can. Default false."),
  maintenanceNotice: maintenanceNoticeSchema.default({})
    .describe("A heads-up before a declared maintenance window opens."),
  escalation: escalationSchema.default({}).describe("Resend an unacknowledged change on another channel."),
  channelHealth: channelHealthSchema.default({}).describe("An alert when a channel keeps failing."),
  incidentSummary: incidentSummarySchema.default({}).describe("One summary when a shared failure ends."),
  coalesce: coalesceSchema.default({}).describe("Collapse a run of updates to the same incident."),
  knownOutage: knownOutageSchema.default({}).describe("Quiet updates during an outage already announced."),
  report: reportSchema.default({}).describe("A weekly or monthly fleet report on one channel."),
  onCall: onCallSchema.default({}).describe("A weekly on-call rotation of recipients."),
  deliveryTest: deliveryTestSchema.default({}).describe("A weekly routine test message on every channel."),
  attachChart: z.boolean().default(false)
    .describe("Attach the provider's last 24 hours as an SVG chart, on email and webhook. UI edition only. Default false."),
});

/**
 * One recipient (roadmap 3.5): channels in order of preference. At least two —
 * a recipient with one channel is that channel — and each named once, because
 * falling back to the channel that just failed is a retry, not a fallback.
 * Whether the channels exist is checked where both editions know their channel
 * list, like a routing rule's.
 */
export const recipientSchema = z.object({
  id: slug.describe("Unique lowercase slug for this person, used in routing and on-call rotations."),
  name: z.string().trim().min(1).max(80).describe("The person's name."),
  channels: z
    .array(slug)
    .min(2, "a recipient needs at least two channels")
    .max(10)
    .refine((channels) => new Set(channels).size === channels.length, {
      message: "a channel can appear only once in a recipient",
    }).describe("Channel ids in order of preference, at least two, each once."),
});

/**
 * Every recipient, with the one rule a single recipient cannot check: a channel
 * belongs to at most one of them. Two recipients sharing a channel would each
 * collapse it differently, and which fallback a failure took would depend on
 * the order they happened to be read in.
 */
export const recipientsSchema = z
  .array(recipientSchema)
  .max(50)
  .superRefine((recipients, ctx) => {
    const ids = new Set<string>();
    const owner = new Map<string, string>();
    recipients.forEach((recipient, index) => {
      if (ids.has(recipient.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `recipient id "${recipient.id}" is used twice` });
      }
      ids.add(recipient.id);
      for (const channel of recipient.channels) {
        const other = owner.get(channel);
        if (other !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "channels"],
            message: `channel "${channel}" already belongs to recipient "${other}"`,
          });
        }
        owner.set(channel, recipient.id);
      }
    });
  });
