import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";
import { getAdapter } from "../adapters/index.ts";
import { registerPluginAdapters } from "../adapters/plugins.ts";
import type { ChannelConfig, ConfigSource, ServiceDefinition } from "../core/configSource.interface.ts";
import { createLogger, parseLogLevel, type Logger } from "../core/logger.ts";
import { createDispatcher, type Dispatcher } from "../core/notificationDispatcher.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import { createPoller, type CycleResult } from "../core/poller.ts";
import { createScheduler, dispatchContextOf, type Scheduler } from "../core/scheduler.ts";
import { initTracing, tracer } from "../core/tracing.ts";
import { createWebPushNotifier } from "../notifiers/webpush.notifier.ts";
import { buildNotifiers } from "../notifiers/index.ts";
import { createApp } from "./app.ts";
import { createAdapterDebugStore, type AdapterDebugStore } from "./adapterDebug.ts";
import { createBackfillService, type BackfillService } from "./backfill.ts";
import {
  createDbConfigSource,
  listServices,
  purgeExpiredServices,
  readSettings,
} from "./dbConfigSource.ts";
import { migrate } from "./db/migrate.ts";
import { openDatabase } from "./db/open.ts";
import { seedDefaults } from "./db/seed.ts";
import { loadGeoTables } from "./geo/resolveLocation.ts";
import { createHistoryService } from "./history.ts";
import { createLiveEvents, type LiveEvents } from "./liveEvents.ts";
import type { HistoryStore } from "./historyStore.interface.ts";
import { createMapLane, type MapLane } from "./mapLane.ts";
import { createMapStore, type MapStore } from "./mapStore.ts";
import { createMetricsRegistry, type MetricsRegistry } from "./metrics.ts";
import { componentTargetOf } from "../core/routing.ts";
import { createSlaService, rememberSlaNotice, slaAlreadyTold } from "./sla.ts";
import { createTrustService, type TrustPair } from "./trust.ts";
import { createSqlitePushSubscriptionStore, type SqlitePushSubscriptionStore } from "./sqlitePushSubscriptionStore.ts";
import { loadSecretsFile, type SecretsFile } from "./secretsFile.ts";
import { createSqliteStateStore } from "./sqliteStateStore.ts";
import { ensureVapidKeys } from "./vapidKeys.ts";

const PRUNE_INTERVAL_MS = 24 * 3600 * 1000;
const NOTIFICATION_FEED_LIMIT = 200;

export interface UiRuntimeOptions {
  dbPath: string;
  env: NodeJS.ProcessEnv;
  logger?: Logger | undefined;
}

/**
 * Everything the HTTP layer needs. Split from `UiRuntime` so `createApp` can take
 * the runtime it serves without the two types depending on each other.
 */
