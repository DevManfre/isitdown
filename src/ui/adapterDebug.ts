import type { CycleResult, ProviderResult } from "../core/poller.ts";

/**
 * What each provider's adapter did on the last few cycles (roadmap 5.18).
 *
 * Nine adapters now, one of them a CSS-selector scrape that is documented as
 * fragile, and until this existed the only way to see why a parse failed was to
 * tail the container logs. That is a shell away from a dashboard the operator
 * already has open, so the last few outcomes are kept here and served.
 *
 * In memory and bounded on purpose: these are diagnostics for the run in front
 * of you, not history. Persisting them would be a second, worse copy of
 * `status_samples`, which already answers "was it up" — this answers "did we
 * manage to read it, and what went wrong when we did not".
 */

/** How many outcomes are kept per provider. */
const KEEP = 20;

export interface AdapterProbe {
  /** ISO 8601, UTC. */
  at: string;
  ok: boolean;
  attempts: number;
  /** The whole read, retries included. */
  durationMs: number;
  /** A 304: a real round trip whose body was replayed from our cache. */
  notModified?: boolean | undefined;
  /** Present only on a failure, and it is the whole point of the panel. */
  error?: string | undefined;
  /**
   * Why a read that succeeded still did not say "operational" — a probe's own
   * account of itself (roadmap 1.8). A status page never sets one: its reading
   * comes with the provider's incidents attached, which say it already.
   */
  note?: string | undefined;
}

export interface AdapterDebugStore {
  /** Records one cycle's outcomes, one probe per provider it polled. */
  recordCycle(result: CycleResult): void;
  /** Newest first, so a panel reads top-down. Empty for a provider never polled. */
  list(providerId: string): AdapterProbe[];
  /** Drops a provider's probes — its rows are gone, so are its diagnostics. */
  forget(providerId: string): void;
}

export function createAdapterDebugStore(): AdapterDebugStore {
  const probes = new Map<string, AdapterProbe[]>();

  const probeOf = (result: ProviderResult, at: string): AdapterProbe => ({
    at,
    ok: result.ok,
    attempts: result.attempts,
    durationMs: result.durationMs,
    ...(result.notModified === undefined ? {} : { notModified: result.notModified }),
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.note === undefined ? {} : { note: result.note }),
  });

  return {
    recordCycle(result: CycleResult): void {
      for (const outcome of result.results) {
        // Stamped with the cycle's own end rather than with `Date.now()`: every
        // probe from one cycle should read as one cycle, and a fleet of thirty
        // providers otherwise spreads across the seconds the cycle took.
        const kept = [probeOf(outcome, result.finishedAt), ...(probes.get(outcome.providerId) ?? [])];
        probes.set(outcome.providerId, kept.slice(0, KEEP));
      }
    },

    list(providerId: string): AdapterProbe[] {
      return probes.get(providerId) ?? [];
    },

    forget(providerId: string): void {
      probes.delete(providerId);
    },
  };
}
