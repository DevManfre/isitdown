import type { OperatorMaintenanceWindow } from "./configSource.interface.ts";
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

/** The id prefix that marks a window as the operator's rather than the provider's (roadmap 5.3). */
export const OPERATOR_WINDOW_PREFIX = "operator:";

/**
 * The reading with the operator's own maintenance windows merged in — roadmap
 * 5.3. Merged into the reading rather than checked beside it, so everything
 * that already understands a provider's window — the diff engine's silence and
 * its started/ended messages, the heads-up before one opens, the timeline that
 * draws it — understands the operator's without being told it exists.
 *
 * Only windows not yet over are merged: one that has ended drops out of the
 * next reading, which is how the diff engine sees it end. The id is the
 * window's own span, so the same declaration is the same window on every poll
 * and a stored window is updated rather than duplicated. Windows already in the
 * reading under the operator prefix are replaced, never stacked, so a reading
 * handed back unchanged (a 304) cannot carry yesterday's copy forward.
 */
export function withOperatorMaintenance(
  status: NormalizedStatus,
  windows: readonly OperatorMaintenanceWindow[] | undefined,
): NormalizedStatus {
  // Read defensively: a reading with no list at all (an adapter stub, an old
  // stored row) is handed back untouched rather than given one.
  const listed: MaintenanceWindow[] = (status.maintenances as MaintenanceWindow[] | undefined) ?? [];
  const own = listed.filter((window) => !window.id.startsWith(OPERATOR_WINDOW_PREFIX));
  if ((windows === undefined || windows.length === 0) && own.length === listed.length) return status;
  const now = Date.parse(status.fetchedAt);
  const declared: MaintenanceWindow[] = [];
  for (const window of windows ?? []) {
    const starts = Date.parse(window.startsAt);
    const ends = Date.parse(window.endsAt);
    if (Number.isNaN(starts) || Number.isNaN(ends) || Number.isNaN(now) || ends <= now) continue;
    const startsAt = new Date(starts).toISOString();
    const endsAt = new Date(ends).toISOString();
    declared.push({
      id: `${OPERATOR_WINDOW_PREFIX}${startsAt}/${endsAt}`,
      name: window.title,
      status: now >= starts ? "in_progress" : "scheduled",
      startsAt,
      endsAt,
      componentIds: [],
    });
  }
  return { ...status, maintenances: [...own, ...declared] };
}
