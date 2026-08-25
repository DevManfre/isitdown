import { useEffect, useRef } from "react";
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
 */
export function usePreferenceSync(): void {
  const { data } = usePreferences();
  const { adopt } = useTheme();
  const seeded = useRef(false);

  useEffect(() => {
    if (data === undefined || seeded.current) return;
    seeded.current = true;
    adopt(data.theme);
    void adoptLocale(data.uiLocale);
  }, [data, adopt]);
}
