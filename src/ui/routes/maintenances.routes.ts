import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The maintenance timeline. Kept off `/incidents` deliberately: that list is
 * paged and counted in SQL, and folding a second, differently-shaped history
 * into it would make both the page size and the counts lie.
 */
export function maintenancesRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/maintenances", async (req, res) => {
    const days = z.coerce.number().int().positive().max(365).catch(90).parse(req.query["days"] ?? undefined);
    const provider = z.string().min(1).optional().catch(undefined).parse(req.query["provider"] ?? undefined);

    res.json({
      maintenances: await runtime.store.listMaintenances({
        providerId: provider,
        providerIds: runtime.enabledProviderIds(),
        days,
        includeUpcoming: true,
      }),
    });
  });

  return router;
}
