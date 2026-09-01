import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * What IsItDown actually sent. This is the audit trail behind the dashboard's
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
    // Scoped to the enabled providers: a disabled one is off the dashboard, and
    // the feed is the dashboard's own audit trail. Scoping the query rather than
    // its answer keeps the limit honest — filtering afterwards would return
    // fewer rows than were asked for.
    res.json({
      notifications: await runtime.store.listNotifications(limit, runtime.enabledProviderIds()),
    });
  });

  return router;
}
