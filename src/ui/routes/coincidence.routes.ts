import { Router } from "express";
import { ALLOWED_DAYS, parseDays } from "./historyWindow.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * Which providers break together — roadmap 2.10. A shortlist of pairs to
 * consider declaring as a `dependsOn` (roadmap 2.9), not a causal claim.
 */
export function coincidenceRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/coincidence", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res
        .status(400)
        .json({ error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` } });
      return;
    }
    const dependsOn: Record<string, string[] | undefined> = {};
    for (const service of runtime.listAllServices()) dependsOn[service.id] = service.dependsOn;
    res.json(
      await runtime.coincidence.getReport(days, runtime.enabledProviderIds(), dependsOn),
    );
  });

  return router;
}
