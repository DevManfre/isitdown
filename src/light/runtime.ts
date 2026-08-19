import { getAdapter } from "../adapters/index.ts";
import type { ConfigSource } from "../core/configSource.interface.ts";
import { createLogger, parseLogLevel, type Logger } from "../core/logger.ts";
import { createDispatcher } from "../core/notificationDispatcher.ts";
import { createPoller } from "../core/poller.ts";
import { createScheduler, type Scheduler } from "../core/scheduler.ts";
import type { StateStore } from "../core/stateStore.interface.ts";
import { buildNotifiers } from "../notifiers/index.ts";
import { createFileConfigSource, loadConfig } from "./config/loadConfig.ts";
import { createFileStateStore } from "./fileStateStore.ts";

export interface LightRuntimeOptions {
  configPath: string;
  dataPath: string;
  env: NodeJS.ProcessEnv;
  logger?: Logger | undefined;
}

export interface LightRuntime {
  scheduler: Scheduler;
  store: StateStore;
  configSource: ConfigSource;
  logger: Logger;
  close(): Promise<void>;
}

/**
 * Assembles the Light edition. Kept apart from the entrypoint so the end-to-end
 * test can build the same wiring the container runs, rather than a lookalike.
 *
 * The configuration is loaded once here purely to fail fast: a container that
 * starts with a broken config and polls nothing is harder to diagnose than one
 * that exits with the reason.
 */
export async function buildLightRuntime(options: LightRuntimeOptions): Promise<LightRuntime> {
  const logger =
    options.logger ?? createLogger(parseLogLevel(options.env["LOG_LEVEL"]));

  await loadConfig(options.configPath, options.env);
  const configSource = createFileConfigSource(options.configPath, options.env);
  const store = await createFileStateStore(options.dataPath);

  const poller = createPoller({ getAdapter, store, logger });
  const dispatcher = createDispatcher({ logger });
  const scheduler = createScheduler({
    configSource,
    poller,
    dispatcher,
    buildNotifiers,
    logger,
  });

  return {
    scheduler,
    store,
    configSource,
    logger,
    async close(): Promise<void> {
      scheduler.stop();
      await scheduler.settled();
      await store.close();
    },
  };
}
