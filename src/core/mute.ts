import type { MuteSchedule, ServiceDefinition, Weekday } from "./configSource.interface.ts";
import { isMuted } from "./diffEngine.ts";
import { minutesOfClock } from "./routing.ts";

/**
 * Planned mutes — roadmap 5.2. A schedule never reaches the diff engine as a
 * schedule: it is folded here into the one thing the engine already reads, an
 * instant the mute runs until, so a planned mute and a pressed one are the same
 * mute everywhere downstream (the engine, the dispatcher, the dashboard's
 * "muted until" badge).
 */

const WEEKDAY_OF: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The wall clock in `timeZone` at `at`: weekday and minutes since midnight. */
function wallClock(at: Date, timeZone: string): { day: Weekday; minutes: number } | null {
  const zone = timeZone === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
  } catch {
    return null;
  }
  const day = WEEKDAY_OF[parts.find((part) => part.type === "weekday")?.value ?? ""];
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (day === undefined || hour === undefined || minute === undefined) return null;
  return { day, minutes: (Number(hour) % 24) * 60 + Number(minute) };
}

const dayBefore = (day: Weekday): Weekday => ORDER[(ORDER.indexOf(day) + 6) % 7]!;

/**
 * When the schedule's current run ends, as an instant, or null when it is not
 * running at `at`. Fails open, like quiet hours: an unknown zone or a malformed
 * time mutes nothing, because the one failure this feature must not have is
 * silencing a provider by accident.
 *
 * The end is `at` plus the wall-clock minutes left, so a window that spans a DST
 * change ends an hour early or late that one night — the next reading, a few
 * minutes later, corrects it, which is cheaper than resolving a wall time back
 * into an instant in an arbitrary zone.
 */
export function scheduleRunsUntil(schedule: MuteSchedule, at: Date): Date | null {
  if ("from" in schedule) {
    const from = Date.parse(schedule.from);
    const until = Date.parse(schedule.until);
    if (Number.isNaN(from) || Number.isNaN(until)) return null;
    const now = at.getTime();
    return now >= from && now < until ? new Date(until) : null;
  }
  const start = minutesOfClock(schedule.start);
  const end = minutesOfClock(schedule.end);
  if (start === null || end === null || start === end) return null;
  const clock = wallClock(at, schedule.timeZone);
  if (clock === null) return null;
  const { day, minutes } = clock;
  // Seconds dropped from the wall clock above are dropped here too, so the
  // run ends on the minute the operator wrote rather than up to 59s late.
  const base = at.getTime() - (at.getTime() % 60_000);
  const after = (left: number): Date => new Date(base + left * 60_000);
  if (start < end) {
    return schedule.days.includes(day) && minutes >= start && minutes < end ? after(end - minutes) : null;
  }
  // Wrapping midnight: the evening half belongs to the day it starts on, the
  // morning half to the day before.
  if (schedule.days.includes(day) && minutes >= start) return after(24 * 60 - minutes + end);
  if (schedule.days.includes(dayBefore(day)) && minutes < end) return after(end - minutes);
  return null;
}

/**
 * Whatever mutes the provider at `at`, folded into one instant: the pressed
 * mute while it is live, and every planned one running now. The latest end
 * wins, so two overlapping mutes never cut each other short. Null means the
 * provider is not muted.
 */
export function effectiveMutedUntil(
  service: Pick<ServiceDefinition, "mutedUntil" | "muteSchedules">,
  at: string,
): string | null {
  let latest: number | null = null;
  if (service.mutedUntil !== undefined && isMuted(service.mutedUntil, at)) {
    latest = Date.parse(service.mutedUntil);
  }
  const when = new Date(at);
  if (!Number.isNaN(when.getTime())) {
    for (const schedule of service.muteSchedules ?? []) {
      const until = scheduleRunsUntil(schedule, when);
      if (until !== null && (latest === null || until.getTime() > latest)) latest = until.getTime();
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}
