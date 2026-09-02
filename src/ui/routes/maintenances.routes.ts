import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
/** An unbounded limit would let one request return the whole table. */
const MAX_LIMIT = 100;

/**
 * A bad query value is a stale bookmark or a hand-edited URL, not something
 * worth failing the whole list over — same convention as the incident
 * list's own schemas (`incidents.routes.ts`).
 */
const daysSchema = z.coerce.number().int().positive().max(MAX_DAYS).catch(DEFAULT_DAYS);
const providerSchema = z.string().min(1).optional().catch(undefined);
/**
 * No default: omitting `limit` keeps the old unbounded behaviour for a
 * caller that genuinely wants the whole matching set. A caller that wants a
 * bounded page (the Incidents view's timeline) asks for one explicitly.
 */
const limitSchema = z.coerce.number().int().positive().max(MAX_LIMIT).optional().catch(undefined);
/**
 * `z.coerce.boolean()` would treat the literal string "false" as truthy, so
 * the two accepted spellings are matched explicitly instead. Defaults to
 * `true`, the historical behaviour, for a caller that doesn't ask.
 */
const includeUpcomingSchema = z
  .enum(["true", "false"])
  .catch("true")
  .transform((value) => value === "true");

/**
 * The maintenance timeline. Kept off `/incidents` deliberately: that list is
 * paged and counted in SQL, and folding a second, differently-shaped history
 * into it would make both the page size and the counts lie.
 */
export function maintenancesRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/maintenances", async (req, res) => {
    const days = daysSchema.parse(req.query["days"] ?? undefined);
    const provider = providerSchema.parse(req.query["provider"] ?? undefined);
    const limit = limitSchema.parse(req.query["limit"] ?? undefined);
    const includeUpcoming = includeUpcomingSchema.parse(req.query["includeUpcoming"] ?? undefined);

    res.json({
      maintenances: await runtime.store.listMaintenances({
        providerId: provider,
        providerIds: runtime.enabledProviderIds(),
        days,
        limit,
        includeUpcoming,
      }),
    });
  });

  return router;
}
