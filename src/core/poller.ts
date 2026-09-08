import type { Adapter } from "./adapter.interface.ts";
import type { RuntimeConfig, ServiceDefinition } from "./configSource.interface.ts";
import { confirmedChanges } from "./diffEngine.ts";
import { RetryAfterError, type StatusPageRead } from "./http.ts";
import type { Logger } from "./logger.ts";
import type { ProviderRuntimeState, StateStore } from "./stateStore.interface.ts";
import type { NormalizedStatus, StatusChange } from "./types.ts";

/**
 * How much of a provider's own cadence the staggered start may spread over, and
 * the ceiling on it whatever the cadence. A cycle is not finished until its
 * slowest provider is, so the spread is paid in cycle wall time and lands on
 * top of the scheduler's own jitter — a tenth of an interval, capped, keeps
 * both inside the slack `DUE_SLACK` already allows.
 */
const STAGGER_FRACTION = 0.1;
const MAX_STAGGER_MS = 20_000;
/**
 * How much of a provider's own interval may still be missing and have the poll
 * count as due. The scheduler arms with up to a tenth of an interval of jitter
 * either way, so an exact comparison would drop every early tick — a provider
 * asking for the same cadence as the global one would then be polled every
 * second cycle, which is the opposite of what configuring an interval means.
 */
const DUE_SLACK = 0.15;
const BACKOFF_BASE_MS = 500;
const BACKOFF_JITTER_MS = 250;

/** FNV-1a, 32-bit: small, stable across runs, and no dependency. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Where inside the cadence this provider's request goes (roadmap 2.11).
 *
 * Anchored on the provider's id rather than its position in the list, which is
 * what makes it stable: adding or removing a provider used to shift every
 * request after it in the array onto a different offset, and a fleet that
 * re-shuffles on every configuration edit is not a stagger, it is noise. Two
 * instances watching the same provider still collide — the id is the same on
 * both — which is what the scheduler's per-instance jitter is for.
 */
export function staggerOffsetMs(providerId: string, intervalMinutes: number): number {
  const budget = Math.min(Math.round(intervalMinutes * 60_000 * STAGGER_FRACTION), MAX_STAGGER_MS);
  if (budget <= 0) return 0;
  return hash(providerId) % budget;
}

export interface ProviderResult {
  providerId: string;
  ok: boolean;
  status?: NormalizedStatus | undefined;
  attempts: number;
  /** Wall-clock time the fetch took, retries included, stagger excluded. */
  durationMs: number;
  /**
   * Whether the successful read was a 304 whose body came from our own cache.
   * Absent when nothing measured one — a failed read, or an adapter that does
   * not report its reads. The debug panel (roadmap 5.18) is what needs it:
   * without it, "the provider answered instantly" and "we never asked" look
   * the same.
   */
  notModified?: boolean | undefined;
  error?: string | undefined;
}

export interface CycleResult {
  changes: StatusChange[];
  results: ProviderResult[];
  startedAt: string;
  finishedAt: string;
}

export interface CycleOptions {
  /**
   * Polls every enabled provider whether its own interval has elapsed or not.
   * A manual poll from the dashboard means "ask now", so a provider on an hourly
   * cadence must not sit the request out.
   */
  ignoreSchedule?: boolean | undefined;
}

export interface Poller {
  runCycle(config: RuntimeConfig, options?: CycleOptions): Promise<CycleResult>;
  /**
   * The shortest cadence any enabled provider is asking for right now, in
   * minutes — which is how often the scheduler has to tick for nobody to be
   * starved. It lives here rather than in the scheduler because the answer
   * depends on stored state, not only on the configuration: a provider with an
   * open incident asks for the adaptive cadence (roadmap 2.3), and the poller
   * is the one thing that reads both.
   */
  nextIntervalMinutes(config: RuntimeConfig): Promise<number>;
}

