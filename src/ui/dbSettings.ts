/**
 * The `settings` table: one typed `Settings` read and the patch that writes it
 * back, so the dashboard and the poller see the same defaults.
 */

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { THEME_MODES, type ThemeMode } from "./themeModes.ts";
import { AI_PROVIDERS } from "./aiSettings.ts";
import { localeSchema } from "../core/config.schema.ts";
import type { Logger } from "../core/logger.ts";
import { SEVERITY_FLOORS } from "../core/routing.ts";

export const ENV_SUFFIX = "Env";

/**
 * Every setting is a string in SQLite, so a flag comes back as "true"/"false".
 * Stated once here: three of the rows below are flags, and three hand-written
 * transforms is three chances for one of them to read a missing row as true.
 */
const booleanSetting = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/**
 * A list of slugs, stored comma-joined — roadmap 4.24's fleet and group
 * orders. Comma-joined rather than JSON because that is exactly what
 * `writeSettings`' `String(value)` makes of an array, so the read-back
 * comparison in `readSettings` holds and an empty list is the empty row.
 * Safe because a slug carries no comma (`config.schema.ts`).
 */
const slugListSetting = z
  .string()
  .transform((value) => (value === "" ? [] : value.split(",")))
  .pipe(z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)));

/** A 24-hour wall clock time, the shape `quietHoursSchema` accepts. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export type ThemePreference = ThemeMode;

/** Longest instance name the header has room for before it truncates anyway. */
export const INSTANCE_NAME_MAX = 40;

/**
 * `#rrggbb` or nothing. A named colour or a `var(...)` would be written into a
 * stylesheet the operator never reviews, so the one shape that cannot carry
 * anything but a colour is the only one stored.
 */
