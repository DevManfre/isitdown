import type { Adapter } from "./adapter.interface.ts";
import type { RuntimeConfig, ServiceDefinition } from "./configSource.interface.ts";
import { diff } from "./diffEngine.ts";
import type { Logger } from "./logger.ts";
import type { StateStore } from "./stateStore.interface.ts";
import type { NormalizedStatus, StatusChange } from "./types.ts";

const STAGGER_MS = 250;
const BACKOFF_BASE_MS = 500;
const BACKOFF_JITTER_MS = 250;

export interface ProviderResult {
  providerId: string;
  ok: boolean;
  status?: NormalizedStatus | undefined;
  attempts: number;
  error?: string | undefined;
}

export interface CycleResult {
  changes: StatusChange[];
  results: ProviderResult[];
  startedAt: string;
  finishedAt: string;
}

export interface Poller {
  runCycle(config: RuntimeConfig): Promise<CycleResult>;
}

export interface PollerDeps {
  getAdapter: (id: string) => Adapter;
  store: StateStore;
  logger: Logger;
  /** Injected so tests assert the backoff schedule instead of waiting it out. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
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

  async function attemptFetch(
    service: ServiceDefinition,
    config: RuntimeConfig,
  ): Promise<{ status: NormalizedStatus; attempts: number }> {
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
      try {
        const status = await adapter.fetchStatus(
          {
            id: service.id,
            name: service.name,
            baseUrl: service.baseUrl,
            options: service.options,
          },
          { timeoutMs },
        );
        return { status, attempts: attempt + 1 };
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

    let outcome: { status: NormalizedStatus; attempts: number };
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
          error: message,
        },
        changes,
      };
    }

    // Diff against the state read before this save, then persist.
    const changes = diff(before.last, outcome.status);
    await store.saveStatus(outcome.status);
    if (before.failureCount > 0) await store.clearFailures(service.id);
    if (before.degradedNotified) await store.setDegradedNotified(service.id, false);

    return {
      result: {
        providerId: service.id,
        ok: true,
        status: outcome.status,
        attempts: outcome.attempts,
      },
      changes,
    };
  }

  return {
    async runCycle(config: RuntimeConfig): Promise<CycleResult> {
      const startedAt = new Date().toISOString();
      const enabled = config.services.filter((service) => service.enabled);

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
          error: message,
        });
      }

      const finishedAt = new Date().toISOString();
      logger.info("poll cycle finished", {
        providers: results.length,
        failed: results.filter((result) => !result.ok).length,
        changes: changes.length,
      });
      return { changes, results, startedAt, finishedAt };
    },
  };
}
