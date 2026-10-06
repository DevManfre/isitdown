/**
 * The `createdAt` half of an active `Incident` — roadmap 1.1.
 *
 * Spread into the incident rather than assigned, so a page that publishes no
 * creation time leaves the key out altogether instead of carrying an
 * `undefined` one: the field means "the provider said when", and its absence
 * is the honest answer when it did not.
 *
 * Only a *publication* stamp belongs here (Statuspage `created_at`, Google's
 * `created`, Slack's `date_created`, …), never a start one. Pages let the
 * author backdate when an incident began ("degraded since 09:00", posted at
 * 09:40), and measuring detection from that would charge us for the forty
 * minutes the provider took to say anything. A page that publishes only a
 * start time therefore publishes no `createdAt` at all.
 */
export function createdAtOf(stamp: string | null | undefined): { createdAt?: string } {
  return stamp === null || stamp === undefined ? {} : { createdAt: stamp };
}
