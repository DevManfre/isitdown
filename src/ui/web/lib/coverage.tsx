import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DayCoverage } from "@/lib/types.ts";

/**
 * The poller's own liveness, shared with every chart on the page — roadmap
 * 10.1.
 *
 * A context rather than a prop, because coverage is a property of the poller
 * and not of a provider: one loop reads the whole fleet, so a gap is the same
 * gap on every bar. Threading one identical array through the four hand-built
 * view models the tables and cards use would be four chances for a chart to be
 * drawn without its caveat, and a caveat that is sometimes absent is worse than
 * none — it teaches the operator that an unhatched bar means "watched", which
 * would then be untrue on the views that forgot.
 *
 * The default is empty, which reads as "nothing is known about coverage" rather
 * than "coverage was complete". A chart outside a provider draws exactly as it
 * did before this existed.
 */
const CoverageContext = createContext<ReadonlyMap<string, number | null>>(
  new Map(),
);

export function CoverageProvider({
  coverage,
  children,
}: {
  coverage: DayCoverage[] | undefined;
  children: ReactNode;
}) {
  const byDay = useMemo(
    () =>
      new Map(
        (coverage ?? []).map((entry) => [entry.day, entry.observed] as const),
      ),
    [coverage],
  );
  return (
    <CoverageContext.Provider value={byDay}>
      {children}
    </CoverageContext.Provider>
  );
}

/** How much of each day the poller was running, by day key. */
export function useCoverage(): ReadonlyMap<string, number | null> {
  return useContext(CoverageContext);
}
