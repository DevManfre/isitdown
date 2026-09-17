import { getAdapter } from "../adapters/index.ts";
import { registerPluginAdapters } from "../adapters/plugins.ts";
import type { ConfigSource } from "../core/configSource.interface.ts";
import { createLogger, parseLogLevel, type Logger } from "../core/logger.ts";
import { createDispatcher } from "../core/notificationDispatcher.ts";
import { createPoller } from "../core/poller.ts";
import { createScheduler, type Scheduler } from "../core/scheduler.ts";
import { initTracing, tracer } from "../core/tracing.ts";
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

  // Before anything is polled, so the first cycle is traced too (roadmap 6.10).
  // Does nothing unless an OTLP endpoint is configured.
  initTracing(options.env, logger);

  // Before the configuration is read, so a provider whose adapter comes from a
  // plugin validates rather than failing as "unknown adapter" (roadmap 1.13).
  // Does nothing unless `PLUGINS_DIR` is set.
  await registerPluginAdapters(options.env, logger);

  await loadConfig(options.configPath, options.env);
  const configSource = createFileConfigSource(options.configPath, options.env);
  const store = await createFileStateStore(options.dataPath);

  const poller = createPoller({ getAdapter, store, logger });
  // The state file keeps the message ids too, so an incident's updates can edit
  // the message its opening sent (roadmap 3.19).
  const dispatcher = createDispatcher({ logger, messageRefs: store });
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
      // The last cycle's spans are the interesting ones when a container is
      // being stopped, so they are sent rather than dropped on the way out.
      await tracer().flush();
      await store.close();
    },
  };
}
