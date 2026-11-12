import { resolveZone, shiftDay, zonedDayKey } from "./calendarDays.ts";
import type { HistoryStore, IncidentRow } from "./historyStore.interface.ts";
import { downtimeCost, type CostRates } from "./outageCost.ts";

/**
 * What the incident table already knows, asked two new questions — roadmap 12.2
 * and 12.3.
 *
 * No new polling, no new column, no new dependency: every figure here comes out
 * of rows the poller has been writing since the first cycle. The cost is
 * analysis and presentation, which is the best ratio available in the codebase.
 *
 * 12.2 is a procurement document. "Which of our suppliers is the problem" is a
 * question an operator answers from memory today, and memory over-weights the
 * outage that happened during a demo. Mean time to resolution, mean time
 * between incidents, the longest single outage and the direction of travel
 * answer it with the rows instead.
 *
 * 12.3 is a different shape of the same data: providers ship on a calendar and
 * break on a calendar, and seeing that one supplier's failures cluster on
 * Thursday evenings is actionable in a way a total never is.
 */

const MINUTE_MS = 60_000;

export interface ProviderReliability {
  providerId: string;
  /** Incidents that started inside the window. */
  incidents: number;
  /**
   * Mean minutes from start to resolution, over the incidents in this window
   * that have actually been resolved.
   *
   * `null` when none has. An unresolved incident is deliberately left out
   * rather than measured to now: it would report a provider mid-outage as
   * having a terrible MTTR and then quietly improve the figure the moment the
   * outage ended, which is the opposite of what the number is for.
   */
  mttrMinutes: number | null;
  /** How many of the window's incidents are resolved — the MTTR's own sample size. */
  resolved: number;
  /**
   * Mean minutes between the starts of consecutive incidents.
   *
   * `null` with fewer than two: one incident has nothing to be between, and a
   * provider with a single incident is not a provider that fails every N
   * minutes.
   */
  mtbfMinutes: number | null;
  /** The worst single outage in the window, in minutes. `null` when none resolved. */
  longestOutageMinutes: number | null;
  /** Total resolved downtime, which is what the ranking sorts on. */
  downtimeMinutes: number;
  /** `downtimeMinutes` at the declared hourly cost — roadmap 6.3. `null` when none was declared. */
  downtimeCost: number | null;
  /**
   * Incidents in the window of equal length before this one, so the table can
   * say "worse than last month" rather than only "bad".
   */
  previousIncidents: number;
  /** The base rate for the coming week — roadmap 6.7. `null` before 90 days of watching. */
  forecast: IncidentForecast | null;
}

/**
 * "How likely is at least one incident in the next seven days", from nothing
 * but how often this provider has had one lately — roadmap 6.7.
 *
 * Deliberately the plainest model there is: incidents are taken to arrive at a
 * steady rate, measured over the last 90 days, and the chance of at least one
 * in a week is `1 - e^(-rate × 7)`. No seasonality, no trend, no weighting of
 * recent weeks — every one of those would be a knob, and a forecast whose knobs
 * nobody can see is worse than none when it gets quoted at a vendor. The inputs
 * travel with the answer so that anyone reading it can redo the sum.
 *
 * Fixed at 90 days whatever window the table shows: a seven-day window would
 * turn one bad Tuesday into a 100% forecast.
 */
export interface IncidentForecast {
  basisDays: number;
  /** Incidents that started inside the basis. */
  incidents: number;
  /** The rate the probability is built from, incidents per week, two decimals. */
  perWeek: number;
  /** Chance of at least one incident in the next 7 days, whole percent. */
  probability: number;
}

const FORECAST_BASIS_DAYS = 90;
const FORECAST_HORIZON_DAYS = 7;

export interface ReliabilityReport {
  days: number;
  providers: ProviderReliability[];
  /**
   * Incidents by weekday and hour of the day, in the operator's zone — roadmap
   * 12.3. `[weekday][hour]`, weekday 0 = Monday, so a week reads left to right
   * the way a calendar does rather than starting on Sunday because C did.
   *
   * Counted by when an incident *started*: "when do they break" is a question
   * about onset, and counting every hour an outage spanned would let one long
   * weekend outage colour an entire row.
   */
  byWeekdayHour: number[][];
}

/** Monday-first weekday of an instant in a zone, 0..6. */
function weekdayIn(at: Date, zone: string): number {
  const name = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
  }).format(at);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
  return index === -1 ? 0 : index;
}

