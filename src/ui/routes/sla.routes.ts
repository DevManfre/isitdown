import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * Monthly targets and error budgets — roadmap 4.13.
 *
 * One route, answering for the whole fleet: a budget is only interesting beside
 * the other budgets ("which vendor is eating its month"), and a per-provider
 * endpoint would have the dashboard make one request per row to build that.
 *
 * Providers with no target are absent rather than reported at 100%. Nobody
 * promised anything about them, and a table of imaginary targets is worse than
 * a short one.
 */
export function slaRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/sla", async (_req, res) => {
    const config = await runtime.configSource.load();
    // The whole fleet, not just the enabled providers: a provider switched off
    // halfway through the month still spent what it spent, and hiding the row
    // would make the month look better than it was.
    const providers = await runtime.sla.budgets(
      runtime.listAllServices(),
      config.polling.intervalMinutes,
    );
    res.json({ month: providers[0]?.month ?? new Date().toISOString().slice(0, 7), providers });
  });

  return router;
}
