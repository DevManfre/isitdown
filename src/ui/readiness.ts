/**
 * Readiness, apart from liveness — roadmap 6.9.
 *
 * `GET /health` answers "the process is up", which is all a liveness probe may
 * ever mean: it must not fail because a provider is unreachable, or a restart
 * would be the answer to someone else's outage. That leaves the failure an
 * operator actually wants surfaced — an instance whose poll cycle has been
 * failing all day — reported by nothing, since the container looked healthy
 * throughout. This is that reading, and it is the one the container's
 * healthcheck asks for.
 *
 * Decided here rather than in the route so the staleness window is testable
 * without waiting three poll intervals for a real one to pass.
 */

export interface CycleSummary {
  finishedAt: string;
  providers: number;
  failed: number;
}

export interface ReadinessReport {
  status: "ready" | "not_ready";
  /** Configured providers, whether the last cycle got to them or not. */
  providers: number;
  /** Failures in the last cycle, `null` when none has completed. */
  failed: number | null;
  lastCycleAt: string | null;
  /** Age of the last cycle, `null` when none has completed. */
  ageSeconds: number | null;
  staleAfterSeconds: number;
  /** Present only when not ready: what an operator has to go and look at. */
  reason?: string;
}

/**
 * Intervals a cycle may be overdue by before readiness fails. Three, like the
 * Light edition's state-file check, so one slow or failed cycle absorbs into
 * the slack instead of flapping the container.
 */
const ALLOWED_INTERVALS = 3;

export function readiness(input: {
  cycle: CycleSummary | null;
  providerCount: number;
  intervalMinutes: number;
  now: Date;
}): ReadinessReport {
  const staleAfterSeconds = input.intervalMinutes * 60 * ALLOWED_INTERVALS;
  const { cycle } = input;

  if (cycle === null) {
    return {
      status: "not_ready",
      providers: input.providerCount,
      failed: null,
      lastCycleAt: null,
      ageSeconds: null,
      staleAfterSeconds,
      reason: "no poll cycle has completed yet",
    };
  }

  const ageSeconds = Math.round((input.now.getTime() - Date.parse(cycle.finishedAt)) / 1000);
  const report: ReadinessReport = {
    status: "ready",
    providers: input.providerCount,
    failed: cycle.failed,
    lastCycleAt: cycle.finishedAt,
    ageSeconds,
    staleAfterSeconds,
  };

  if (ageSeconds > staleAfterSeconds) {
    return {
      ...report,
      status: "not_ready",
      reason: `last cycle finished ${ageSeconds}s ago, allowed ${staleAfterSeconds}s`,
    };
  }

  // Some providers failing is normal — that is what the dashboard is for. Every
  // one of them failing is us: a lost network, a wedged DNS resolver, a clock
  // so far off that every TLS handshake is refused.
  if (cycle.providers > 0 && cycle.failed === cycle.providers) {
    return {
      ...report,
      status: "not_ready",
      reason: `every provider failed in the last cycle (${cycle.failed} of ${cycle.providers})`,
    };
  }

  return report;
}
