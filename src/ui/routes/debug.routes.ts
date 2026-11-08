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
   * Why a provider shows the status it shows (roadmap 5.11): the last reading,
   * the components it was folded from, the rule that folded them, what the
   * operator was last told, and how far flap damping is from telling them
   * something new. Everything here is already in the state store — this only
   * puts it in one place, so nobody has to deduce a held alert from three.
   *
   * Read-only, like the probe: it never polls, and `last` is the sample the
   * poller already took, not a fresh one.
   */
  router.get("/debug/adapters/:id/explain", async (req, res) => {
    const service = listServices(runtime.db).find((entry) => entry.id === req.params.id);
    if (service === undefined) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }

    const state = await runtime.store.getState(service.id);
    const { confirmSamples } = readSettings(runtime.db, runtime.logger);
    const last = state.last;
    res.json({
      id: service.id,
      name: service.name,
      adapter: service.adapter,
      reading:
        last === null
          ? null
          : {
              fetchedAt: last.fetchedAt,
              overallStatus: last.overallStatus,
              activeIncidents: last.activeIncidents.length,
            },
      components: (last?.components ?? []).map((component) => ({
        id: component.id,
        name: component.name,
        status: component.status,
      })),
      // The adapters fold a selection into one status only when told to scope to
      // it; otherwise the provider's own overall figure stands.
      rule: service.scopeToComponents && service.components.length > 0 ? "scoped" : "overall",
      // What the next poll is compared against: the reading the operator was last
      // told about, which is not the latest sample while damping holds one back.
      told: (state.notifyBaseline ?? last)?.overallStatus ?? null,
      damping: {
        confirmSamples,
        count: state.pending?.count ?? 0,
        held: state.pending !== null,
      },
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
