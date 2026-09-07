import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

/** One page of the delivery log. The view's own default; the cap is below. */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

/**
 * A bad page number is a stale bookmark or a hand-edited URL, not something
 * worth failing the whole log over — every one of these falls back rather than
 * 400s, the same way the feed's limit does.
 */
const pageSchema = z.coerce.number().int().positive().catch(1);
const pageSizeSchema = z.coerce
  .number()
  .int()
  .positive()
  .catch(DEFAULT_PAGE_SIZE)
  .transform((value) => Math.min(value, MAX_PAGE_SIZE));
const stateSchema = z.enum(["all", "sent", "failed"]).catch("all");

/**
 * What IsItDown actually sent. This is the audit trail behind the dashboard's
 * "notifications sent" panel and its delivery log: every dispatch attempt,
 * delivered or failed.
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

  /**
   * The delivery log's page, plus the counts the page cannot tell the view
   * about itself.
   *
   * `counts` carries every outcome whatever the filter, because the view's
   * pills show all three while one state is on screen — and because the
   * failure count is the thing the view exists to put in front of an operator:
   * a channel whose credential went stale is invisible until somebody notices
   * they stopped being paged.
   *
   * Filtering and paging are server-side for the same reason the incident
   * list's are: a page filtered in the browser would report that page's totals
   * as the whole log's.
   */
  router.get("/notifications/log", async (req, res) => {
    const channelQuery = req.query["channel"];
    const channel = typeof channelQuery === "string" && channelQuery !== "" ? { channel: channelQuery } : {};
    const state = stateSchema.parse(req.query["state"] ?? undefined);
    const page = pageSchema.parse(req.query["page"] ?? undefined);
    const pageSize = pageSizeSchema.parse(req.query["pageSize"] ?? undefined);
    const providerIds = runtime.enabledProviderIds();

    const [items, counts] = await Promise.all([
      runtime.store.queryNotifications({
        ...channel,
        providerIds,
        ...(state === "all" ? {} : { state }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      runtime.store.countNotifications({ ...channel, providerIds }),
    ]);

    res.json({ page: { items, page, pageSize, total: counts[state] }, counts });
  });

  return router;
}
