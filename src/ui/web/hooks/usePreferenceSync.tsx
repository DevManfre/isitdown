import { useEffect, useRef, useState } from "react";
import { usePreferences } from "./queries.ts";
import { useTheme } from "./useTheme.tsx";
import { adoptLocale } from "@/lib/i18n.ts";

/**
 * The read half of the preference round-trip: applies the theme and UI locale
 * the server remembers, so a fresh browser (or one whose storage was cleared)
 * starts where the operator left off.
 *
 * This is why the design spec (§7.4) has the choice persisted twice at all.
 * `Header` already wrote both halves through `usePreferencesMutation`, but
 * nothing read the database back — `useTheme` initialised from localStorage
 * alone and `i18n.ts` set `lng` from localStorage alone, so
 * `PATCH /api/preferences` was writing to something no one ever read.
 *
 * localStorage still wins. Both `adopt` calls below are no-ops when this
 * browser already carries the operator's own choice: the pre-paint script in
 * index.html has stamped that choice before React ran, and overriding it a beat
 * later would produce exactly the flash of the wrong theme that the pre-paint
 * script exists to prevent. The server value seeds, it does not override.
 *
 * It seeds once. A later refetch of `["preferences"]` — or the `setQueryData`
 * that `usePreferencesMutation` does after the operator's own write — must not
 * re-apply anything, or a stale server value could stamp itself back over a
 * choice just made. Hence the ref, rather than keying the effect on the data.
 *
 * Returns whether that seed has finished, because a seed that lands is a change
 * of theme or locale, and both are in `viewKey` — so it remounts the view and
 * restarts its entry animation. On a browser with no stored choice that used to
 * put the whole page through the cascade twice, once in the default theme and
 * again in the operator's. `App` holds the view until this turns true, so the
 * page enters once, already in the theme and language it will keep.
 */
export function usePreferenceSync(): boolean {
  const { data, status, fetchStatus } = usePreferences();
  const { adopt } = useTheme();
  const seeded = useRef(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (seeded.current) return;

    if (data === undefined) {
      // Nothing to seed with, and nothing more coming: the server has not
      // answered (this query never throws) or it is not being asked. Waiting on
      // it any longer would hold the page for a preference that will not arrive.
      if (status === "pending" && fetchStatus === "fetching") return;
      seeded.current = true;
      setApplied(true);
      return;
    }

    seeded.current = true;
    adopt(data.theme);
    // Both halves before the view is released, not just the theme: a locale
    // arriving a beat later is a second remount and a second cascade.
    void adoptLocale(data.uiLocale).finally(() => setApplied(true));
  }, [data, adopt, status, fetchStatus]);

  return applied;
}
