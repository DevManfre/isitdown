import type { OverallStatus } from "../core/types.ts";

/**
 * The provider trust card (roadmap 8.1) — the part of it that is arithmetic.
 *
 * The claim this file makes is not "the provider is reliable": that is uptime,
 * and the history charts already say it. It is the narrower and more
 * inflammatory one — *how closely the provider's own status page tracks what we
 * observed*. Two series already exist for that comparison and neither was added
 * for it: 1.8 made a probe a provider like any other, so a probe's readings and
 * a status page's readings are rows in the same `status_samples` table, and
 * `crossChecks` already names which page a probe is a second opinion on.
 *
 * Everything here is pure, over sample arrays. Three reasons, in order of how
 * much they mattered:
 *
 *  - The same function has to fold live cycles and backfill years of stored
 *    samples. A trust card needs ten episodes before it says anything, and on a
 *    decent provider ten disagreements are years — so a build that only ever
 *    looked forward from deploy day would leave the feature mute for longer
 *    than anyone will wait. One builder, two callers, no second code path to be
 *    subtly different.
 *  - A number that accuses someone has to be testable against a table of
 *    hand-written samples, not against a database fixture.
 *  - Core stays unaware: this is history, history is the UI edition's, and
 *    nothing in `src/core` changes for it.
 */

/** One reading of one provider, as `status_samples` stores it. Ascending by `at`. */
export interface TrustSample {
  /** ISO 8601. */
  at: string;
  status: OverallStatus;
  /** False when the read itself failed — a page we could not fetch says nothing. */
  ok: boolean;
}

/** A declared maintenance window on the page being compared against. */
export interface TrustMaintenance {
  startsAt: string;
  /** Null for a window with no announced end; treated as still open. */
  endsAt: string | null;
}

/** Why an episode is recorded but not counted. Null means it counts. */
export type TrustExclusion = "maintenance" | "fleet_blind";

/**
 * What became of one disagreement.
 *
 * `after_recovery` exists so the most inflammatory number on the card stays
 * honest. A page that opens the incident three minutes after the service came
 * back *did* admit it; calling that "never admitted" would be the false
 * accusation this whole feature is built to avoid, and 1.10 already chose the
 * narrow reading everywhere else.
 */
export type TrustOutcome = "admitted" | "after_recovery" | "never";

export interface TrustEpisode {
  /** First probe sample of the run of failures, not the one that confirmed it. */
  probeDownAt: string;
  /** First probe sample back to operational. Episodes still open are not returned. */
  probeUpAt: string;
  /** First page sample admitting anything, or null. */
  pageAdmittedAt: string | null;
  /** First page sample back to operational after admitting. Null while still open. */
  pageClearedAt: string | null;
  outcome: TrustOutcome;
  excluded: TrustExclusion | null;
  /** Minutes from `probeDownAt` to `pageAdmittedAt`. Null when never admitted. */
  delayMinutes: number | null;
  /** Observed outage, in minutes. */
  observedMinutes: number;
  /** How much of the observed outage the page had an incident open for. */
  admittedMinutes: number;
}

export interface BuildEpisodesInput {
  /** The probe's own readings, ascending. */
  probe: readonly TrustSample[];
  /** The page's readings — the provider's, or one component's — ascending. */
  page: readonly TrustSample[];
  /** Windows the page declared. An outage inside one is not dishonesty. */
  maintenance?: readonly TrustMaintenance[];
  /**
   * Probe sample timestamps read in a cycle where the whole fleet failed. A
   * container that cannot reach anything must not spend the outage recording
   * evidence that status pages are lying — the same rule 1.10 applies per
   * cycle, held for the length of an episode.
   */
  blindAt?: Iterable<string>;
  /**
   * Consecutive failing probe samples before an episode opens. Deliberately the
   * diff engine's own `confirmations` (roadmap 2.5) rather than a threshold
   * invented here: one bad sample opening a five-minute episode that no page on
   * earth would have admitted is how a card accuses a provider of dishonesty
   * with nothing behind it, and flap damping is the setting that already
   * answers that question elsewhere.
   */
  confirmations?: number;
}

const MINUTE = 60_000;

