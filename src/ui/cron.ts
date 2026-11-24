/**
 * The five-field cron expression scheduled backups run on — roadmap 10.1.
 * Minute, hour, day of month, month, day of week; each a `*`, a number, a
 * range `a-b`, a list `a,b`, or any of those with a step `/n`. Day of week is
 * 0–7 with both ends Sunday. When day of month and day of week are both
 * restricted, a day matching either runs — cron's own rule.
 *
 * No names (`MON`, `JAN`) and no `@daily`: a backup schedule is one line in a
 * settings field, and the shapes above are the ones that line takes.
 */

export interface CronSchedule {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

function parseField(raw: string, field: (typeof FIELDS)[number]): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (match === null) throw new Error(`${field.name}: "${part}" is not a cron field`);
    const [, whole, first, last, stepRaw] = match;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    const from = whole === "*" ? field.min : Number(first);
    const to = whole === "*" ? field.max : last === undefined ? (stepRaw === undefined ? from : field.max) : Number(last);
    if (step < 1) throw new Error(`${field.name}: a step of 0 never runs`);
    if (from < field.min || to > field.max || from > to) {
      throw new Error(`${field.name}: "${part}" is outside ${field.min}-${field.max}`);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

/** Parses an expression, throwing a sentence that names the field at fault. */
export function parseCron(expression: string): CronSchedule {
  const raw = expression.trim().split(/\s+/);
  if (raw.length !== 5) throw new Error(`a cron expression has five fields, this one has ${raw.length}`);
  const [minutes, hours, days, months, weekdays] = raw.map((part, index) => parseField(part, FIELDS[index]!));
  // 7 is Sunday too.
  if (weekdays!.has(7)) weekdays!.add(0);
  return {
    minutes: minutes!,
    hours: hours!,
    days: days!,
    months: months!,
    weekdays: weekdays!,
    daysRestricted: raw[2] !== "*",
    weekdaysRestricted: raw[4] !== "*",
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(at: number, zone: string): { month: number; day: number; weekday: number; hour: number; minute: number } {
  let format = formatters.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  return {
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"] ?? ""),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
  };
}

const MINUTE = 60_000;
/** A year and a day: an expression with no run in it (`0 0 31 2 *`) has none. */
const HORIZON = 367 * 24 * 60 * MINUTE;

/**
 * The first minute strictly after `after` the schedule runs, read on the wall
 * clock of `zone`; null when it never does. Skips a whole day or hour at a
 * time where neither can match, so a search costs hundreds of steps, not the
 * half a million minutes in a year.
 */
export function nextCronRun(schedule: CronSchedule, after: number, zone: string): number | null {
  let at = Math.floor(after / MINUTE) * MINUTE + MINUTE;
  const end = after + HORIZON;
  while (at <= end) {
    const parts = partsIn(at, zone);
    const dayMatches = schedule.daysRestricted && schedule.weekdaysRestricted
      ? schedule.days.has(parts.day) || schedule.weekdays.has(parts.weekday)
      : schedule.days.has(parts.day) && schedule.weekdays.has(parts.weekday);
    if (!schedule.months.has(parts.month) || !dayMatches) {
      // To the next local midnight, near enough: a DST day off by an hour
      // lands an hour early and is walked forward from there.
      at += ((23 - parts.hour) * 60 + (60 - parts.minute)) * MINUTE;
      continue;
    }
    if (!schedule.hours.has(parts.hour)) {
      at += (60 - parts.minute) * MINUTE;
      continue;
    }
    if (!schedule.minutes.has(parts.minute)) {
      at += MINUTE;
      continue;
    }
    return at;
  }
  return null;
}
