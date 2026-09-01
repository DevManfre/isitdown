/** The idle rhythm the dashboard re-reads the server's stored state on. */
export const REFRESH_MS = 30_000;

/**
 * How fast the dashboard re-asks once the deadline has passed but the server
 * has not published the next one yet — the window in which the cycle is
 * actually running upstream.
 */
export const DUE_REFRESH_MS = 3_000;

/** Never ask faster than this, whatever the deadline says. */
const FLOOR_MS = 1_000;

/**
 * How long until the server's next cycle, on the *server's* clock.
 *
 * `nextPollAt` is stamped by the container and was being compared against the
 * browser's `Date.now()`, which quietly assumes the two agree. They routinely
 * do not: a WSL2 or VM clock drifts away from its host's across a suspend, and
 * a browser clock that is even a few minutes ahead of the container's makes
 * every deadline look expired — the countdown then reads "0s" permanently, and
 * rights itself only when the host clock resyncs. That is invisible to any
 * test run beside the server, because those share its clock.
 *
 * So the offset between the two clocks is measured from the response itself:
 * `serverNow` is what the server's clock read as it answered, `dataUpdatedAt`
 * is what the browser's read when the answer landed. The difference is the
 * skew (plus the request's latency, which is milliseconds), and shifting the
 * deadline by it puts the countdown back on the server's clock.
 *
 * Returns `null` when there is no deadline to count down to.
 */
export function msUntilNextPoll(
  data: { nextPollAt: string | null; serverNow?: string | null } | undefined,
  dataUpdatedAt: number,
  clientNow: number,
): number | null {
  const nextPollAt = data?.nextPollAt;
  if (nextPollAt === null || nextPollAt === undefined) return null;

  const deadline = Date.parse(nextPollAt);
  if (Number.isNaN(deadline)) return null;

  // No `serverNow` (an older server, a response from cache) means no way to
  // measure the skew — fall back to trusting the browser's clock, which is
  // what the dashboard did before.
  const serverNow = data?.serverNow === undefined || data?.serverNow === null ? NaN : Date.parse(data.serverNow);
  const skew = Number.isNaN(serverNow) || dataUpdatedAt === 0 ? 0 : dataUpdatedAt - serverNow;

  return deadline + skew - clientNow;
}

/**
 * How long to wait before re-reading `/status`.
 *
 * The countdown in the header is drawn client-side from `nextPollAt`, so it
 * reaches zero on its own and then has nothing left to show until a refetch
 * brings the next deadline. On a flat 30s rhythm that left "0s" on screen for
 * up to half a minute after every cycle — the symptom operators reported as
 * the countdown being stuck. Asking as the deadline expires, and again shortly
 * after while the cycle is still running, closes that window without polling
 * the server any harder the rest of the time.
 */
export function statusRefetchDelay(msLeft: number | null): number {
  if (msLeft === null) return REFRESH_MS;
  if (msLeft <= 0) return DUE_REFRESH_MS;

  // A second past the deadline rather than exactly on it: the server writes
  // `nextPollAt` when the cycle *finishes*, so asking on the dot answers with
  // the old deadline and costs a whole extra round.
  return Math.min(REFRESH_MS, Math.max(FLOOR_MS, msLeft + 1_000));
}