/** A reading that says something is wrong. `unknown` says nothing, so it is not one. */
function isDown(sample: TrustSample): boolean {
  return sample.ok && sample.status !== "operational" && sample.status !== "unknown";
}

/** A reading that says everything is fine. A failed read is not one either. */
function isUp(sample: TrustSample): boolean {
  return sample.ok && sample.status === "operational";
}

function ms(at: string): number {
  return Date.parse(at);
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((ms(to) - ms(from)) / MINUTE));
}

/**
 * The median gap between consecutive samples, in milliseconds — a series'
 * observed cadence.
 *
 * Read from the samples rather than from the provider's configured interval on
 * purpose: the interval is what it asks for *now*, and a card covering ninety
 * days is reading samples taken when it asked for something else. The median
 * also shrugs off the gaps a restart or a `Retry-After` hold leaves behind,
 * which a mean would not.
 */
export function observedCadenceMs(samples: readonly TrustSample[]): number {
  if (samples.length < 2) return 0;
  const gaps: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const gap = ms(samples[index]!.at) - ms(samples[index - 1]!.at);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * How long after the service recovered a page may still open the incident and
 * be counted as having admitted it, late.
 *
 * Scaled off the page's own cadence rather than fixed, so it is not one more
 * arbitrary threshold: twice the interval is the page having had two chances to
 * publish. Floored because a fast cadence would otherwise make the window
 * meaninglessly small, and capped because an hourly page would otherwise get a
 * grace period longer than most incidents.
 */
export function graceMs(pageCadenceMs: number): number {
  return Math.min(Math.max(2 * pageCadenceMs, 10 * MINUTE), 60 * MINUTE);
}

/** The page's first sample at or after `from` that admits something is wrong. */
function firstAdmission(page: readonly TrustSample[], from: number, until: number): TrustSample | null {
  for (const sample of page) {
    const at = ms(sample.at);
    if (at < from) continue;
    if (at > until) break;
    if (isDown(sample)) return sample;
  }
  return null;
}

/** The page's first sample after `from` that says it is fine again. */
function firstClearance(page: readonly TrustSample[], from: number): TrustSample | null {
  for (const sample of page) {
    if (ms(sample.at) <= from) continue;
    if (isUp(sample)) return sample;
  }
  return null;
}

function overlapsMaintenance(
  windows: readonly TrustMaintenance[],
  from: number,
  to: number,
): boolean {
  return windows.some((window) => {
    const start = ms(window.startsAt);
    const end = window.endsAt === null ? Number.POSITIVE_INFINITY : ms(window.endsAt);
    return start <= to && end >= from;
  });
}

/**
 * Fold two sample series into closed episodes of disagreement.
 *
 * An episode is one run of probe failures, from the first failing sample to the
 * first recovery. A run still failing at the end of the series is deliberately
 * not returned: its delay and its coverage are both unknowable until it ends,
 * and an episode that grows every cycle would move every number on the card
 * every cycle.
 */
export function buildEpisodes(input: BuildEpisodesInput): TrustEpisode[] {
  const { probe, page } = input;
  const maintenance = input.maintenance ?? [];
  const blind = new Set(input.blindAt ?? []);
  const confirmations = Math.max(1, input.confirmations ?? 1);
  const pageCadence = observedCadenceMs(page);
  const grace = graceMs(pageCadence);

  const episodes: TrustEpisode[] = [];
  let runStart: TrustSample | null = null;
  let runLength = 0;
  let runBlind = false;

  const close = (upAt: string): void => {
    if (runStart === null || runLength < confirmations) return;
    const downAt = runStart.at;
    const from = ms(downAt);
    const to = ms(upAt);

    const admission = firstAdmission(page, from, to + grace);
    const clearance = admission === null ? null : firstClearance(page, ms(admission.at));

    const outcome: TrustOutcome =
      admission === null ? "never" : ms(admission.at) <= to ? "admitted" : "after_recovery";

    // Only the part of the admission that overlaps the outage we observed
    // counts as covered. A page that opens an incident an hour after everything
    // recovered has not covered an hour of our outage.
    const admittedFrom = admission === null ? 0 : Math.max(from, ms(admission.at));
    const admittedTo =
      admission === null ? 0 : Math.min(to, clearance === null ? to : ms(clearance.at));
    const admittedMinutes =
      admission === null ? 0 : Math.max(0, Math.round((admittedTo - admittedFrom) / MINUTE));

    const excluded: TrustExclusion | null = runBlind
      ? "fleet_blind"
      : overlapsMaintenance(maintenance, from, to)
        ? "maintenance"
        : null;

    episodes.push({
      probeDownAt: downAt,
      probeUpAt: upAt,
      pageAdmittedAt: admission?.at ?? null,
      pageClearedAt: clearance?.at ?? null,
      outcome,
      excluded,
      delayMinutes: admission === null ? null : minutesBetween(downAt, admission.at),
      observedMinutes: minutesBetween(downAt, upAt),
      admittedMinutes,
    });
  };

  for (const sample of probe) {
    if (isDown(sample)) {
      if (runStart === null) {
        runStart = sample;
        runLength = 0;
        runBlind = false;
      }
      runLength += 1;
      if (blind.has(sample.at)) runBlind = true;
      continue;
    }
    // `unknown` and a failed read end nothing and start nothing: a probe that
    // did not answer is not the service recovering, and treating it as one
    // would close an episode in the middle of the outage it is measuring.
    if (!isUp(sample)) continue;
    if (runStart !== null) close(sample.at);
    runStart = null;
    runLength = 0;
    runBlind = false;
  }

  return episodes;
}

export interface TrustCard {
  /** Episodes inside the window that count — the denominator of everything below. */
  counted: number;
  /** Recorded inside the window but not counted, by reason. */
  excluded: { maintenance: number; fleetBlind: number };
  /** Median and p90 admission delay over the episodes the page did admit. */
  delay: { medianMinutes: number; p90Minutes: number; admitted: number } | null;
  /** Observed outage minutes, and how many of them the page had an incident open for. */
  coverage: { observedMinutes: number; admittedMinutes: number; percent: number } | null;
  never: number;
  afterRecovery: number;
  /**
   * The coarser of the two cadences, in minutes — the error bar on every
   * duration above. It travels with the card rather than sitting in a footnote:
   * "admitted in 34 minutes" against a page read every five minutes is
   * 34 ± 5, and an exported number with no error bar is the kind of thing that
   * gets quoted at a provider as though it were exact.
   */
  resolutionMinutes: number;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index]!;
}