/** Hour of the day of an instant in a zone, 0..23. */
function hourIn(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

/** Minutes an incident was open, or null while it still is. */
const durationOf = (incident: IncidentRow): number | null =>
  incident.resolvedAt === null
    ? null
    : Math.max(
        0,
        Math.round(
          (Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) /
            MINUTE_MS,
        ),
      );

export interface ReliabilityDeps {
  now?: (() => Date) | undefined;
  timeZone?: (() => Promise<string> | string) | undefined;
  /** The declared hourly outage cost per provider — roadmap 6.3. */
  costRates?: (() => CostRates) | undefined;
}

export function createReliabilityService(
  store: HistoryStore,
  deps: ReliabilityDeps = {},
) {
  const now = deps.now ?? (() => new Date());
  const zoneOf = async (): Promise<string> =>
    resolveZone((await deps.timeZone?.()) ?? "UTC");

  /**
   * `null` until the provider has been watched for the whole basis: a provider
   * added last week with one incident would otherwise forecast a rate measured
   * over seven days as though it were ninety.
   */
  async function forecastFor(
    providerId: string,
    today: string,
  ): Promise<IncidentForecast | null> {
    const earliest = await store.getEarliestSampleTime(providerId);
    const basisStart = now().getTime() - FORECAST_BASIS_DAYS * 86_400_000;
    if (earliest === null || Date.parse(earliest) > basisStart) return null;

    const from = shiftDay(today, -(FORECAST_BASIS_DAYS - 1));
    const incidents = (
      await store.listIncidents({ providerId, openFrom: from, openTo: today })
    ).filter((incident) => incident.startedAt.slice(0, 10) >= from).length;
    const perDay = incidents / FORECAST_BASIS_DAYS;
    return {
      basisDays: FORECAST_BASIS_DAYS,
      incidents,
      perWeek: Math.round(perDay * 7 * 100) / 100,
      // Capped below certainty: at ten incidents a week the sum rounds to 100,
      // and "certain" is a claim no base rate is entitled to make.
      probability: Math.min(
        99,
        Math.round((1 - Math.exp(-perDay * FORECAST_HORIZON_DAYS)) * 100),
      ),
    };
  }

  return {
    /**
     * `only` narrows to a caller-supplied set the way the history summary does,
     * which is how a disabled provider leaves the table without its rows being
     * forgotten.
     */
    async getReport(
      days: number,
      only?: string[] | undefined,
    ): Promise<ReliabilityReport> {
      const zone = await zoneOf();
      const today = zonedDayKey(now(), zone);
      const from = shiftDay(today, -(days - 1));
      const previousFrom = shiftDay(today, -(2 * days - 1));
      const previousTo = shiftDay(today, -days);

      const stored = await store.listProviderIds();
      const providerIds =
        only === undefined ? stored : stored.filter((id) => only.includes(id));

      const byWeekdayHour = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 0),
      );
      const providers: ProviderReliability[] = [];
      const rates = deps.costRates?.() ?? new Map<string, number>();

      for (const providerId of providerIds) {
        // Started inside the window, not merely open during it: every figure
        // below is about onset and about how long onset took to clear, and an
        // outage that began two months ago belongs to the month it began in.
        const incidents = await store.listIncidents({
          providerId,
          openFrom: from,
          openTo: today,
        });
        const started = incidents
          .filter((incident) => incident.startedAt.slice(0, 10) >= from)
          .sort((left, right) => left.startedAt.localeCompare(right.startedAt));

        const durations = started
          .map(durationOf)
          .filter((minutes): minutes is number => minutes !== null);

        const gaps: number[] = [];
        for (let index = 1; index < started.length; index += 1) {
          gaps.push(
            Math.round(
              (Date.parse(started[index]!.startedAt) -
                Date.parse(started[index - 1]!.startedAt)) /
                MINUTE_MS,
            ),
          );
        }

        for (const incident of started) {
          const at = new Date(incident.startedAt);
          const row = byWeekdayHour[weekdayIn(at, zone)];
          if (row !== undefined)
            row[hourIn(at, zone)] = (row[hourIn(at, zone)] ?? 0) + 1;
        }

        const forecast = await forecastFor(providerId, today);

        const previous = await store.listIncidents({
          providerId,
          openFrom: previousFrom,
          openTo: previousTo,
        });

        providers.push({
          providerId,
          incidents: started.length,
          mttrMinutes: mean(durations),
          resolved: durations.length,
          mtbfMinutes: mean(gaps),
          longestOutageMinutes:
            durations.length === 0 ? null : Math.max(...durations),
          downtimeMinutes: durations.reduce((sum, minutes) => sum + minutes, 0),
          downtimeCost: downtimeCost(
            rates,
            providerId,
            durations.reduce((sum, minutes) => sum + minutes, 0),
          ),
          previousIncidents: previous.filter(
            (incident) =>
              incident.startedAt.slice(0, 10) >= previousFrom &&
              incident.startedAt.slice(0, 10) <= previousTo,
          ).length,
          forecast,
        });
      }

      // Worst first: the table is read to find the supplier worth a
      // conversation, and alphabetical order buries it.
      providers.sort(
        (left, right) =>
          right.downtimeMinutes - left.downtimeMinutes ||
          right.incidents - left.incidents ||
          left.providerId.localeCompare(right.providerId),
      );

      return { days, providers, byWeekdayHour };
    },
  };
}