export interface UiRuntimeCore {
  db: DatabaseSync;
  /**
   * Where the database file lives, which is also where `secrets.env` sits
   * beside it. Carried so the backup route can say which of the two a download
   * covers (roadmap 4.4) without rebuilding the path from an environment
   * variable the runtime already read.
   */
  dbPath: string;
  /** The process environment secrets are resolved from; never serialised. */
  env: NodeJS.ProcessEnv;
  /**
   * Credentials saved from the dashboard, applied to `env` on load — which is
   * what lets a save take effect without recreating the container.
   */
  secrets: SecretsFile;
  dispatcher: Dispatcher;
  store: HistoryStore;
  history: ReturnType<typeof createHistoryService>;
  /** The operator's timezone preference, read fresh — roadmap 10.7. */
  timeZone(): string;
  /** Monthly targets and what the month has spent of them — roadmap 4.13. */
  sla: ReturnType<typeof createSlaService>;
  /** How closely each cross-checked page tracked what a probe observed — roadmap 8.1. */
  trust: ReturnType<typeof createTrustService>;
  /**
   * Every probe/page pair a trust card can be built for. Derived from
   * `crossChecks`, so a fleet with no probe has none and the surface is absent
   * rather than empty.
   */
  trustPairs(): TrustPair[];
  configSource: ConfigSource;
  scheduler: Scheduler;
  /** Built here, run by the server at boot — never by the runtime builder, so tests stay offline. */
  backfill: BackfillService;
  mapStore: MapStore;
  /** The Prometheus scrape surface, fed by the dispatcher and the scheduler. */
  metrics: MetricsRegistry;
  /** The push channel behind `GET /events`; published to as each cycle finishes. */
  live: LiveEvents;
  pushSubscriptions: SqlitePushSubscriptionStore;
  /**
   * The last few adapter outcomes per provider, behind `GET /debug/adapters`
   * (roadmap 5.18). In memory: diagnostics for the run in front of you.
   */
  adapterDebug: AdapterDebugStore;
  /**
   * The shared registry cannot build `webpush` on its own: that channel needs the
   * device list, which only this edition has. Composed once here so the scheduler
   * and the "send test" route build exactly the same set of channels.
   */
  buildNotifiers: (channels: ChannelConfig[]) => Notifier[];
  /**
   * Started by the server, like the scheduler — never by the runtime builder,
   * so tests stay offline and can drive `refresh()` explicitly.
   */
  mapLane: MapLane;
  logger: Logger;
  /** Every configured provider, including disabled ones — the dashboard shows both. */
  listAllServices(): ServiceDefinition[];
  /**
   * Just the ids of the enabled ones. The history, incident and notification
   * views are about what IsItDown is watching, so they scope their queries to
   * this; the config and settings surfaces keep using `listAllServices`.
   */
  enabledProviderIds(): string[];
  providerCount(): number;
  lastCycleAt(): string | null;
  /**
   * The last cycle's own outcome, for readiness (roadmap 6.9): `lastCycleAt`
   * answers "when", and a cycle that finished on time having read nothing is
   * exactly the failure readiness exists to report. `null` until one completes.
   */
  lastCycleSummary(): { finishedAt: string; providers: number; failed: number } | null;
  notificationFeedLimit: number;
  close(): Promise<void>;
}

export interface UiRuntime extends UiRuntimeCore {
  app: Express;
}

/**
 * Assembles the UI edition: the same core engine as the Light edition with a
 * SQLite store and a database-backed config source injected, plus the HTTP layer.
 *
 * The scheduler is not started here — the server does that — so tests can drive
 * cycles explicitly and `/status` can be exercised without any polling.
 */
