import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * What StatusWatch actually sent. This is the audit trail behind the dashboard's
 * "notifications sent" panel: every dispatch attempt, delivered or failed.
 */
export function notificationsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/notifications", async (req, res) => {
    const limitSchema = z.coerce
      .number()
      .int()
      .positive()
      .catch(runtime.notificationFeedLimit)
      .transform((value) => Math.min(value, runtime.notificationFeedLimit));
    const limit = limitSchema.parse(req.query["limit"] ?? undefined);
    res.json({ notifications: await runtime.store.listNotifications(limit) });
  });

  return router;
}