export const accentColor = z.union([z.string().regex(/^#[0-9a-f]{6}$/i), z.literal("")]);

/**
 * An address the browser can load an image from: absolute http(s), or a path on
 * this same host. Never `javascript:` or `data:` — the value lands in an
 * `<img src>` that every viewer's browser fetches.
 */
export const logoUrl = z.union([
  z
    .string()
    .max(500)
    .refine((value) => {
      if (value.startsWith("/") && !value.startsWith("//")) return true;
      try {
        const { protocol } = new URL(value);
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    }),
  z.literal(""),
]);

const settingsSchema = z.object({
  pollIntervalMinutes: z.coerce.number().int().positive().max(1440).catch(3),
  requestTimeoutSeconds: z.coerce.number().int().positive().max(120).catch(8),
  maxRetries: z.coerce.number().int().positive().max(10).catch(3),
  failureThreshold: z.coerce.number().int().positive().max(100).catch(5),
  /**
   * Watch a provider closely while it has an open incident (roadmap 2.3). On
   * by default, so an installation upgrading into this gets the behaviour
   * without having to find the switch. Stored as a string like every other
   * setting, so "true"/"false" is what comes back out.
   */
  adaptivePolling: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .catch(true),
  adaptiveIntervalMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(1440)
    .catch(1),
  /**
   * Flap damping (roadmap 2.5): consecutive polls that must agree before a
   * transition notifies. Off by default — one sample is what every existing
   * installation has been running on, and turning damping on for them without
   * being asked would delay alerts they already trust.
   */
  confirmSamples: z.coerce.number().int().positive().max(10).catch(1),
  /**
   * Correlated-outage detection (roadmap 2.7): how many providers have to go
   * bad inside the window before one shared failure is reported instead of one
   * alert each. Off by default — it is the only setting here that *replaces*
   * alerts, and an installation must not discover that mid-incident.
   */
  correlationThreshold: z.coerce.number().int().min(0).max(100).catch(0),
  correlationWindowMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(1440)
    .catch(10),
  /**
   * How long history is kept. Four months by default — a month beyond the
   * 90-day view, so a full window is always available — and up to ten years for
   * anyone who wants year-on-year comparisons more than they want the disk.
   */
  retentionDays: z.coerce.number().int().min(7).max(3650).catch(120),
  theme: z.enum(THEME_MODES).catch("system"),
  /**
   * Instance identity (roadmap 4.19): the accent colour, the name and the logo
   * a dashboard on an office monitor — or a public page — carries as its own.
   * Empty means "the product's own", so a fresh install and a cleared field are
   * the same thing, and each falls back on its own rather than together.
   */
  accentColor: accentColor.catch(""),
  instanceName: z.string().trim().max(INSTANCE_NAME_MAX).catch(""),
  logoUrl: logoUrl.catch(""),
  /**
   * Which zone clock times are rendered in. `auto` — the default — is the
   * browser's own, which is why the preference is stored as a name rather than
   * an offset: an offset is wrong twice a year, and "auto" has to stay
   * per-machine rather than pin every browser to the one that set it.
   */
  timeZone: z.string().max(64).catch("auto"),
  uiLocale: localeSchema.catch("en"),
  notificationLocale: localeSchema.catch("en"),
  /**
   * Which geographic view the Overview draws, if any. `off` is the default
   * because a fleet of functional-component providers has nothing to place, and
   * an empty world map is worse than no card.
   */
  mapView: z.enum(["off", "map", "globe"]).catch("off"),
  /**
   * How tightly the fleet lists pack — roadmap 13.1. `comfortable` is the
   * layout the dashboard has always had; `compact` trades the breathing room
   * for rows on screen, which is the trade an operator with a hundred providers
   * is already making by scrolling.
   *
   * A stored preference rather than a viewport rule: it is about how many
   * providers there are, not how big the window is, and a laptop watching a
   * hundred of them wants compact at any width.
   */
  density: z.enum(["comfortable", "compact"]).catch("comfortable"),
  /**
   * The operator's own order for the fleet and its groups — roadmap 4.24.
   * Empty is the automatic order. Stored on the instance rather than in the
   * browser, because the wallboard on the office screen has to agree with
   * the laptop that arranged it.
   */
  fleetOrder: slugListSetting.catch([]),
  groupOrder: slugListSetting.catch([]),
  /**
   * First-run wizard and guided tour — roadmap 4.5 and 4.6. Instance
   * preferences, not browser ones: an installation is set up once, and a
   * second browser must not walk the operator through it again.
   */
  wizardDone: booleanSetting.catch(false),
  tourSeen: booleanSetting.catch(false),
  /**
   * When the operator last said "I have seen it" on the Overview's "while you
   * were away" summary — roadmap 4.4. An instance preference rather than a
   * browser one: the summary is about what this installation saw, and a second
   * browser must not replay a weekend somebody has already read. Empty is
   * "never", which is not a date to count from.
   */
  lastSeenAt: z.union([z.string().datetime(), z.literal("")]).catch(""),

  /**
   * Quiet hours (roadmap 3.11). Stored as five flat rows like every other
   * setting rather than as one JSON blob, so a value that cannot be read falls
   * back on its own instead of taking the other four with it.
   */
  quietHoursEnabled: booleanSetting.catch(false),
  // Shape-checked here as well as in the shared schema: `deliverySchema` is a
  // hard parse, so a row holding "25:00" — hand-edited, or written by a version
  // that validated less — would take the whole configuration load down with it.
  quietHoursStart: clockTime.catch("23:00"),
  quietHoursEnd: clockTime.catch("07:00"),
  quietHoursTimeZone: z.string().max(64).catch("auto"),
  quietHoursMinSeverity: z.enum(SEVERITY_FLOORS).catch("major_outage"),

  /** Digest mode (roadmap 3.12). */
  digestEnabled: booleanSetting.catch(false),
  digestWindowMinutes: z.coerce.number().int().positive().max(1440).catch(15),
  digestImmediateFloor: z.enum(SEVERITY_FLOORS).catch("major_outage"),

  /** Per-provider alert cap (roadmap 3.13). */
  alertCapEnabled: booleanSetting.catch(false),
  alertCapPerHour: z.coerce.number().int().positive().max(1000).catch(10),

  /**
   * Edit one message per incident instead of sending one per update (roadmap
   * 3.19). Off by default: an installation used to a message per update would
   * otherwise watch its channel history collapse without having asked.
   */
  updateInPlace: booleanSetting.catch(false),
  /** Heads-up before a declared maintenance window (roadmap 3.3). */
  maintenanceNoticeEnabled: booleanSetting.catch(false),
  maintenanceNoticeLeadMinutes: z.coerce.number().int().positive().max(10_080).catch(120),
  /** Say a change again, elsewhere, when nobody took it in charge (roadmap 3.2). */
  escalationEnabled: booleanSetting.catch(false),
  escalationAfterMinutes: z.coerce.number().int().positive().max(1440).catch(15),
  escalationChannel: z.string().max(64).catch(""),
  escalationMinSeverity: z.enum(SEVERITY_FLOORS).catch("major_outage"),
  /** Tell the other channels when one keeps failing (roadmap 3.4). */
  channelHealthEnabled: booleanSetting.catch(false),
  channelHealthAfterFailures: z.coerce.number().int().min(2).max(100).catch(3),
  /** One message when a shared failure ends (roadmap 3.10). */
  incidentSummaryEnabled: booleanSetting.catch(false),
  /** Last update of an incident wins (roadmap 3.11). */
  coalesceEnabled: booleanSetting.catch(false),
  coalesceWindowMinutes: z.coerce.number().int().positive().max(60).catch(2),
  /** Quiet updates while a major outage is known (roadmap 3.14). */
  knownOutageEnabled: booleanSetting.catch(false),
  /** The periodic report (roadmap 3.13), and the period it last went out for. */
  reportEnabled: booleanSetting.catch(false),
  reportFrequency: z.enum(["weekly", "monthly"]).catch("weekly"),
  reportChannel: z.string().max(64).catch(""),
  reportLastSent: z.string().max(32).catch(""),
  /** Who is on call this week (roadmap 3.15). The rotation is recipient ids, comma-joined. */
  onCallEnabled: booleanSetting.catch(false),
  onCallMinSeverity: z.enum(SEVERITY_FLOORS).catch("major_outage"),
  onCallRotation: z.string().max(2048).catch(""),
  onCallStartsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).catch(""),
  /** The routine weekly test (roadmap 3.16), and the week it last ran for. */
  deliveryTestEnabled: booleanSetting.catch(false),
  deliveryTestLastSent: z.string().max(32).catch(""),
  /** Attach the provider's last 24 hours as an SVG where a channel can carry one (roadmap 3.12). */
  attachChart: booleanSetting.catch(false),

  /**
   * "Is a newer version out" (roadmap 15.11a). Off by default: it is the only
   * setting here that reaches out to a host this instance did not choose to
   * monitor, and an installation must opt into that deliberately rather than
   * discover it happening.
   */
  updateCheckEnabled: booleanSetting.catch(false),
  /**
   * Reading the signed provider catalog from GitHub (roadmap 2.2). Off by
   * default for the update check's reason: a request to a host nobody chose.
   */
  catalogFeedEnabled: booleanSetting.catch(false),
  /**
   * Which model writes incident summaries (roadmap 6.10). `off` by default:
   * the one setting that would send a provider's words to a third party, so
   * nothing does until the operator names one. The key is not here — it lives
   * in `AI_API_KEY`, like every other credential.
   */
  aiProvider: z.enum(AI_PROVIDERS).catch("off"),
  aiModel: z.string().max(200).catch(""),
  aiBaseUrl: z.string().max(2048).catch(""),
});

export type Settings = z.infer<typeof settingsSchema>;

export type MapView = Settings["mapView"];

export function readSettings(db: DatabaseSync, logger: Logger): Settings {
  const raw = Object.fromEntries(
    db
      .prepare("SELECT key, value FROM settings")
      .all()
      .map((row) => z.object({ key: z.string(), value: z.string() }).parse(row))
      .map((row) => [row.key, row.value]),
  );

  const settings = settingsSchema.parse(raw);
  // `catch` above replaces an unusable value silently, so compare and say so.
  for (const [key, value] of Object.entries(settings)) {
    const stored = raw[key];
    if (stored !== undefined && stored !== String(value)) {
      logger.warn("setting fell back to its default", { key, stored });
    }
  }
  return settings;
}

/**
 * The delivery policy as the shared schema wants it, assembled from the flat
 * setting rows. One function, called by both the config source and the route
 * that reports the current policy, so the API and the engine can never be
 * reading two different windows.
 */
export function deliveryOf(settings: Settings): {
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timeZone: string;
    minSeverity: Settings["quietHoursMinSeverity"];
  };
  digest: {
    enabled: boolean;
    windowMinutes: number;
    immediateFloor: Settings["digestImmediateFloor"];
  };
  cap: { enabled: boolean; maxPerHour: number };
  updateInPlace: boolean;
  maintenanceNotice: { enabled: boolean; leadMinutes: number };
  escalation: {
    enabled: boolean;
    afterMinutes: number;
    channel: string;
    minSeverity: Settings["escalationMinSeverity"];
  };
  channelHealth: { enabled: boolean; afterFailures: number };
  incidentSummary: { enabled: boolean };
  coalesce: { enabled: boolean; windowMinutes: number };
  knownOutage: { enabled: boolean };
  report: { enabled: boolean; frequency: Settings["reportFrequency"]; channel: string };
  onCall: { enabled: boolean; minSeverity: Settings["onCallMinSeverity"]; rotation: string[]; startsOn: string };
  deliveryTest: { enabled: boolean };
  attachChart: boolean;
} {
  return {
    quietHours: {
      enabled: settings.quietHoursEnabled,
      start: settings.quietHoursStart,
      end: settings.quietHoursEnd,
      timeZone: settings.quietHoursTimeZone,
      minSeverity: settings.quietHoursMinSeverity,
    },
    digest: {
      enabled: settings.digestEnabled,
      windowMinutes: settings.digestWindowMinutes,
      immediateFloor: settings.digestImmediateFloor,
    },
    cap: {
      enabled: settings.alertCapEnabled,
      maxPerHour: settings.alertCapPerHour,
    },
    updateInPlace: settings.updateInPlace,
    maintenanceNotice: {
      enabled: settings.maintenanceNoticeEnabled,
      leadMinutes: settings.maintenanceNoticeLeadMinutes,
    },
    escalation: {
      enabled: settings.escalationEnabled,
      afterMinutes: settings.escalationAfterMinutes,
      channel: settings.escalationChannel,
      minSeverity: settings.escalationMinSeverity,
    },
    channelHealth: {
      enabled: settings.channelHealthEnabled,
      afterFailures: settings.channelHealthAfterFailures,
    },
    incidentSummary: { enabled: settings.incidentSummaryEnabled },
    coalesce: {
      enabled: settings.coalesceEnabled,
      windowMinutes: settings.coalesceWindowMinutes,
    },
    knownOutage: { enabled: settings.knownOutageEnabled },
    report: {
      enabled: settings.reportEnabled,
      frequency: settings.reportFrequency,
      channel: settings.reportChannel,
    },
    onCall: {
      enabled: settings.onCallEnabled,
      minSeverity: settings.onCallMinSeverity,
      rotation: settings.onCallRotation === "" ? [] : settings.onCallRotation.split(","),
      startsOn: settings.onCallStartsOn,
    },
    deliveryTest: { enabled: settings.deliveryTestEnabled },
    attachChart: settings.attachChart,
  };
}

export function writeSettings(
  db: DatabaseSync,
  patch: Partial<Record<keyof Settings, unknown>>,
): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    upsert.run(key, String(value));
  }
}
