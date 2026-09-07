import type { Adapter } from "./adapter.interface.ts";
import type { RuntimeConfig, ServiceDefinition } from "./configSource.interface.ts";
import { diff } from "./diffEngine.ts";
import type { StatusPageRead } from "./http.ts";
import type { Logger } from "./logger.ts";
import type { ProviderRuntimeState, StateStore } from "./stateStore.interface.ts";
import type { NormalizedStatus, StatusChange } from "./types.ts";

const STAGGER_MS = 250;
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

export interface ProviderResult {
  providerId: string;
  ok: boolean;
  status?: NormalizedStatus | undefined;
  attempts: number;
  /** Wall-clock time the fetch took, retries included, stagger excluded. */
  durationMs: number;
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

  async function attemptFetch(
    service: ServiceDefinition,
    config: RuntimeConfig,
  ): Promise<{ status: NormalizedStatus; attempts: number; latencyMs?: number | undefined }> {
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
        return { status, attempts: attempt + 1, latencyMs: read?.latencyMs };
      } catch (error) {
        lastError = error;
        logger.debug("poll attempt failed", {
          providerId: service.id,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function pollOne(
    service: ServiceDefinition,
    index: number,
    config: RuntimeConfig,
  ): Promise<{ result: ProviderResult; changes: StatusChange[] }> {
    // Spread the requests out rather than firing every provider on the same
    // millisecond of every cycle.
    await sleep(index * STAGGER_MS);

    const before = await store.getState(service.id);

    const startedAt = Date.now();
    let outcome: { status: NormalizedStatus; attempts: number; latencyMs?: number | undefined };
    try {
      outcome = await attemptFetch(service, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

    // Diff against the state read before this save, then persist.
    const changes = diff(before.last, outcome.status);
    await store.saveStatus(outcome.status, { latencyMs: outcome.latencyMs });
    if (before.failureCount > 0) await store.clearFailures(service.id);
    if (before.degradedNotified) await store.setDegradedNotified(service.id, false);

    return {
      result: {
        providerId: service.id,
        ok: true,
        status: outcome.status,
        attempts: outcome.attempts,
        durationMs: Date.now() - startedAt,
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
        if (options.ignoreSchedule === true || (await isDue(service, at, config))) enabled.push(service);
      }
      for (const service of enabled) lastAttemptAt.set(service.id, at);
      // A provider removed from the configuration must not keep its slot here,
      // or a long-lived process accumulates one per id it has ever seen.
      const known = new Set(config.services.map((service) => service.id));
      for (const id of lastAttemptAt.keys()) {
        if (!known.has(id)) lastAttemptAt.delete(id);
      }

      const settled = await Promise.allSettled(
        enabled.map((service, index) => pollOne(service, index, config)),
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
