import type { ChannelConfig, ConfigSource } from "./configSource.interface.ts";
import type { Logger } from "./logger.ts";
import type { Dispatcher } from "./notificationDispatcher.ts";
import type { Notifier } from "./notifier.interface.ts";
import type { CycleResult, Poller } from "./poller.ts";

/** Fraction of the interval the arming delay may vary by, either way. */
const JITTER = 0.1;

export interface Scheduler {
  /** Runs one cycle immediately, then arms the next. */
  start(): Promise<void>;
  /** Runs a cycle on demand, joining one already in flight rather than duplicating it. */
  triggerNow(): Promise<CycleResult>;
  stop(): void;
  /** Resolves once no cycle is in flight. Lets tests await a timer-driven cycle. */
  settled(): Promise<void>;
}

export interface SchedulerDeps {
  configSource: ConfigSource;
  poller: Poller;
  dispatcher: Dispatcher;
  /**
   * Called with the channels of the freshly loaded configuration on every cycle,
   * so enabling a channel takes effect without a restart.
   */
  buildNotifiers: (channels: ChannelConfig[]) => Notifier[];
  logger: Logger;
  onCycle?: ((result: CycleResult) => void | Promise<void>) | undefined;
  /** Injected so tests get an exact arming delay. */
  random?: (() => number) | undefined;
}

/**
 * The loop that drives everything. It re-reads the configuration on every cycle
 * rather than caching it at boot, which is what lets the UI edition change
 * providers, intervals and channels with no restart.
 *
 * Timing uses a fresh setTimeout after each cycle rather than setInterval, so a
 * slow cycle delays the next one instead of overlapping with it.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { configSource, poller, dispatcher, buildNotifiers, logger, onCycle } = deps;
  const random = deps.random ?? Math.random;

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let inFlight: Promise<CycleResult> | undefined;
  let lastIntervalMinutes = 3;

  async function runCycle(): Promise<CycleResult> {
    const config = await configSource.load();
    lastIntervalMinutes = config.polling.intervalMinutes;

    const result = await poller.runCycle(config);
    await dispatcher.dispatch(result.changes, {
      services: config.services,
      locale: config.locale,
      notifiers: buildNotifiers(config.channels),
    });
    if (onCycle !== undefined) await onCycle(result);
    return result;
  }

  function cycle(): Promise<CycleResult> {
    if (inFlight !== undefined) return inFlight;
    // The marker is cleared inside the run's own body rather than in a chained
    // callback: a chained .finally settles a microtask later than the promise
    // itself, so a caller awaiting one cycle and immediately asking for another
    // was handed back the finished one and no new cycle ran at all.
    const run = (async () => {
      try {
        return await runCycle();
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  }

  function arm(): void {
    if (stopped) return;
    const interval = lastIntervalMinutes * 60_000;
    // Spread instances out so a fleet of IsItDown containers does not hit
    // every provider on the same second.
    const delay = Math.round(interval * (1 - JITTER + random() * 2 * JITTER));
    // Deliberately referenced: this timer is the only thing keeping the Light
    // edition's event loop alive between cycles, and unref'ing it made the
    // container exit after its first poll.
    timer = setTimeout(() => {
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    try {
      await cycle();
    } catch (error) {
      // One bad cycle — an unreachable database, a broken config file — must not
      // end the service. Log it and stay on the clock.
      logger.error("poll cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      arm();
    }
  }

  return {
    async start(): Promise<void> {
      stopped = false;
      await tick();
    },

    triggerNow(): Promise<CycleResult> {
      return cycle();
    },

    stop(): void {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },

    async settled(): Promise<void> {
      while (inFlight !== undefined) {
        await inFlight.catch(() => undefined);
      }
    },
  };
}
