import type { OverallStatus, StatusChange, StatusChangeKind } from "./types.ts";

/**
 * Decides which channels a change goes to. Pure and synchronous like the
 * diff engine: rules in, channel ids out, no I/O and no logging. The diff
 * engine decides whether a change is news; this decides who hears about it;
 * the dispatcher (a later task) is the only thing that actually sends.
 */

/**
 * The eight change kinds grouped into four classes. Classes rather than raw
 * kinds for two reasons: a rule stays readable at four checkboxes instead of
 * eight, and a kind added later joins an existing class rather than being
 * invisible to every rule already saved.
 */
export const EVENT_CLASSES = ["status", "incident", "maintenance", "monitoring"] as const;

export type EventClass = (typeof EVENT_CLASSES)[number];

/**
 * A complete Record, never a switch with a default: a kind added to
 * STATUS_CHANGE_KINDS must fail compilation until someone classifies it.
 * Same mechanism types.ts uses to stop the stored-notification enum drifting.
 */
const CLASS_OF: Record<StatusChangeKind, EventClass> = {
  status_change: "status",
  component_status_change: "status",
  incident_opened: "incident",
  incident_updated: "incident",
  incident_resolved: "incident",
  maintenance_started: "maintenance",
  maintenance_ended: "maintenance",
  monitoring_degraded: "monitoring",
};

export function classOf(kind: StatusChangeKind): EventClass {
  return CLASS_OF[kind];
}

/** Ordered severity floors. `any` admits everything, `unknown` included. */
export const SEVERITY_FLOORS = ["any", "degraded", "partial_outage", "major_outage"] as const;

export type SeverityFloor = (typeof SEVERITY_FLOORS)[number];

/**
 * `unknown` has no rank: it is not a severity, it is the absence of a
 * reading, and the diff engine already refuses to compare it. A change
 * ranked `unknown` therefore clears only the `any` floor.
 */
const STATUS_RANK: Record<OverallStatus, number | null> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
  unknown: null,
};

/**
 * A nightly floor: while the window runs, a change has to be at least this bad
 * to reach anybody (roadmap 3.11).
 *
 * It is an input to the evaluator below rather than a filter in the dispatcher,
 * for the same reason a mute is an input to the diff engine: an operator asking
 * "who would hear about this?" has to get one answer, and a second gate
 * somewhere downstream is how the dry run and the delivery start disagreeing.
 */
export interface QuietHours {
  enabled: boolean;
  /** Wall clock in `timeZone`, "HH:MM". A window may wrap midnight. */
  start: string;
  end: string;
  /** IANA zone name, or "auto" for the zone the process itself runs in. */
  timeZone: string;
  /** What a change must clear to notify while the window runs. */
  minSeverity: SeverityFloor;
}

/** What an installation that has never configured quiet hours behaves like. */
export const QUIET_HOURS_OFF: QuietHours = {
  enabled: false,
  start: "23:00",
  end: "07:00",
  timeZone: "auto",
  minSeverity: "major_outage",
};

/** "HH:MM" as minutes since midnight, or null when it is not that shape. */
function minutesOfClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * What the wall clock reads in `timeZone` at `at`, in minutes since midnight.
 * Null when the zone is not one this runtime can format in — the caller then
 * fails open rather than reading a window in the wrong zone.
 *
 * Formatted rather than computed from an offset: an offset is wrong twice a
 * year, which is the whole reason the timezone preference stores a name.
 */
export function minutesOfDay(at: Date, timeZone: string): number | null {
  const zone = timeZone === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
  } catch {
    return null;
  }
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (hour === undefined || minute === undefined) return null;
  // "24" is what some runtimes render midnight as under hour12: false.
  return (Number(hour) % 24) * 60 + Number(minute);
}

/**
 * Whether `at` falls inside the window. The start is inclusive and the end is
 * exclusive, so 23:00–07:00 covers 23:00 and not 07:00 — an operator setting
 * 07:00 means "I am up at seven".
 *
 * Fails open on anything unusable: a malformed time, an unknown zone, or a
 * window whose ends are equal (which reads as either "always" or "never" and
 * would be a whole day of silence if read the wrong way). Quiet hours trade
 * alerts for sleep, and a broken setting must lose that trade.
 */
export function inQuietHours(quiet: QuietHours, at: Date): boolean {
  if (!quiet.enabled) return false;
  const start = minutesOfClock(quiet.start);
  const end = minutesOfClock(quiet.end);
  if (start === null || end === null || start === end) return false;
  const nowMinutes = minutesOfDay(at, quiet.timeZone);
  if (nowMinutes === null) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : // Wrapping midnight: two ranges, one on each side of it.
      nowMinutes >= start || nowMinutes < end;
}

export interface RoutingRule {
  /** A provider id, or "*" for every provider. */
  provider: string;
  classes: EventClass[];
  minSeverity: SeverityFloor;
  /** Channel ids; `["*"]` means every enabled channel, `[]` mutes. */
  channels: string[];
}

/**
 * What an installation with no rules of its own behaves like: everything to
 * everyone, what both editions did before routing existed. The wildcard is
 * deliberate — an enumerated list would leave a channel shipped in a later
 * version in no rule at all, which would silently never notify.
 */
