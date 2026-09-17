import type { ChannelConfig, ConfigSource, RuntimeConfig } from "./configSource.interface.ts";
import type { Logger } from "./logger.ts";
import type { DispatchContext, Dispatcher } from "./notificationDispatcher.ts";
import type { Notifier } from "./notifier.interface.ts";
import type { CycleResult, Poller } from "./poller.ts";
import { tracer } from "./tracing.ts";

/** Fraction of the interval the arming delay may vary by, either way. */
const JITTER = 0.1;

export interface Scheduler {
  /** Runs one cycle immediately, then arms the next. */
  start(): Promise<void>;
  /** Runs a cycle on demand, joining one already in flight rather than duplicating it. */
  triggerNow(): Promise<CycleResult>;
  /**
   * Reads one provider now, because that provider said something changed
   * (roadmap 2.10) — and dispatches whatever the diff engine makes of it,
   * exactly as a scheduled cycle would.
   *
   * Unlike `triggerNow` it does *not* re-arm the timer: the standing schedule
   * is the fallback this feature explicitly keeps, and a push every few minutes
   * must not be able to push the fleet's own cycle indefinitely into the future.
   */
  triggerFor(providerId: string): Promise<CycleResult>;
  /**
   * When the armed timer will actually fire, or `null` if nothing is armed.
   *
   * The dashboard's countdown is drawn from this. It has to come from the
   * timer rather than be recomputed as `lastCycle.finishedAt + interval`,
   * because the two disagree by the jitter drawn in `arm()` (up to a tenth of
   * an interval either way) and by any interval change made since — and every
   * second the real cycle lands beyond a guessed deadline is a second the
   * dashboard spends showing "0s".
   */
  nextRunAt(): string | null;
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
 * The dispatch context a configuration implies, in one place.
 *
 * Exported because the UI edition has a second thing to dispatch — the SLA burn
 * alert, which it works out after a cycle from stored history rather than from
 * the cycle's own readings (roadmap 4.13) — and two hand-built contexts is two
 * places for a channel's locale or the quiet-hours window to be forgotten.
 */
export function dispatchContextOf(config: RuntimeConfig, notifiers: Notifier[]): DispatchContext {
  return {
    services: config.services,
    locale: config.locale,
    notifiers,
    rules: config.rules,
    // Every channel the configuration defines, enabled or not: the UI edition
    // seeds all of them and the Light edition lists whatever the file names.
    knownChannelIds: config.channels.map((channel) => channel.id),
    // Read from the freshly loaded configuration every time, so a quiet-hours
    // window or a digest length changed from the dashboard applies without a
    // restart.
    delivery: config.delivery,
    // What each channel asked for about the wording of its own messages: the
    // locale (roadmap 3.20) and the template (roadmap 3.15). Built from the
    // same channels the notifiers are, so the two can never describe different
    // channel sets.
    channelMessages: Object.fromEntries(
      config.channels.map((channel) => [
        channel.id,
        {
          ...(channel.locale === undefined ? {} : { locale: channel.locale }),
          ...(channel.template === undefined ? {} : { template: channel.template }),
        },
      ]),
    ),
  };
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
  let armedFor: number | undefined;
  let stopped = false;
  let inFlight: Promise<CycleResult> | undefined;
  let lastIntervalMinutes = 3;

  /**
   * How often a cycle has to run: the shortest cadence anything asked for.
   * Ticking at the global interval alone would starve a provider configured to
   * be polled more often than it, and the providers on the slower cadences sit
   * the extra ticks out inside the poller.
   */
  function tickIntervalMinutes(config: RuntimeConfig): number {
    return config.services
      .filter((service) => service.enabled)
      .reduce(
        (shortest, service) => Math.min(shortest, service.intervalMinutes ?? shortest),
        config.polling.intervalMinutes,
      );
  }

  /**
   * The root span of everything a cycle does — roadmap 6.10. Here rather than
   * in the poller because a cycle is not only the reads: the configuration
   * load, the reads, and the dispatch that follows them are what "the cycle
   * took 40 seconds" is made of, and only this function sees all three.
   */
  function runCycle(ignoreSchedule: boolean, only?: readonly string[]): Promise<CycleResult> {
    return tracer().span(
      "poll.cycle",
      { "isitdown.manual": ignoreSchedule, "isitdown.narrowed": only !== undefined },
      () => runCycleTraced(ignoreSchedule, only),
    );
  }

  async function runCycleTraced(ignoreSchedule: boolean, only?: readonly string[]): Promise<CycleResult> {
    const config = await configSource.load();
    // Set before the cycle as well as after it, so a cycle that throws still
    // arms the next one on the configuration it managed to read. Skipped for a
    // narrowed cycle: reading one provider says nothing about how often the
    // fleet has to be read, and the standing timer is not this cycle's business.
    if (only === undefined) lastIntervalMinutes = tickIntervalMinutes(config);

    const result = await poller.runCycle(config, {
      ignoreSchedule,
      ...(only === undefined ? {} : { only }),
    });
    // Read *after* the cycle: a provider whose incident opened in it should be
    // watched from now rather than from the tick after next. The poller may only
    // ask for a shorter cadence than the configuration's — never a longer one —
    // so the minimum is what protects the operator's own interval from a
    // poller (or a stub) reporting something coarser.
    if (only === undefined) {
      lastIntervalMinutes = Math.min(lastIntervalMinutes, await poller.nextIntervalMinutes(config));
    }
    await tracer().span("notifications.dispatch", { "isitdown.changes": result.changes.length }, () =>
      dispatcher.dispatch(result.changes, dispatchContextOf(config, buildNotifiers(config.channels))),
    );
    if (onCycle !== undefined) await onCycle(result);
    return result;
  }

  function cycle(ignoreSchedule = false): Promise<CycleResult> {
    if (inFlight !== undefined) return inFlight;
    // The marker is cleared inside the run's own body rather than in a chained
    // callback: a chained .finally settles a microtask later than the promise
    // itself, so a caller awaiting one cycle and immediately asking for another
    // was handed back the finished one and no new cycle ran at all.
    const run = (async () => {
      try {
        return await runCycle(ignoreSchedule);
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  }

  /**
   * Arms the next cycle, replacing whatever was armed before.
   *
   * Clearing first is what makes it safe to call from more than one place. A
   * manual poll that a scheduled tick joins mid-cycle leaves both of them
   * arming afterwards, and two live timers poll the provider twice an interval
   * — the earlier one firing before the deadline the dashboard is counting
   * down to, which is the countdown lying in the other direction.
   */
  function arm(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    armedFor = undefined;
    if (stopped) return;
    const interval = lastIntervalMinutes * 60_000;
    // Spread instances out so a fleet of IsItDown containers does not hit
    // every provider on the same second.
    const delay = Math.round(interval * (1 - JITTER + random() * 2 * JITTER));
    // Deliberately referenced: this timer is the only thing keeping the Light
    // edition's event loop alive between cycles, and unref'ing it made the
    // container exit after its first poll.
    armedFor = Date.now() + delay;
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

    async triggerFor(providerId: string): Promise<CycleResult> {
      // Deliberately not through `cycle()`: that one de-duplicates against the
      // in-flight *fleet* cycle, and joining it would answer a push about
      // GitHub with whatever the scheduled cycle happened to be doing. A
      // one-provider read is cheap enough to simply run.
      return runCycle(true, [providerId]);
    },

    async triggerNow(): Promise<CycleResult> {
      const result = await cycle(true);
      // The interval restarts from this poll. Leaving the standing timer alone
      // would fire the automatic cycle early — within seconds of a manual one,
      // in the worst case — and the countdown the dashboard just reset to a
      // full interval would be a lie for the whole of it.
      arm();
      return result;
    },

    nextRunAt(): string | null {
      return armedFor === undefined ? null : new Date(armedFor).toISOString();
    },

    stop(): void {
      stopped = true;
      armedFor = undefined;
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
