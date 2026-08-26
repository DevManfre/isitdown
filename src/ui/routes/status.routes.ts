import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The endpoints the dashboard's status grid lives on.
 *
 * `/status` is a pure read of stored state: the grid refreshes every 30 seconds,
 * so it must never reach upstream. Only `/poll` starts a cycle, and it does so
 * through the scheduler, which means the notification path stays
 * diff engine → dispatcher exactly as a scheduled cycle would.
 */
export function statusRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      providers: runtime.providerCount(),
      lastCycleAt: runtime.lastCycleAt(),
    });
  });

  router.get("/status", async (_req, res) => {
    const config = await runtime.configSource.load();
    const services = runtime.listAllServices();

    const providers = await Promise.all(
      services.map(async (service) => {
        const state = await runtime.store.getState(service.id);
        const history = await runtime.history.getProviderHistory(
          service.id,
          90,
          config.polling.intervalMinutes,
        );
        return {
          id: service.id,
          name: service.name,
          adapter: service.adapter,
          baseUrl: service.baseUrl,
          enabled: service.enabled,
          overallStatus: state.last?.overallStatus ?? "unknown",
          activeIncidents: state.last?.activeIncidents ?? [],
          components: state.last?.components ?? [],
          componentSelection: service.components,
          scopeToComponents: service.scopeToComponents,
          fetchedAt: state.last?.fetchedAt ?? null,
          failureCount: state.failureCount,
          uptime90: history.uptime90,
        };
      }),
    );

    res.json({
      providers,
      pollIntervalMinutes: config.polling.intervalMinutes,
      lastPollAt: runtime.lastCycleAt(),
      // The scheduler's armed deadline, never `lastPollAt + interval`: the two
      // disagree by the jitter of the arming draw and by any interval change
      // made since, and the countdown reads "0s" for every second of the gap.
      nextPollAt: runtime.scheduler.nextRunAt(),
      // The clock `nextPollAt` is stamped on. The dashboard measures its own
      // offset from this rather than assuming the browser and the container
      // agree — they drift apart across a host suspend, and a browser running
      // even minutes ahead reads every deadline as already expired.
      serverNow: new Date().toISOString(),
    });
  });

  router.post("/poll", async (_req, res) => {
    const result = await runtime.scheduler.triggerNow();
    res.json({
      providers: result.results.length,
      failed: result.results.filter((entry) => !entry.ok).length,
      changes: result.changes.length,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    });
  });

  return router;
}
