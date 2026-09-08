import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";
import { getAdapter } from "../adapters/index.ts";
import type { ChannelConfig, ConfigSource, ServiceDefinition } from "../core/configSource.interface.ts";
import { createLogger, parseLogLevel, type Logger } from "../core/logger.ts";
import { createDispatcher, type Dispatcher } from "../core/notificationDispatcher.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import { createPoller, type CycleResult } from "../core/poller.ts";
import { createScheduler, type Scheduler } from "../core/scheduler.ts";
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

  const db = openDatabase(options.dbPath);
  migrate(db);
  seedDefaults(db);

  // Before anything reads the environment: an entry saved from the dashboard on
  // a previous run has to be in place for the first cycle, exactly as it would
  // be had the container supplied it.
  const secrets = await loadSecretsFile(join(dirname(options.dbPath), "secrets.env"), options.env, logger);

  const store = createSqliteStateStore(db);
  const history = createHistoryService(store);
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
    onCycle: (result) => {
      lastCycle = result;
      metrics.recordCycle(result);
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
    },
  });

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
    env: options.env,
    secrets,
    dispatcher,
    store,
    history,
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
    notificationFeedLimit: NOTIFICATION_FEED_LIMIT,
    async close(): Promise<void> {
      clearInterval(pruneTimer);
      mapLane.stop();
      scheduler.stop();
      await scheduler.settled();
      await store.close();
    },
  };

  return { ...core, app: createApp(core) };
}
