import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";
import { getAdapter } from "../adapters/index.ts";
import type { ConfigSource, ServiceDefinition } from "../core/configSource.interface.ts";
import { createLogger, parseLogLevel, type Logger } from "../core/logger.ts";
import { createDispatcher, type Dispatcher } from "../core/notificationDispatcher.ts";
import { createPoller, type CycleResult } from "../core/poller.ts";
import { createScheduler, type Scheduler } from "../core/scheduler.ts";
import { buildNotifiers } from "../notifiers/index.ts";
import { createApp } from "./app.ts";
import { createBackfillService, type BackfillService } from "./backfill.ts";
import { createDbConfigSource, listServices } from "./dbConfigSource.ts";
import { migrate } from "./db/migrate.ts";
import { openDatabase } from "./db/open.ts";
import { seedDefaults } from "./db/seed.ts";
import { loadGeoTables } from "./geo/resolveLocation.ts";
import { createHistoryService } from "./history.ts";
import type { HistoryStore } from "./historyStore.interface.ts";
import { createMapLane, type MapLane } from "./mapLane.ts";
import { createMapStore, type MapStore } from "./mapStore.ts";
import { createSqliteStateStore } from "./sqliteStateStore.ts";

/** Kept a month beyond the 90-day view so a full window is always available. */
const RETENTION_DAYS = 120;
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
  dispatcher: Dispatcher;
  store: HistoryStore;
  history: ReturnType<typeof createHistoryService>;
  configSource: ConfigSource;
  scheduler: Scheduler;
  /** Built here, run by the server at boot — never by the runtime builder, so tests stay offline. */
  backfill: BackfillService;
  mapStore: MapStore;
  /**
   * Started by the server, like the scheduler — never by the runtime builder,
   * so tests stay offline and can drive `refresh()` explicitly.
   */
  mapLane: MapLane;
  logger: Logger;
  /** Every configured provider, including disabled ones — the dashboard shows both. */
  listAllServices(): ServiceDefinition[];
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

  const store = createSqliteStateStore(db);
  const history = createHistoryService(store);
  const configSource = createDbConfigSource(db, options.env, logger);

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
  const dispatcher = createDispatcher({
    logger,
    // What the dashboard's notification feed is built from.
    onSent: (record) => store.recordNotification(record),
  });

  let lastCycle: CycleResult | undefined;
  const scheduler = createScheduler({
    configSource,
    poller,
    dispatcher,
    buildNotifiers,
    logger,
    onCycle: (result) => {
      lastCycle = result;
    },
  });

  const backfill = createBackfillService({ getAdapter, store, configSource, logger });

  await store.pruneOlderThan(RETENTION_DAYS);
  const pruneTimer = setInterval(() => {
    void store.pruneOlderThan(RETENTION_DAYS).catch((error: unknown) => {
      logger.error("pruning history failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  const core: UiRuntimeCore = {
    db,
    env: options.env,
    dispatcher,
    store,
    history,
    configSource,
    scheduler,
    backfill,
    mapStore,
    mapLane,
    logger,
    listAllServices: () => listServices(db),
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
