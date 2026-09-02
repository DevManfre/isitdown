import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/** Prometheus exposition format version this endpoint speaks. */
const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * The one endpoint of the UI edition that is not JSON: Prometheus scrapes text.
 * It is a pure read of stored state and in-process counters, so a scrape — which
 * may arrive every few seconds — never reaches a provider.
 */
export function metricsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/metrics", async (_req, res) => {
    res.type(CONTENT_TYPE).send(await runtime.metrics.render());
  });

  return router;
}
