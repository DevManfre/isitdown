import { useMemo } from "react";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { fleetSlice, OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { summaryProviders } from "@/lib/history.ts";
import type { FleetFilter } from "../../dashboardLayout.ts";

/**
 * One widget's share of the fleet, with the day buckets its rows draw. Reads
 * the same `["status"]` and 90-day history entries the Overview's hero does, so
 * five widgets on a page are not five fetches.
 */
export function useFleetSlice(filter: FleetFilter) {
  const { data: status } = useStatus();
  const { data: summary } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  const configured = status?.providers ?? [];
  const slice = fleetSlice(configured, status?.groups ?? [], filter);
  const buckets = useMemo(
    () => new Map(summaryProviders(summary).map((p) => [p.providerId, p.buckets])),
    [summary],
  );
  return { ...slice, buckets, configured };
}