/**
 * The card's numbers over a set of episodes already filtered to the window.
 *
 * Three axes, never one score. They are not substitutes for each other: a page
 * that always admits but ninety minutes late and one that admits instantly half
 * the time are different failures, and a single grade collapses them into the
 * same letter. The floor on how many episodes are needed before any of this is
 * shown is the caller's business, not this function's — it computes, it does
 * not decide what is publishable.
 */
export function summarise(
  episodes: readonly TrustEpisode[],
  cadences: { probeMs: number; pageMs: number },
): TrustCard {
  const counted = episodes.filter((episode) => episode.excluded === null);
  const delays = counted
    .map((episode) => episode.delayMinutes)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  const observedMinutes = counted.reduce((total, episode) => total + episode.observedMinutes, 0);
  const admittedMinutes = counted.reduce((total, episode) => total + episode.admittedMinutes, 0);

  return {
    counted: counted.length,
    excluded: {
      maintenance: episodes.filter((episode) => episode.excluded === "maintenance").length,
      fleetBlind: episodes.filter((episode) => episode.excluded === "fleet_blind").length,
    },
    delay:
      delays.length === 0
        ? null
        : {
            medianMinutes: quantile(delays, 0.5),
            p90Minutes: quantile(delays, 0.9),
            admitted: delays.length,
          },
    coverage:
      observedMinutes === 0
        ? null
        : {
            observedMinutes,
            admittedMinutes,
            percent: Math.round((admittedMinutes / observedMinutes) * 100),
          },
    never: counted.filter((episode) => episode.outcome === "never").length,
    afterRecovery: counted.filter((episode) => episode.outcome === "after_recovery").length,
    resolutionMinutes: Math.round(Math.max(cadences.probeMs, cadences.pageMs) / MINUTE),
  };
}
