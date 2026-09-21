/**
 * Which calendar day an instant belongs to, in the operator's zone — roadmap
 * 10.7.
 *
 * Every daily figure in this edition used to bucket by UTC day, which is
 * nobody's day but a UTC operator's: at UTC+13 an incident at 20:00 local lands
 * on tomorrow's bar, and "today" on the year calendar is not today. The
 * timezone preference (roadmap 5.9) already stores an IANA name; this is what
 * reads it.
 *
 * A name rather than an offset, because an offset is wrong twice a year — the
 * same reason `minutesOfDay` in `src/core/routing.ts` formats rather than adds.
 * But the aggregation has to stay in SQL: bucketing 51k samples in JavaScript to
 * avoid two `Intl` calls is the trade the load test (roadmap 7.4) already ruled
 * out. So the window is cut into **segments of constant offset** — one, plus one
 * per DST transition inside it — and each segment is aggregated with the fixed
 * offset that is correct throughout it. Applying the locally valid offset to an
 * instant always yields its local calendar day, so a day split by a transition
 * is still counted once, on the right day, from both sides of the seam.
 */

const DAY_MS = 24 * 3600 * 1000;
/** How precisely a transition instant is located. Finer than any zone shifts. */
const TRANSITION_PRECISION_MS = 60_000;

/** One stretch of the window over which the zone's offset does not change. */
export interface DaySegment {
  /** Inclusive start, ISO. */
  fromIso: string;
  /** Exclusive end, ISO. */
  toIso: string;
  /** Minutes to add to UTC to read the wall clock, e.g. 780 at UTC+13. */
  offsetMinutes: number;
}

/**
 * The zone to actually format in. `auto` — the stored default — means the
 * process's own, which in a container is whatever `TZ` says and otherwise UTC.
 * An unusable name falls back to UTC rather than throwing: a bad preference
 * should cost the operator the right bucket boundaries, never the page.
 */
export function resolveZone(timeZone: string): string {
  const zone = timeZone === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function partsAt(formatter: Intl.DateTimeFormat, at: Date): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type === "literal") continue;
    // "24" is what some runtimes render midnight as under hour12: false.
    parts[part.type] = Number(part.value) % (part.type === "hour" ? 24 : Number.MAX_SAFE_INTEGER);
  }
  return parts;
}

/** Minutes to add to UTC to read `zone`'s wall clock at this instant. */
function offsetMinutesAt(formatter: Intl.DateTimeFormat, at: Date): number {
  const parts = partsAt(formatter, at);
  const asIfUtc = Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/** The `YYYY-MM-DD` an instant falls on, in `zone`. */
export function zonedDayKey(at: Date, zone: string): string {
  const parts = partsAt(formatterFor(zone), at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${parts["year"]}-${pad(parts["month"] ?? 1)}-${pad(parts["day"] ?? 1)}`;
}

/**
 * Calendar arithmetic on a day key, which needs no zone at all: the day before
 * `2026-03-29` is `2026-03-28` everywhere. Done at UTC noon so the 23-hour and
 * 25-hour days a zone actually has can never round a key to its neighbour.
 */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** How many days `toDay` is after `fromDay`. Negative when it is before. */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T12:00:00.000Z`) - Date.parse(`${fromDay}T12:00:00.000Z`)) / DAY_MS,
  );
}

/**
 * The instant `zone`'s calendar day starts at, as UTC.
 *
 * Two passes: the first guess uses the offset at the naive instant, which is
 * the wrong one on the day a transition happens, and the second uses the offset
 * at that guess. On a spring-forward zone whose local midnight does not exist at
 * all, this settles on the first instant the day does have, which is the correct
 * start of that day.
 */
export function dayStart(day: string, zone: string): Date {
  const formatter = formatterFor(zone);
  const naive = Date.parse(`${day}T00:00:00.000Z`);
  const first = naive - offsetMinutesAt(formatter, new Date(naive)) * 60_000;
  return new Date(naive - offsetMinutesAt(formatter, new Date(first)) * 60_000);
}

/**
 * The window `[fromDay, toDay]` cut into stretches of constant offset, oldest
 * first. One entry for a window with no transition in it, which is nearly every
 * window.
 *
 * The offset is read at each day's local noon — the one hour of the day no zone
 * has ever moved across — so a day either side of a transition is compared on
 * settled clocks. When two consecutive days disagree, the transition instant
 * between them is bisected to the minute and becomes the seam.
 */
export function offsetSegments(fromDay: string, toDay: string, zone: string): DaySegment[] {
  const formatter = formatterFor(zone);
  const start = dayStart(fromDay, zone);
  const end = dayStart(shiftDay(toDay, 1), zone);
  if (end.getTime() <= start.getTime()) return [];

  const segments: DaySegment[] = [];
  let segmentStart = start;
  let offset = offsetMinutesAt(formatter, start);

  for (let day = fromDay; day <= toDay; day = shiftDay(day, 1)) {
    const noon = new Date(Date.parse(`${day}T12:00:00.000Z`) - offset * 60_000);
    const atNoon = offsetMinutesAt(formatter, noon);
    if (atNoon === offset) continue;
    // Somewhere between the last settled instant and this noon the zone moved.
    let low = segmentStart.getTime();
    let high = noon.getTime();
    while (high - low > TRANSITION_PRECISION_MS) {
      const mid = low + Math.floor((high - low) / 2);
      if (offsetMinutesAt(formatter, new Date(mid)) === offset) low = mid;
      else high = mid;
    }
    // A zone has never moved off a minute boundary, and the bisection has
    // narrowed the transition to `(low, high]` with at most a minute between
    // them — so exactly one minute boundary is left in that span, and it is the
    // transition. Snapping to it is what makes the seam an exact instant rather
    // than one the precision happened to stop near.
    const seam = Math.ceil(low / TRANSITION_PRECISION_MS) * TRANSITION_PRECISION_MS;
    segments.push({
      fromIso: segmentStart.toISOString(),
      toIso: new Date(seam).toISOString(),
      offsetMinutes: offset,
    });
    segmentStart = new Date(seam);
    offset = atNoon;
  }

  segments.push({ fromIso: segmentStart.toISOString(), toIso: end.toISOString(), offsetMinutes: offset });
  return segments;
}

/** The segments covering the `days` calendar days ending on `endDay`, inclusive. */
export function segmentsEndingOn(endDay: string, days: number, zone: string): DaySegment[] {
  return offsetSegments(shiftDay(endDay, -(days - 1)), endDay, zone);
}
