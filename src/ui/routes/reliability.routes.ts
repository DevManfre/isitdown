import { Router } from "express";
import { ALLOWED_DAYS, parseDays } from "./historyWindow.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * Reliability per provider, and when incidents actually happen — roadmap 12.2
 * and 12.3.
 *
 * One endpoint for both because they are one query over one table read two
 * ways, and splitting them would make the dashboard walk the incident history
 * twice to draw two things on the same screen.
 */
export function reliabilityRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/reliability", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res
        .status(400)
        .json({
          error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` },
        });
      return;
    }
    // Enabled only, like the history summary: a disabled provider leaves the
    // table without its rows being forgotten.
    res.json(
      await runtime.reliability.getReport(days, runtime.enabledProviderIds()),
    );
  });

  return router;
}
