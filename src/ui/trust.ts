import type { DatabaseSync } from "node:sqlite";
import {
  buildEpisodes,
  observedCadenceMs,
  summarise,
  type TrustCard,
  type TrustEpisode,
  type TrustSample,
} from "./trustEpisodes.ts";

/**
 * Provider trust card (roadmap 8.1) — the storage half.
 *
 * `trustEpisodes.ts` folds two sample series into episodes and says nothing
 * about databases; this file reads the series out of SQLite, hands them over,
 * writes back the closed episodes, and answers the card's two questions (the
 * numbers, and the rows behind them).
 *
 * Two decisions worth keeping in view while reading it:
 *
 *  - **Nothing new is written at poll time.** The episodes are derived from
 *    samples the poller already stores, so `src/core` is untouched, the Light
 *    edition is unaffected, and the same build that runs after a cycle can be
 *    pointed at years of stored samples to backfill. A feature that needs ten
 *    episodes before it says anything cannot afford to start counting on the
 *    day it ships.
 *  - **The build is incremental and idempotent.** Each pair resumes from its
 *    own last episode, and the unique key makes a re-run a no-op rather than a
 *    duplicate — which is what lets it be called from a schedule, from a
 *    backfill and from a test without three different guards.
 */

/** A probe and the page it is a second opinion on. `componentId` empty = the whole page. */
export interface TrustPair {
  probeId: string;
  pageId: string;
  componentId: string;
}

export interface StoredEpisode extends TrustEpisode {
  resolutionMinutes: number;
}

const MINUTE = 60_000;
/**
 * Episodes needed inside the selected window before any number is shown.
 *
 * High on purpose. Ten disagreements is a lot of disagreements — on an honest
 * provider it is years, and the card will simply never appear, which is the
 * correct outcome. Three episodes are an anecdote, and an anecdote formatted as
 * a median and a percentage reads like evidence.
 */
export const EPISODE_FLOOR = 10;

/** The minute an ISO timestamp falls in — the bucket blindness is judged in. */
function minuteBucket(at: string): number {
  return Math.floor(Date.parse(at) / MINUTE);
}

