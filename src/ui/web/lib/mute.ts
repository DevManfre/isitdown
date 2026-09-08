/**
 * Whether a mute is still running. Shared rather than compared inline in each
 * view: a mute that has expired is still stored, and every surface has to agree
 * about when it stops counting — the server drops an expired one from
 * `/config`, but a dashboard left open across the expiry would otherwise keep
 * showing the badge until the next fetch.
 */
export function isMuted(mutedUntil: string | null | undefined, at: number = Date.now()): boolean {
  if (mutedUntil === null || mutedUntil === undefined) return false;
  const ends = Date.parse(mutedUntil);
  return !Number.isNaN(ends) && ends > at;
}
