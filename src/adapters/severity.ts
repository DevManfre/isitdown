import type { OverallStatus } from "../core/types.ts";

/**
 * Reading a severity out of a provider's own wording, shared by the adapters
 * whose provider publishes no severity field at all (the generic feed adapter,
 * Slack). Statuspage does publish one, so it never comes through here.
 */

/**
 * Severity by wording, worst first, with `partial` ahead of the outage words it
 * contains. Text matching nothing still reads `degraded`: the provider thought
 * it worth announcing, so it is never nothing.
 */
const SEVERITIES: [RegExp, OverallStatus][] = [
  [/\bpartial\b/i, "partial_outage"],
  [/\b(outage|down|offline|unavailable|unreachable|not working)\b/i, "major_outage"],
];

/** Never `operational`: the caller decides that from the absence of an entry. */
export function severityFromWords(text: string): OverallStatus {
  return SEVERITIES.find(([pattern]) => pattern.test(text))?.[1] ?? "degraded";
}

/** Severity worst last, so the worst entry decides the provider's reading. */
const RANK: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

/** Folds many readings into the one the provider is reported as. */
export function worstStatus(statuses: Iterable<OverallStatus>): OverallStatus {
  const worst = [...statuses].reduce((rank, status) => Math.max(rank, RANK.indexOf(status)), 0);
  return RANK[worst]!;
}
