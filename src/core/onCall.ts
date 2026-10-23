import type { OnCallConfig } from "./delivery.ts";

/**
 * Who is on call (roadmap 3.15), as a pure function of the date.
 *
 * Nothing is stored: the rotation, its start and `at` are the whole input, so
 * the dashboard's answer to "who is on call" and the dispatcher's cannot
 * disagree, and a restart changes nothing. Weeks are UTC, Monday to Sunday, like
 * every other calendar period in the codebase.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** 1970-01-05, the first Monday of the epoch: the anchor when `startsOn` is empty. */
const EPOCH_MONDAY_MS = 4 * DAY_MS;

/** UTC midnight of the Monday that starts the week containing `ms`. */
function mondayOf(ms: number): number {
  const midnight = Math.floor(ms / DAY_MS) * DAY_MS;
  // 1970-01-01 was a Thursday, so day 0 is 3 days past a Monday.
  const sinceMonday = (Math.floor(ms / DAY_MS) + 3) % 7;
  return midnight - sinceMonday * DAY_MS;
}

/** `YYYY-MM-DD` of the Monday starting the week that contains `at`: one key per UTC week. */
export function weekKey(at: Date): string {
  return new Date(mondayOf(at.getTime())).toISOString().slice(0, 10);
}

/**
 * The recipient id on call at `at`, or undefined when the rotation is off or
 * empty. A `startsOn` that is not a real date counts from the epoch rather than
 * throwing: a setting typo must not stop a major from being delivered.
 */
export function onCallRecipientId(config: OnCallConfig, at: Date): string | undefined {
  if (!config.enabled || config.rotation.length === 0) return undefined;
  const parsed = config.startsOn === "" ? Number.NaN : Date.parse(`${config.startsOn}T00:00:00Z`);
  const anchor = Number.isNaN(parsed) ? EPOCH_MONDAY_MS : mondayOf(parsed);
  const weeks = Math.floor((mondayOf(at.getTime()) - anchor) / WEEK_MS);
  const size = config.rotation.length;
  return config.rotation[((weeks % size) + size) % size];
}
