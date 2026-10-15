import { resolveZone, shiftDay, zonedDayKey } from "./calendarDays.ts";
import type { HistoryStore, IncidentRow } from "./historyStore.interface.ts";

/**
 * Which providers break together — roadmap 2.10.
 *
 * The empirical twin of the declared `dependsOn` graph (roadmap 2.9), read out
 * of the incident rows the poller already wrote. It is not a causal claim: two
 * providers that co-occur may share an upstream, a news cycle or a bad week.
 * It is a shortlist to put in front of the operator — "these went down
 * together 7 times out of 9: declare a dependency?" — never something that
 * changes an alert by itself.
 */

/** Fewest overlaps worth calling a pattern: two is a coincidence, three starts to look like one. */
export const MIN_TOGETHER = 3;
/** How many times more often than chance a pair must overlap to be listed. */
export const MIN_LIFT = 3;

const DAY_MS = 86_400_000;

export interface CoincidentPair {
  /** The provider with fewer incidents in the window — the one the rate is about. Ties go to the id that sorts first. */
  providerId: string;
  /** The other provider of the pair. */
  otherId: string;
  /** Incidents of `providerId` that overlapped one of `otherId`'s. */
  together: number;
  /** All of `providerId`'s incidents in the window — the "of 9" in "7 of 9". */
  incidents: number;
  /** `together / incidents`. */
  rate: number;
  /**
   * `rate` over the share of the window `otherId` was itself open: how much
   * likelier an overlap is than if the two were unrelated. A provider that is
   * down all month overlaps everything and scores ~1, which is why the raw
   * rate alone would flag it against the whole fleet.
   */
  lift: number;
  /** True when either side already names the other in `dependsOn`. */
  declared: boolean;
}

export interface CoincidenceReport {
  days: number;
  pairs: CoincidentPair[];
}

interface Span {
  from: number;
  to: number;
}

const spanOf = (incident: IncidentRow, now: number): Span => ({
  from: Date.parse(incident.startedAt),
  to: incident.resolvedAt === null ? now : Date.parse(incident.resolvedAt),
});

/** Length of the union of spans clipped to `[from, to]`, so overlapping incidents count once. */
function coveredMs(spans: Span[], from: number, to: number): number {
  const sorted = spans
    .map((span) => ({ from: Math.max(span.from, from), to: Math.min(span.to, to) }))
    .filter((span) => span.to > span.from)
    .sort((left, right) => left.from - right.from);
  let total = 0;
  let end = -Infinity;
  for (const span of sorted) {
    if (span.to <= end) continue;
    total += span.to - Math.max(span.from, end);
    end = span.to;
  }
  return total;
}

const overlaps = (left: Span, right: Span): boolean =>
  left.from <= right.to && right.from <= left.to;

export interface CoincidenceDeps {
  now?: (() => Date) | undefined;
  timeZone?: (() => Promise<string> | string) | undefined;
}

export function createCoincidenceService(
  store: HistoryStore,
  deps: CoincidenceDeps = {},
) {
  const now = deps.now ?? (() => new Date());

  return {
    /**
     * `only` narrows to the enabled providers, like every other report;
     * `dependsOn` is the declared graph, so a pair the operator already
     * declared is marked rather than proposed again.
     */
    async getReport(
      days: number,
      only?: string[] | undefined,
      dependsOn: Record<string, string[] | undefined> = {},
    ): Promise<CoincidenceReport> {
      const zone = resolveZone((await deps.timeZone?.()) ?? "UTC");
      const today = zonedDayKey(now(), zone);
      const from = shiftDay(today, -(days - 1));
      const nowMs = now().getTime();
      const windowFrom = nowMs - days * DAY_MS;

      const stored = await store.listProviderIds();
      const providerIds = only === undefined ? stored : stored.filter((id) => only.includes(id));

      const spans = new Map<string, Span[]>();
      for (const providerId of providerIds) {
        const incidents = await store.listIncidents({ providerId, openFrom: from, openTo: today });
        const inWindow = incidents
          .map((incident) => spanOf(incident, nowMs))
          .filter((span) => span.to >= windowFrom);
        if (inWindow.length > 0) spans.set(providerId, inWindow);
      }

      const ids = [...spans.keys()].sort();
      const declaredBetween = (left: string, right: string): boolean =>
        (dependsOn[left] ?? []).includes(right) || (dependsOn[right] ?? []).includes(left);

      const pairs: CoincidentPair[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const left = ids[i]!;
          const right = ids[j]!;
          const leftSpans = spans.get(left)!;
          const rightSpans = spans.get(right)!;
          const [base, other, baseSpans, otherSpans] =
            rightSpans.length < leftSpans.length
              ? [right, left, rightSpans, leftSpans]
              : [left, right, leftSpans, rightSpans];

          const together = baseSpans.filter((span) =>
            otherSpans.some((candidate) => overlaps(span, candidate)),
          ).length;
          if (together < MIN_TOGETHER) continue;

          const coverage = coveredMs(otherSpans, windowFrom, nowMs) / (nowMs - windowFrom);
          if (coverage <= 0) continue;
          const rate = together / baseSpans.length;
          const lift = rate / coverage;
          if (lift < MIN_LIFT) continue;

          pairs.push({
            providerId: base,
            otherId: other,
            together,
            incidents: baseSpans.length,
            rate: Math.round(rate * 100) / 100,
            lift: Math.round(lift * 10) / 10,
            declared: declaredBetween(base, other),
          });
        }
      }

      pairs.sort(
        (left, right) =>
          right.lift - left.lift ||
          right.together - left.together ||
          left.providerId.localeCompare(right.providerId) ||
          left.otherId.localeCompare(right.otherId),
      );
      return { days, pairs };
    },
  };
}
