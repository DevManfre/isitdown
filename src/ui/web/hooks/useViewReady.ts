import { useEffect, useState } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";

/**
 * How long a view may stay held waiting for a first response before it is
 * shown anyway. A request that never settles (a hung server, a connection the
 * browser has parked) must cost the operator a slow page, not a blank one.
 */
const HOLD_CAP_MS = 1500;

/**
 * A query nothing can be drawn from yet: it has a live observer, has never
 * resolved, and is on the wire right now.
 *
 * Deliberately narrower than "not settled". A query with data that is merely
 * refetching does not hold the view — that is the background poll, and the
 * dashboard has always redrawn through those without replaying anything. A
 * query that is `pending` but idle does not hold it either: that is a disabled
 * one (`useMap` when the operator has the map off), which will never resolve
 * because it was never asked to.
 */
const isFirstLoad = (query: Query): boolean =>
  query.getObserversCount() > 0 &&
  query.state.status === "pending" &&
  query.state.fetchStatus === "fetching";

/**
 * Whether the view around this hook has enough data to be worth showing.
 *
 * The view's entry animation used to start at mount, which on a reload is
 * before any of its data exists — so the hero played its cascade against an
 * empty fleet, `/status` landed 170ms later and the rows played a second
 * cascade of their own, `/history` landed at 310ms and the bars appeared
 * inside rows that had already finished arriving. Three arrival waves, each
 * with its own zero, and an Overview that briefly claimed the operator had no
 * providers configured.
 *
 * So the view is held until its first loads have come back, and everything
 * enters once, from one origin. Held, not unmounted: the queries live inside
 * the view, so a view that does not render never fetches and would wait
 * forever. `ViewFrame` keeps the subtree mounted and invisible (motion.css's
 * `#view:not([data-animate])`) and stamps `data-animate` the moment this turns
 * true, which is what starts every entry animation on the page at once.
 *
 * `held` is anything else the caller is still waiting on — the preference seed,
 * which changes the theme and the locale and so remounts the view underneath
 * this. The hold cap outranks it, so a stuck caller costs a slow page and not a
 * blank one, the same way a stuck request does.
 *
 * State resets with the view because `ViewFrame` is keyed on it and remounts.
 */
export function useViewReady(held = false): boolean {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    const cache = client.getQueryCache();
    const settled = (): boolean => !cache.getAll().some(isFirstLoad);

    const timer = setTimeout(() => setCapped(true), HOLD_CAP_MS);

    // This runs after the view's own subscription effects (children commit
    // before parents), so by now its queries are on the wire and can be seen. A
    // view whose data is already cached settles here and animates immediately.
    if (settled()) {
      setReady(true);
      return () => clearTimeout(timer);
    }

    const unsubscribe = cache.subscribe(() => {
      if (settled()) setReady(true);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [client]);

  return capped || (ready && !held);
}