export const CATCH_ALL_RULE: RoutingRule = {
  provider: "*",
  classes: [...EVENT_CLASSES],
  minSeverity: "any",
  channels: ["*"],
};

/**
 * Ranked on the worse of where the change came from and where it went — not
 * just where it went. A recovery from major outage carries `operational`,
 * and ranking on that alone would send the alarm to the operator's phone and
 * the all-clear nowhere.
 *
 * `previousStatus` is absent on every incident_*, maintenance_* and
 * monitoring_degraded change, where severity is read off `currentStatus`.
 */
export function severityOf(change: StatusChange): OverallStatus {
  const previous = change.previousStatus;
  if (previous === undefined) return change.currentStatus;

  const a = STATUS_RANK[previous];
  const b = STATUS_RANK[change.currentStatus];
  if (a === null) return change.currentStatus;
  if (b === null) return previous;
  return a >= b ? previous : change.currentStatus;
}

/**
 * Every floor above `any` is itself an OverallStatus, so one rank table
 * serves both sides of the comparison and there is no second scale to keep
 * in step.
 */
export function clearsFloor(severity: OverallStatus, floor: SeverityFloor): boolean {
  if (floor === "any") return true;
  const rank = STATUS_RANK[severity];
  const required = STATUS_RANK[floor];
  return rank !== null && required !== null && rank >= required;
}

/**
 * Why a rule did or did not decide the change. `unreached` only ever follows
 * a `won` rule earlier in the list — evaluation stops at the first match, so
 * nothing after it is ever actually checked. `because` names the FIRST check
 * that failed, in the same provider/class/severity order the loop tests them.
 */
export type RuleOutcome =
  | { kind: "won" }
  | { kind: "unreached" }
  | { kind: "skipped"; because: "provider" | "class" | "severity" };

export interface Explanation {
  /** Index into `rules` of the rule that decided, or null when none matched. */
  winner: number | null;
  /** One entry per rule, in the same order. */
  outcomes: RuleOutcome[];
  /** Exactly what `resolveTargets` returns for the same inputs. */
  targets: string[];
  /**
   * True when quiet hours took the change away from a rule that had already
   * won it. Reported rather than folded into `targets` alone: a dry run that
   * showed no channels and no reason would read as a broken rule.
   */
  quieted: boolean;
}

export interface RoutingOptions {
  quietHours?: QuietHours | undefined;
  /** When the change is being evaluated. Defaults to the change's own timestamp. */
  at?: Date | undefined;
}

/**
 * First match wins: evaluation stops at the first rule that matches, which
 * lets a provider-specific rule placed above the catch-all mute it. A later
 * rule can never widen what an earlier one narrowed.
 *
 * `rules` is assumed already ordered — file order for Light, `ORDER BY
 * position` for UI. Sorting here would hide a broken config at the source.
 *
 * No match and a match with no channels both yield `[]` targets, on purpose:
 * the dispatcher must not behave differently, and a seeded catch-all rule
 * keeps the first case from happening by accident.
 *
 * The single evaluator behind both `resolveTargets` (the dispatcher's only
 * concern: who gets notified) and the dashboard's dry run (which also needs
 * to say WHY) — one loop, so the two views of a match can never disagree.
 */
export function explain(
  change: StatusChange,
  rules: RoutingRule[],
  enabledChannelIds: string[],
  options: RoutingOptions = {},
): Explanation {
  const severity = severityOf(change);
  const eventClass = classOf(change.kind);

  let winner: number | null = null;
  const outcomes: RuleOutcome[] = [];
  let targets: string[] = [];

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;

    if (winner !== null) {
      outcomes.push({ kind: "unreached" });
      continue;
    }
    if (rule.provider !== "*" && rule.provider !== change.providerId) {
      outcomes.push({ kind: "skipped", because: "provider" });
      continue;
    }
    if (!rule.classes.includes(eventClass)) {
      outcomes.push({ kind: "skipped", because: "class" });
      continue;
    }
    if (!clearsFloor(severity, rule.minSeverity)) {
      outcomes.push({ kind: "skipped", because: "severity" });
      continue;
    }

    winner = index;
    outcomes.push({ kind: "won" });
    const won: string[] = [];
    for (const channel of rule.channels) {
      for (const id of channel === "*" ? enabledChannelIds : [channel]) {
        if (!won.includes(id)) won.push(id);
      }
    }
    targets = won;
  }

  // Applied after the rules, never instead of them: the winning rule is still
  // the answer to "who covers this change", and quiet hours only decide
  // whether tonight is the night they hear about it. Keeping the order this
  // way is what lets the dry run show both — the rule that won, and the window
  // that overrode it.
  const quiet = options.quietHours;
  const quieted =
    quiet !== undefined &&
    targets.length > 0 &&
    inQuietHours(quiet, options.at ?? new Date(change.at)) &&
    !clearsFloor(severity, quiet.minSeverity);

  return { winner, outcomes, targets: quieted ? [] : targets, quieted };
}

export function resolveTargets(
  change: StatusChange,
  rules: RoutingRule[],
  enabledChannelIds: string[],
  options: RoutingOptions = {},
): string[] {
  return explain(change, rules, enabledChannelIds, options).targets;
}