export function createTrustService(db: DatabaseSync) {
  const selectSamples = db.prepare(
    `SELECT observed_at, overall_status, ok FROM status_samples
     WHERE provider_id = ? AND observed_at > ? ORDER BY observed_at ASC`,
  );
  const selectComponentSamples = db.prepare(
    `SELECT observed_at, status AS overall_status, ok FROM component_samples
     WHERE provider_id = ? AND component_id = ? AND observed_at > ? ORDER BY observed_at ASC`,
  );
  const selectMaintenance = db.prepare(
    "SELECT starts_at, ends_at FROM maintenances WHERE provider_id = ?",
  );
  const selectWatermark = db.prepare(
    `SELECT MAX(probe_up_at) AS watermark FROM trust_episodes
     WHERE probe_id = ? AND page_id = ? AND component_id = ?`,
  );
  const insertEpisode = db.prepare(
    `INSERT OR IGNORE INTO trust_episodes
       (probe_id, page_id, component_id, probe_down_at, probe_up_at, page_admitted_at,
        page_cleared_at, outcome, excluded, delay_minutes, observed_minutes,
        admitted_minutes, resolution_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectEpisodes = db.prepare(
    `SELECT probe_down_at, probe_up_at, page_admitted_at, page_cleared_at, outcome, excluded,
            delay_minutes, observed_minutes, admitted_minutes, resolution_minutes
     FROM trust_episodes
     WHERE probe_id = ? AND page_id = ? AND component_id = ? AND probe_down_at >= ?
     ORDER BY probe_down_at DESC`,
  );
  /**
   * Every provider that is not a probe, read in the same minute. Used to decide
   * whether the container itself was blind: if every page we asked in that
   * minute failed to answer, the probes' readings from it are evidence about
   * our network, not about anybody's honesty.
   */
  const selectPageFailures = db.prepare(
    `SELECT observed_at, ok FROM status_samples
     WHERE provider_id IN (SELECT id FROM services WHERE adapter NOT IN ('http', 'tcp', 'dns'))
       AND observed_at > ?`,
  );

  function samplesFor(pair: TrustPair, after: string): TrustSample[] {
    const rows = (
      pair.componentId === ""
        ? selectSamples.all(pair.pageId, after)
        : selectComponentSamples.all(pair.pageId, pair.componentId, after)
    ) as { observed_at: string; overall_status: string; ok: number }[];
    return rows.map((row) => ({
      at: row.observed_at,
      status: row.overall_status as TrustSample["status"],
      ok: row.ok === 1,
    }));
  }

  /**
   * Minutes in which every status page that answered, did not.
   *
   * Derived rather than recorded, because the poller's own fleet-blind warning
   * is a log line and a note, not a column — and adding one would have meant
   * touching core for a UI-edition feature. Probes are excluded from the vote
   * deliberately: a probe that cannot reach the service reports that as a
   * reading (roadmap 1.8 inverts the contract), so counting it would make a
   * real outage look like our own blindness and quietly excuse the page.
   */
  function blindMinutes(after: string): Set<number> {
    const rows = selectPageFailures.all(after) as { observed_at: string; ok: number }[];
    const answered = new Map<number, { total: number; failed: number }>();
    for (const row of rows) {
      const bucket = minuteBucket(row.observed_at);
      const tally = answered.get(bucket) ?? { total: 0, failed: 0 };
      tally.total += 1;
      if (row.ok !== 1) tally.failed += 1;
      answered.set(bucket, tally);
    }
    const blind = new Set<number>();
    for (const [bucket, tally] of answered) {
      // Two, for the same reason `looksLikeOurOwnNetwork` asks for two: one
      // page failing is one page failing.
      if (tally.total >= 2 && tally.total === tally.failed) blind.add(bucket);
    }
    return blind;
  }

  return {
    /**
     * Fold every pair's samples into episodes, resuming from each pair's own
     * last one. Safe to call repeatedly: an episode already written is ignored
     * rather than duplicated.
     */
    rebuild(pairs: readonly TrustPair[], options: { confirmations?: number } = {}): number {
      let written = 0;
      for (const pair of pairs) {
        const row = selectWatermark.get(pair.probeId, pair.pageId, pair.componentId) as
          | { watermark: string | null }
          | undefined;
        // Episodes are closed and never revised, so the resume point is the end
        // of the last one: re-reading the samples before it could only produce
        // rows the unique key would throw away.
        const after = row?.watermark ?? "";

        const probeRows = selectSamples.all(pair.probeId, after) as {
          observed_at: string;
          overall_status: string;
          ok: number;
        }[];
        if (probeRows.length === 0) continue;
        const probe: TrustSample[] = probeRows.map((sample) => ({
          at: sample.observed_at,
          status: sample.overall_status as TrustSample["status"],
          ok: sample.ok === 1,
        }));
        const page = samplesFor(pair, after);
        const maintenance = (
          selectMaintenance.all(pair.pageId) as { starts_at: string; ends_at: string | null }[]
        ).map((window) => ({ startsAt: window.starts_at, endsAt: window.ends_at }));

        const blind = blindMinutes(after);
        const blindAt = probe
          .filter((sample) => blind.has(minuteBucket(sample.at)))
          .map((sample) => sample.at);

        const episodes = buildEpisodes({
          probe,
          page,
          maintenance,
          blindAt,
          ...(options.confirmations === undefined ? {} : { confirmations: options.confirmations }),
        });
        const resolutionMinutes = Math.round(
          Math.max(observedCadenceMs(probe), observedCadenceMs(page)) / MINUTE,
        );

        for (const episode of episodes) {
          const result = insertEpisode.run(
            pair.probeId,
            pair.pageId,
            pair.componentId,
            episode.probeDownAt,
            episode.probeUpAt,
            episode.pageAdmittedAt,
            episode.pageClearedAt,
            episode.outcome,
            episode.excluded,
            episode.delayMinutes,
            episode.observedMinutes,
            episode.admittedMinutes,
            resolutionMinutes,
          );
          written += Number(result.changes);
        }
      }
      return written;
    },

    /** Every episode of a pair inside the window, newest first — the evidence rows. */
    episodes(pair: TrustPair, days: number, now = new Date()): StoredEpisode[] {
      const from = new Date(now.getTime() - days * 24 * 60 * MINUTE).toISOString();
      const rows = selectEpisodes.all(pair.probeId, pair.pageId, pair.componentId, from) as {
        probe_down_at: string;
        probe_up_at: string;
        page_admitted_at: string | null;
        page_cleared_at: string | null;
        outcome: string;
        excluded: string | null;
        delay_minutes: number | null;
        observed_minutes: number;
        admitted_minutes: number;
        resolution_minutes: number;
      }[];
      return rows.map((row) => ({
        probeDownAt: row.probe_down_at,
        probeUpAt: row.probe_up_at,
        pageAdmittedAt: row.page_admitted_at,
        pageClearedAt: row.page_cleared_at,
        outcome: row.outcome as TrustEpisode["outcome"],
        excluded: row.excluded as TrustEpisode["excluded"],
        delayMinutes: row.delay_minutes,
        observedMinutes: row.observed_minutes,
        admittedMinutes: row.admitted_minutes,
        resolutionMinutes: row.resolution_minutes,
      }));
    },

    /**
     * The card for one pair over one window, or null when the window holds
     * fewer than ten counted episodes.
     *
     * The floor is applied *inside the window*, not against the pair's whole
     * history: a 30-day view built on two episodes would otherwise print a
     * median and a percentage that look exactly as authoritative as a 90-day
     * view built on fifteen.
     */
    card(
      pair: TrustPair,
      days: number,
      now = new Date(),
    ): (TrustCard & { pair: TrustPair; days: number }) | { pair: TrustPair; days: number; counted: number; floor: number } {
      const episodes = this.episodes(pair, days, now);
      const resolution = episodes.reduce(
        (worst, episode) => Math.max(worst, episode.resolutionMinutes),
        0,
      );
      const summary = summarise(episodes, {
        probeMs: resolution * MINUTE,
        pageMs: resolution * MINUTE,
      });
      if (summary.counted < EPISODE_FLOOR) {
        return { pair, days, counted: summary.counted, floor: EPISODE_FLOOR };
      }
      return { ...summary, pair, days };
    },
  };
}

export type TrustService = ReturnType<typeof createTrustService>;
