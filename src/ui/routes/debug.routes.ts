import { Router } from "express";
import { getAdapter } from "../../adapters/index.ts";
import { listServices, readSettings } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The adapter debug panel's data (roadmap 5.18).
 *
 * Two halves, and both are needed: the recent outcomes say whether reads are
 * failing at all and how often, and the live probe says what the adapter makes
 * of the page right now. A selector scrape that has stopped matching looks
 * healthy in the first half — the fetch succeeds — and is obvious in the
 * second, where the parsed reading comes back `unknown` with nothing in it.
 *
 * Read-only towards the fleet: the probe records nothing, notifies nothing and
 * touches no state, exactly like the connection test. Nothing here can move the
 * dashboard's own numbers.
 */
export function debugRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/debug/adapters", (_req, res) => {
    res.json({
      providers: listServices(runtime.db).map((service) => ({
        id: service.id,
        name: service.name,
        adapter: service.adapter,
        baseUrl: service.baseUrl,
        enabled: service.enabled,
        // The adapter's own options — a CSS selector, an RSS field name — are
        // the first thing to look at when a parse goes wrong, and they are
        // configuration, never credentials: every one of these pages is public.
        options: service.options ?? {},
        probes: runtime.adapterDebug.list(service.id),
      })),
    });
  });

  /**
   * One read, right now, reported in full: the whole normalized reading on
   * success, and the adapter's own error message on failure. The reading is
   * what makes a silent parse failure visible — an adapter that matched nothing
   * answers with `unknown` and empty lists rather than throwing.
   */
  router.post("/debug/adapters/:id/probe", async (req, res) => {
    const service = listServices(runtime.db).find((entry) => entry.id === req.params.id);
    if (service === undefined) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }

    const { requestTimeoutSeconds } = readSettings(runtime.db, runtime.logger);
    const startedAt = Date.now();
    try {
      const status = await getAdapter(service.adapter).fetchStatus(
        {
          id: service.id,
          name: service.name,
          baseUrl: service.baseUrl,
          options: service.options,
          components: service.components,
          scopeToComponents: service.scopeToComponents,
        },
        { timeoutMs: requestTimeoutSeconds * 1000 },
      );
      res.json({ ok: true, durationMs: Date.now() - startedAt, status });
    } catch (error) {
      // 200 with `ok: false`, like the connection test: a provider that cannot
      // be read is an answer to the question asked, not a failure of the
      // dashboard to answer it.
      res.json({
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