export interface PollerDeps {
  getAdapter: (id: string) => Adapter;
  store: StateStore;
  logger: Logger;
  /** Injected so tests assert the backoff schedule instead of waiting it out. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Injected so a test can move a provider's interval along without waiting it out. */
  now?: (() => number) | undefined;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * One polling cycle over every enabled provider.
 *
 * Three properties matter more than speed here: a provider's failure is
 * isolated from the others, a failure never overwrites the last known status
 * (so it can never be mistaken for a recovery next cycle), and the warning that
 * our own monitoring is failing is sent once per streak rather than every cycle.
 */
export function createPoller(deps: PollerDeps): Poller {
  const { getAdapter, store, logger } = deps;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;

  /**
   * When each provider was last reached for, attempt or not. Kept here rather
   * than read from the stored status, because a failing provider's last status
   * is the one from before the failure — scheduling off it would retry a broken
   * provider on every tick regardless of the cadence it asked for.
   *
   * In memory on purpose: after a restart every provider is due, which is what
   * an operator who just restarted the container expects to see.
   */
  const lastAttemptAt = new Map<string, number>();

  /**
   * Providers that answered `Retry-After` and when the hold runs out. In memory
   * for the same reason as the map above: a restart is an operator asking for a
   * poll now, and a hold that survived one would be a provider that stays dark
   * with nothing on the dashboard to explain it.
   */
  const holdUntil = new Map<string, number>();

  async function attemptFetch(
    service: ServiceDefinition,
    config: RuntimeConfig,
  ): Promise<{
    status: NormalizedStatus;
    attempts: number;
    latencyMs?: number | undefined;
    notModified?: boolean | undefined;
  }> {
    const adapter = getAdapter(service.adapter);
    const timeoutMs = config.polling.requestTimeoutSeconds * 1000;
    let lastError: unknown;

    for (let attempt = 0; attempt < config.polling.maxRetries; attempt += 1) {
      if (attempt > 0) {
        // Exponential backoff with jitter, so a provider recovering from an
        // outage is not hit by every IsItDown instance in lockstep.
        const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.random() * BACKOFF_JITTER_MS;
        await sleep(Math.round(delay));
      }
      // The read the successful attempt made; a retried attempt's own timing
      // describes the failure, not the page we ended up reading.
      let read: StatusPageRead | undefined;
      try {
        const status = await adapter.fetchStatus(
          {
            id: service.id,
            name: service.name,
            baseUrl: service.baseUrl,
            options: service.options,
            components: service.components,
            scopeToComponents: service.scopeToComponents,
          },
          {
            timeoutMs,
            onRead: (observed) => {
              read = observed;
            },
          },
        );
        return {
          status,
          attempts: attempt + 1,
          latencyMs: read?.latencyMs,
          notModified: read?.notModified,
        };
      } catch (error) {
        lastError = error;
        logger.debug("poll attempt failed", {
          providerId: service.id,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        // A stated window is the one failure the in-cycle retries cannot help
        // with: the backoff here is seconds and the window is at least tens of
        // them, so every remaining attempt would be another request the
        // provider already refused.
        if (error instanceof RetryAfterError) break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function pollOne(
    service: ServiceDefinition,
    config: RuntimeConfig,
    options: CycleOptions,
  ): Promise<{ result: ProviderResult; changes: StatusChange[] }> {
    // Spread the requests across the cadence rather than firing every provider
    // on the same millisecond of every cycle. A manual poll skips it: the
    // operator pressed the button and is watching, so a deliberate wait of up
    // to a fifth of a minute is a dashboard that looks stuck.
    if (options.ignoreSchedule !== true) {
      await sleep(staggerOffsetMs(service.id, service.intervalMinutes ?? config.polling.intervalMinutes));
    }

    const before = await store.getState(service.id);

    const startedAt = Date.now();
    let outcome: Awaited<ReturnType<typeof attemptFetch>>;
    try {
      outcome = await attemptFetch(service, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A provider that said "not now" is held off until it said to come back
      // (roadmap 2.12). Still a failed read — the failure count and the
      // monitoring warning behind it are how an operator finds out that we
      // have stopped being able to read a page — but asking again on the next
      // tick is exactly what the header exists to stop.
      if (error instanceof RetryAfterError) {
        // The injected clock, not the wall one: it is compared against the
        // cycle's own `at` in `isDue`, and two clocks there is a hold that
        // either never expires or never applies.
        const until = now() + error.retryAfterMs;
        holdUntil.set(service.id, until);
        logger.warn("provider asked to be left alone", {
          providerId: service.id,
          retryAfterMs: error.retryAfterMs,
          until: new Date(until).toISOString(),
        });
      }
      const failureCount = await store.recordFailure(service.id);
      logger.warn("provider poll failed", {
        providerId: service.id,
        failureCount,
        attempts: config.polling.maxRetries,
        error: message,
      });

      const changes: StatusChange[] = [];
      if (failureCount >= config.polling.failureThreshold && !before.degradedNotified) {
        changes.push({
          kind: "monitoring_degraded",
          providerId: service.id,
          currentStatus: before.last?.overallStatus ?? "unknown",
          failureCount,
          at: new Date().toISOString(),
        });
        await store.setDegradedNotified(service.id, true);
      }

      return {
        result: {
          providerId: service.id,
          ok: false,
          attempts: config.polling.maxRetries,
          durationMs: Date.now() - startedAt,
          error: message,
        },
        changes,
      };
    }

    // Ask the engine what is news, against the state read before this save.
    // The gate is what flap damping and a mute are expressed through: both
    // decide whether a reading notifies, so both belong on this one path
    // rather than anywhere a message could be sent from.
    const gate = confirmedChanges(outcome.status, {
      baseline: before.notifyBaseline,
      last: before.last,
      pending: before.pending,
      confirmations: config.polling.confirmSamples,
      mutedUntil: service.mutedUntil ?? null,
    });
    const changes = gate.changes;
    await store.saveStatus(outcome.status, { latencyMs: outcome.latencyMs });
    await store.saveNotifyState(service.id, gate.baseline, gate.pending);
    if (before.failureCount > 0) await store.clearFailures(service.id);
    if (before.degradedNotified) await store.setDegradedNotified(service.id, false);

    return {
      result: {
        providerId: service.id,
        ok: true,
        status: outcome.status,
        attempts: outcome.attempts,
        durationMs: Date.now() - startedAt,
        ...(outcome.notModified === undefined ? {} : { notModified: outcome.notModified }),
      },
      changes,
    };
  }

  /**
   * Whether the provider's last reading was anything but calm.
   *
   * An open incident or a status worse than operational counts; `unknown` does
   * not. `unknown` is what a provider we have never read successfully looks
   * like, and polling a page we cannot parse every minute would hammer it for
   * nothing — a failing fetch is already the retry and failure-threshold
   * path's business, not this one's.
   */
  function inTrouble(state: ProviderRuntimeState): boolean {
    const last = state.last;
    if (last === null) return false;
    return (
      last.activeIncidents.length > 0 ||
      (last.overallStatus !== "operational" && last.overallStatus !== "unknown")
    );
  }

  /**
   * How often this provider wants to be polled: its own interval, the global
   * one when it has none, and the adaptive cadence while it is in trouble.
   *
   * The adaptive value is taken as a *minimum* against what was configured,
   * never as a replacement: a provider deliberately put on an hourly cadence
   * still gets watched closely through its incident, and one already polled
   * more often than the adaptive cadence is not slowed down by having one.
   */
  function effectiveIntervalMinutes(
    service: ServiceDefinition,
    config: RuntimeConfig,
    state: ProviderRuntimeState,
  ): number {
    const configured = service.intervalMinutes ?? config.polling.intervalMinutes;
    if (!config.polling.adaptivePolling || !inTrouble(state)) return configured;
    return Math.min(configured, config.polling.adaptiveIntervalMinutes);
  }

  /**
   * The scheduler ticks at the shortest cadence anything asked for, so every
   * provider on a slower one has to sit ticks out here. That now includes the
   * providers with no interval of their own: before adaptive polling the tick
   * *was* the global cadence and they could simply follow it, but a single
   * provider in trouble pulls the tick down to the adaptive cadence, and the
   * rest of the fleet must not come along with it.
   */
  async function isDue(service: ServiceDefinition, at: number, config: RuntimeConfig): Promise<boolean> {
    const held = holdUntil.get(service.id);
    if (held !== undefined) {
      if (at < held) return false;
      // Spent: dropped rather than left to be compared against forever, so the
      // map holds only live holds and a provider cannot be skipped twice for
      // the same 429.
      holdUntil.delete(service.id);
    }
    const last = lastAttemptAt.get(service.id);
    if (last === undefined) return true;
    const interval = effectiveIntervalMinutes(service, config, await store.getState(service.id));
    return at - last >= interval * 60_000 * (1 - DUE_SLACK);
  }

  return {
    async nextIntervalMinutes(config: RuntimeConfig): Promise<number> {
      let shortest = config.polling.intervalMinutes;
      for (const service of config.services) {
        if (!service.enabled) continue;
        shortest = Math.min(
          shortest,
          effectiveIntervalMinutes(service, config, await store.getState(service.id)),
        );
      }
      return shortest;
    },

    async runCycle(config: RuntimeConfig, options: CycleOptions = {}): Promise<CycleResult> {
      const startedAt = new Date().toISOString();
      const at = now();
      // A loop rather than `filter`: whether a provider is due now depends on
      // its stored state, and reading that is asynchronous.
      const enabled: ServiceDefinition[] = [];
      for (const service of config.services) {
        if (!service.enabled) continue;
        // A manual poll overrides the schedule, a `Retry-After` hold included:
        // the operator asked for one request now, which is not the hammering
        // the hold exists to prevent.
        if (options.ignoreSchedule === true || (await isDue(service, at, config))) enabled.push(service);
      }
      for (const service of enabled) lastAttemptAt.set(service.id, at);
      // A provider removed from the configuration must not keep its slot here,
      // or a long-lived process accumulates one per id it has ever seen.
      const known = new Set(config.services.map((service) => service.id));
      for (const id of lastAttemptAt.keys()) {
        if (!known.has(id)) lastAttemptAt.delete(id);
      }
      for (const id of holdUntil.keys()) {
        if (!known.has(id)) holdUntil.delete(id);
      }

      const settled = await Promise.allSettled(
        enabled.map((service) => pollOne(service, config, options)),
      );

      const results: ProviderResult[] = [];
      const changes: StatusChange[] = [];
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "fulfilled") {
          results.push(outcome.value.result);
          changes.push(...outcome.value.changes);
          continue;
        }
        // Only a bug in the poller itself can land here; a provider's own
        // failure is already handled inside pollOne.
        const service = enabled[index];
        const message =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        logger.error("polling a provider crashed unexpectedly", {
          providerId: service?.id,
          error: message,
        });
        results.push({
          providerId: service?.id ?? "unknown",
          ok: false,
          attempts: 0,
          durationMs: 0,
          error: message,
        });
      }

      const finishedAt = new Date().toISOString();
      logger.info("poll cycle finished", {
        providers: results.length,
        skipped: config.services.filter((service) => service.enabled).length - enabled.length,
        failed: results.filter((result) => !result.ok).length,
        changes: changes.length,
      });
      return { changes, results, startedAt, finishedAt };
    },
  };
}
