import type { MaintenanceWindow, NormalizedStatus } from "./types.ts";

/**
 * Whether a declared window is running at the given instant.
 *
 * A window with a declared end is trusted over nothing else: a provider
 * that leaves one stuck `in_progress` for a week would otherwise silence
 * the provider for that week. Only a window with no declared end falls
 * back to the provider's own lifecycle word, because there is nothing
 * else to go on.
 *
 * Any unparseable timestamp — `at`, `startsAt`, or a declared `endsAt` —
 * makes the window NOT active, even when the lifecycle word says otherwise.
 * A malformed `endsAt` falling back to the lifecycle word could silence a
 * provider indefinitely, the exact failure the clock rule above exists to
 * prevent: failing towards noise beats failing towards silence.
 */
const RUNNING_LIFECYCLE = new Set(["in_progress", "verifying"]);

export function isActive(window: MaintenanceWindow, at: string): boolean {
  const now = Date.parse(at);
  const starts = Date.parse(window.startsAt);
  if (Number.isNaN(now) || Number.isNaN(starts)) return false;
  if (now < starts) return false;

  if (window.endsAt === null) return RUNNING_LIFECYCLE.has(window.status);

  const ends = Date.parse(window.endsAt);
  if (Number.isNaN(ends)) return false;
  return now < ends;
}

/** The windows running at the moment the status was fetched. */
export function activeWindows(status: NormalizedStatus): MaintenanceWindow[] {
  return status.maintenances.filter((window) => isActive(window, status.fetchedAt));
}
