import { createHash } from "node:crypto";
import type { Freshness, NormalizedStatus, StaleReading } from "./types.ts";

const DAY_MS = 24 * 60 * 60_000;

/**
 * Stillness shorter than this is never suspicious, however lively the provider
 * has been: a busy page having a quiet week is the most ordinary thing there is.
 */
const MIN_STILL_MS = 7 * DAY_MS;
/**
 * How many of its own longest quiet spells a reading has to outlast. Measured
 * against the provider's record rather than a fixed number of days, because
 * "unchanged for a month" is alarming on GitHub's page and unremarkable on a
 * page that has had two incidents in a year.
 */
const STILL_FACTOR = 3;
/**
 * Changes seen before the provider's record means anything. The first one is
 * measured from when we started watching, not from when the page last moved,
 * so a record of one change is a guess.
 */
const MIN_CHANGES = 3;
/**
 * A gap between two reads longer than this means nobody was watching — the
 * container was stopped, or the page failed to read for a day. The page may
 * well have moved and moved back in between, so the stillness clock restarts.
 */
const BLIND_MS = DAY_MS;
/**
 * How long a page that lost half its components is flagged before the smaller
 * shape is taken as the new normal. A provider does retire components; a month
 * of a tile saying so is enough for an operator to have looked.
 */
const SHAPE_SETTLES_MS = 30 * DAY_MS;

/**
 * What a reading says, the moment it was taken left out — so two polls of a
 * page that has not moved hash the same.
 */
export function fingerprintOf(status: NormalizedStatus): string {
  const content = JSON.stringify([
    status.overallStatus,
    status.activeIncidents,
    status.components,
    status.maintenances,
  ]);
  return createHash("sha256").update(content).digest("base64url").slice(0, 22);
}

/**
 * Folds one successful reading into the provider's freshness — roadmap 1.8.
 *
 * Returns `previous` itself when nothing it holds has moved, so the caller can
 * skip the write on the overwhelmingly common poll that read the same page as
 * last time. `previousReadAt` is when the reading before this one was taken; a
 * gap longer than a day restarts the stillness clock rather than letting the
 * days nobody watched count as days the page held still.
 */
export function advanceFreshness(
  previous: Freshness | null,
  status: NormalizedStatus,
  previousReadAt: string | null,
): Freshness {
  const at = status.fetchedAt;
  const fingerprint = fingerprintOf(status);
  const components = status.components.length;
  if (previous === null) {
    return {
      fingerprint,
      since: at,
      changes: 0,
      longestStillMs: 0,
      components,
      peakComponents: components,
      shrunkSince: null,
    };
  }

  let next = previous;
  if (fingerprint !== previous.fingerprint) {
    const still = Date.parse(at) - Date.parse(previous.since);
    next = {
      ...next,
      fingerprint,
      since: at,
      changes: previous.changes + 1,
      longestStillMs: Math.max(previous.longestStillMs, Number.isFinite(still) ? still : 0),
      components,
    };
  } else if (
    previousReadAt !== null &&
    Date.parse(at) - Date.parse(previousReadAt) > BLIND_MS
  ) {
    next = { ...next, since: at };
  }

  if (components > next.peakComponents) {
    next = { ...next, peakComponents: components, shrunkSince: null };
  } else if (components * 2 < next.peakComponents) {
    if (next.shrunkSince === null) {
      next = { ...next, shrunkSince: at };
    } else if (Date.parse(at) - Date.parse(next.shrunkSince) >= SHAPE_SETTLES_MS) {
      next = { ...next, peakComponents: components, shrunkSince: null };
    }
  } else if (next.shrunkSince !== null) {
    next = { ...next, shrunkSince: null };
  }
  return next;
}

/**
 * Whether a provider's reading looks like an adapter that stopped reading —
 * roadmap 1.8 — or null.
 *
 * Two shapes of the same failure. A scraper whose selector stopped matching
 * reads the same thing forever, which on a page that used to move is
 * `unchanged`; a parser that lost its way through a reshaped page reads fewer
 * of the components it used to, which is `shrunk`. Neither touches the reading
 * itself: the page may genuinely be calm, and this only says we can no longer
 * tell.
 */
export function staleReading(freshness: Freshness | null, at: string): StaleReading | null {
  if (freshness === null) return null;
  if (freshness.shrunkSince !== null) {
    return {
      reason: "shrunk",
      since: freshness.shrunkSince,
      components: freshness.components,
      expected: freshness.peakComponents,
    };
  }
  if (freshness.changes < MIN_CHANGES) return null;
  const still = Date.parse(at) - Date.parse(freshness.since);
  const threshold = Math.max(MIN_STILL_MS, STILL_FACTOR * freshness.longestStillMs);
  if (!(still >= threshold)) return null;
  return { reason: "unchanged", since: freshness.since, longestStillMs: freshness.longestStillMs };
}