export async function buildUiRuntime(options: UiRuntimeOptions): Promise<UiRuntime> {
  const logger = options.logger ?? createLogger(parseLogLevel(options.env["LOG_LEVEL"]));

  // Before anything is polled, so the first cycle is traced too (roadmap 6.10).
  // Does nothing unless an OTLP endpoint is configured.
  initTracing(options.env, logger);

  // Before anything reads a service row, so a provider whose adapter comes from
  // a plugin resolves on the first cycle rather than on the second boot
  // (roadmap 1.13). Does nothing unless `PLUGINS_DIR` is set.
  await registerPluginAdapters(options.env, logger);

  const db = openDatabase(options.dbPath);
  migrate(db);
  seedDefaults(db);

  // Before anything reads the environment: an entry saved from the dashboard on
  // a previous run has to be in place for the first cycle, exactly as it would
  // be had the container supplied it.
  const secretsPath = join(dirname(options.dbPath), "secrets.env");
  const secrets = await loadSecretsFile(secretsPath, options.env, logger);

  const store = createSqliteStateStore(db);
  /**
   * The zone every calendar day in this edition is read in — roadmap 10.7.
   * A function rather than a value: the preference changes from the dashboard
   * without a restart, and a captured copy would keep drawing yesterday's day
   * boundaries onto today's bars.
   */
  const timeZone = (): string => readSettings(db, logger).timeZone;

  const history = createHistoryService(store, { timeZone });
  // Roadmap 4.13. Reads the same monthly report the export and the History view
  // are drawn from, so a budget can never disagree with the uptime beside it.
  const sla = createSlaService({ history });
  const trust = createTrustService(db);
  const configSource = createDbConfigSource(db, options.env, logger);

  const pushSubscriptions = createSqlitePushSubscriptionStore(db);
  /**
   * The shared registry cannot build `webpush` on its own: that channel needs the
   * device list, which only this edition has. Composed once here so the scheduler
   * and the "send test" route build exactly the same set of channels.
   */
  const buildAllNotifiers = (channels: ChannelConfig[]): Notifier[] =>
    buildNotifiers(channels, {
      // The settings argument carries nothing for this channel: its VAPID pair
      // is this server's own, generated on first use and read from SQLite.
      webpush: () => createWebPushNotifier({ keys: ensureVapidKeys(db, logger), store: pushSubscriptions }),
    });

  const mapStore = createMapStore(db);
  const mapLane = createMapLane({
    store: mapStore,
    tables: loadGeoTables(),
    logger,
    getAdapter,
    listServices: () => listServices(db),
    timeoutMs: 8000,
  });

  const poller = createPoller({ getAdapter, store, logger });
  const live = createLiveEvents();

  const metrics = createMetricsRegistry({
    store,
    listEnabledServices: () => listServices(db).filter((service) => service.enabled),
  });
  const adapterDebug = createAdapterDebugStore();

  const dispatcher = createDispatcher({
    logger,
    // Where the id of the message already sent about an incident lives, so the
    // next update can edit it rather than add another (roadmap 3.19). The same
    // store as everything else: the references cascade with the provider.
    messageRefs: store,
    // What the dashboard's notification feed is built from, and — since every
    // outbound message passes here — what the delivery counters count.
    onSent: (record) => {
      metrics.recordSent(record);
      return store.recordNotification(record);
    },
  });

  let lastCycle: CycleResult | undefined;
  const scheduler = createScheduler({
    configSource,
    poller,
    dispatcher,
    buildNotifiers: buildAllNotifiers,
    logger,
    onCycle: async (result) => {
      lastCycle = result;
      metrics.recordCycle(result);
      // The poller's own liveness, as its own trace — roadmap 10.1. Written
      // before anything else the cycle produces, because this is the row that
      // later says whether a stretch with no samples was a quiet fleet or a
      // stopped container, and a failure further down this callback must not be
      // able to turn the second into the first.
      //
      // The cadence stored is the one this cycle ran at, not today's: it is what
      // decides how long a following silence has to be before it is an absence,
      // and a cadence changed since says nothing about that.
      await store.recordPollCycle({
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        intervalMinutes: await poller.nextIntervalMinutes(await configSource.load()),
        providers: result.results.length,
      });
      // Recorded next to the metrics and for the same reason: both are read
      // from a page rather than from the logs, and the debug panel is the one
      // that says *why* a read failed.
      adapterDebug.recordCycle(result);
      // Published after the metrics are recorded and `lastCycle` is set, so a
      // client that re-reads the moment it hears about the cycle cannot be
      // answered with the previous one's numbers.
      live.publish({
        type: "cycle",
        data: {
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          // No `nextPollAt` here, unlike the greeting: the scheduler re-arms
          // *after* this callback returns, so the deadline readable now is the
          // one that just expired. A client that drew a countdown from it
          // would sit at zero until its own re-read of `/status` landed. The
          // fresh deadline is in that read, which this event is asking for
          // anyway.
          serverNow: new Date().toISOString(),
          providers: result.results.length,
          failed: result.results.filter((entry) => !entry.ok).length,
          // Which providers to re-read, rather than "something changed": a
          // cycle where nothing moved is the common case, and it should cost a
          // client nothing but a new countdown.
          changedProviders: [...new Set(result.changes.map((change) => change.providerId))],
        },
      });

      await reportSlaBurn();
      await rebuildTrust();
    },
  });

  /**
   * The error-budget alert — roadmap 4.13.
   *
   * After the cycle rather than inside it, because it is not about the cycle:
   * it reads a month of stored samples, which only this edition has, and the
   * poller is edition-agnostic. The *decision* is still the diff engine's
   * (`slaBurn`), and the *sending* is still the dispatcher's, through the same
   * context the scheduler just used — so routing rules, quiet hours and the
   * digest window apply to it exactly as they do to an outage.
   *
   * Said once per provider per month, and the marker is written only after the
   * dispatcher has taken the message: a marker written first, by a cycle whose
   * dispatch then threw, is a month of silence about a budget already gone.
   */
  async function reportSlaBurn(): Promise<void> {
    try {
      const config = await configSource.load();
      const changes = await sla.burnChanges(
        config.services,
        config.polling.intervalMinutes,
        (providerId, month) => slaAlreadyTold(db, providerId, month),
      );
      if (changes.length === 0) return;
      await dispatcher.dispatch(changes, dispatchContextOf(config, buildAllNotifiers(config.channels)));
      for (const change of changes) {
        if (change.sla === undefined) continue;
        rememberSlaNotice(db, change.providerId, change.sla.month);
        logger.warn("a provider is on course to miss its monthly target", {
          providerId: change.providerId,
          month: change.sla.month,
          target: change.sla.target,
          projected: change.sla.projectedUptime,
        });
      }
    } catch (error) {
      // A failure here must not take the cycle down with it: the poll worked,
      // and an arithmetic lane that cannot read its own table is not a reason
      // to stop monitoring.
      logger.error("checking error budgets failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Every probe that names a page to cross-check, as a pair to fold episodes for. */
  function trustPairs(): TrustPair[] {
    const pairs: TrustPair[] = [];
    for (const service of listServices(db)) {
      if (service.crossChecks === undefined) continue;
      const narrowed = componentTargetOf(service.crossChecks);
      pairs.push({
        probeId: service.id,
        pageId: narrowed?.providerId ?? service.crossChecks,
        componentId: narrowed?.componentId ?? "",
      });
    }
    return pairs;
  }

  /**
   * Fold the cycle's samples into trust episodes — roadmap 8.1.
   *
   * After the cycle and outside it, like the budget alert above and for the
   * same reason: it reads stored samples, which only this edition has. Cheap
   * because it is incremental — each pair resumes from its own last episode —
   * and a failure is logged rather than thrown, since a card that cannot be
   * built is not a reason to stop monitoring.
   */
  async function rebuildTrust(): Promise<void> {
    const pairs = trustPairs();
    if (pairs.length === 0) return;
    try {
      const config = await configSource.load();
      trust.rebuild(pairs, { confirmations: config.polling.confirmSamples });
    } catch (error) {
      logger.error("folding trust episodes failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const backfill = createBackfillService({ getAdapter, store, configSource, logger });

  /**
   * Two jobs on one timer: history past the retention window, and providers
   * whose removal has outlived its grace period. Both destroy rows nobody is
   * looking at any more, and a removal that expired while the container was
   * off has to be taken on the next boot rather than sit there forever.
   */
  const prune = async (): Promise<void> => {
    // Read per run, not captured once: a retention changed from the dashboard
    // has to take effect on the next prune without a restart.
    await store.pruneOlderThan(readSettings(db, logger).retentionDays);
    const purged = purgeExpiredServices(db);
    if (purged.length > 0) {
      logger.info("removed providers past their restore window were deleted", { providers: purged });
    }
  };

  await prune();
  const pruneTimer = setInterval(() => {
    void prune().catch((error: unknown) => {
      logger.error("pruning history failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const core: UiRuntimeCore = {
    db,
    dbPath: options.dbPath,
    env: options.env,
    secrets,
    dispatcher,
    store,
    history,
    timeZone,
    sla,
    trust,
    trustPairs,
    configSource,
    scheduler,
    backfill,
    mapStore,
    metrics,
    live,
    pushSubscriptions,
    adapterDebug,
    buildNotifiers: buildAllNotifiers,
    mapLane,
    logger,
    listAllServices: () => listServices(db),
    enabledProviderIds: () =>
      listServices(db)
        .filter((service) => service.enabled)
        .map((service) => service.id),
    providerCount: () => listServices(db).length,
    lastCycleAt: () => lastCycle?.finishedAt ?? null,
    lastCycleSummary: () =>
      lastCycle === undefined
        ? null
        : {
            finishedAt: lastCycle.finishedAt,
            providers: lastCycle.results.length,
            failed: lastCycle.results.filter((entry) => !entry.ok).length,
          },
    notificationFeedLimit: NOTIFICATION_FEED_LIMIT,
    async close(): Promise<void> {
      clearInterval(pruneTimer);
      mapLane.stop();
      scheduler.stop();
      await scheduler.settled();
      // The last cycle's spans are the interesting ones when a container is
      // being stopped, so they are sent rather than dropped on the way out.
      await tracer().flush();
      await store.close();
    },
  };

  return { ...core, app: createApp(core) };
}
