import type { ProviderRuntimeState } from "./stateStore.interface.ts";
import type { OverallStatus, Suspicion } from "./types.ts";

/** Severity worst last; `unknown` is never a suspicion, so it does not rank. */
const RANK: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

/**
 * The one suspicion worth showing for a provider — roadmap 1.3 — or null.
 *
 * Several probes may accuse one page; the worst reading among them is what the
 * provider is suspected of, and among equals the oldest, so "since" says how
 * long the page has been contradicted at all.
 *
 * A suspicion is shown only while the page still says operational and admits
 * nothing. A probe is re-read on its own cadence, so between two of its reads
 * the page may already have caught up; once it has, the page's own word is the
 * news, and a stale suspicion beside it would be a second, weaker claim about
 * the same outage.
 */
export function openSuspicion(state: ProviderRuntimeState): Suspicion | null {
  const page = state.last;
  if (page === null || page.overallStatus !== "operational" || page.activeIncidents.length > 0) return null;
  const sorted = [...state.suspicions].sort(
    (a, b) => RANK.indexOf(b.status) - RANK.indexOf(a.status) || a.since.localeCompare(b.since),
  );
  return sorted[0] ?? null;
}
